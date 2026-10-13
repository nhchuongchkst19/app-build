"""Validate public binary metadata and upload directly from the GitHub runner."""
import datetime
import hashlib
import json
import os
import plistlib
import re
import subprocess
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

file = Path(os.environ['BUILD_ARTIFACT_PATH'])
platform = os.environ['BUILD_PLATFORM']
config = json.loads(Path('app.json').read_text())['expo']
metadata = {'platform': platform, 'package': 'com.sessionbox', 'build': '3904',
            'sourceSha': os.environ['APP_SOURCE_SHA'], 'profile': 'development'}
if platform == 'ios':
    assert file.suffix == '.ipa'
    with zipfile.ZipFile(file) as archive:
        path = next(n for n in archive.namelist() if n.startswith('Payload/') and n.count('/') == 2 and n.endswith('.app/Info.plist'))
        info = plistlib.loads(archive.read(path))
        assert info['CFBundleIdentifier'] == 'com.sessionbox'
        assert info['CFBundleDisplayName'] == 'Session Spaces'
        assert info['CFBundleVersion'] == '3904'
        decoded = subprocess.run(['openssl', 'cms', '-verify', '-inform', 'DER', '-noverify'],
                                 input=archive.read(path.rsplit('/', 1)[0] + '/embedded.mobileprovision'),
                                 capture_output=True, check=True)
        profile = plistlib.loads(decoded.stdout)
        team = config['ios']['appleTeamId']
        assert team in profile.get('TeamIdentifier', [])
        assert profile.get('Entitlements', {}).get('application-identifier') == team + '.com.sessionbox'
        assert profile.get('ProvisionedDevices'), 'Internal IPA requires registered devices'
        assert profile['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        metadata.update(name=info['CFBundleDisplayName'], teamId=team,
                        provisionedDeviceCount=len(profile['ProvisionedDevices']),
                        profileExpiration=profile['ExpirationDate'].isoformat() + 'Z')
else:
    assert platform == 'android' and file.suffix == '.apk'
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ['ANDROID_SDK_ROOT'])
    candidates = list((sdk / 'build-tools').glob('*/aapt'))
    assert candidates, 'Android APK metadata tool not found'
    output = subprocess.run([str(sorted(candidates)[-1]), 'dump', 'badging', str(file)],
                            capture_output=True, text=True, check=True).stdout
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", output)
    assert package and package.group(1) == 'com.sessionbox'
    assert package.group(2) == '1100003904'
    label = re.search(r"application-label:'([^']+)'", output)
    assert label and label.group(1) == 'Session Spaces'
    metadata.update(name=label.group(1), versionCode=package.group(2), versionName=package.group(3))
with file.open('rb') as stream:
    metadata['sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
print('Binary metadata verified: ' + json.dumps(metadata))
key = os.environ.get('LOADLY_IO_TOKEN')
assert key, 'Loadly credential missing'
boundary = 'SessionSpaces' + uuid.uuid4().hex
prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="_api_key"\r\n\r\n{key}\r\n'
          f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="SessionSpaces-{platform}-development-3904{file.suffix}"\r\n'
          'Content-Type: application/octet-stream\r\n\r\n').encode()
body = prefix + file.read_bytes() + f'\r\n--{boundary}--\r\n'.encode()
request = urllib.request.Request('https://api.loadly.io/apiv2/app/upload', data=body,
                                headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}, method='POST')
try:
    with urllib.request.urlopen(request, timeout=600) as response:
        result = json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit(f'Loadly upload failed: HTTP {error.code}') from None
except Exception as error:
    raise SystemExit('Loadly upload failed: ' + type(error).__name__) from None
shortcut = result.get('data', {}).get('buildShortcutUrl', '')
assert isinstance(shortcut, str) and re.fullmatch(r'[A-Za-z0-9_-]+', shortcut), 'Installation link missing'
metadata['loadlyUrl'] = 'https://i.loadly.io/' + shortcut
print('SESSION_SPACES_BUILD_METADATA ' + json.dumps(metadata))
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
    summary.write(f"{platform} development3904: [{metadata['loadlyUrl']}]({metadata['loadlyUrl']})\n\n")
    summary.write('```json\n' + json.dumps(metadata, indent=2) + '\n```\n')
