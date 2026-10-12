"""Verify existing iOS signing metadata and publish on runner, never on host."""
import hashlib,json,os,plistlib,re,subprocess,urllib.request,urllib.error,uuid,zipfile
from pathlib import Path
file=Path(os.environ['BUILD_ARTIFACT_PATH']);assert file.suffix=='.ipa'
with zipfile.ZipFile(file) as archive:
 path=next(n for n in archive.namelist() if n.startswith('Payload/') and n.count('/')==2 and n.endswith('.app/Info.plist'))
 info=plistlib.loads(archive.read(path));prefix=path.rsplit('/',1)[0]+'/'
 assert info['CFBundleIdentifier']=='com.adblock.browser.vn'
 assert info['CFBundleVersion']=='3902'
 decoded=subprocess.run(['openssl','cms','-verify','-inform','DER','-noverify'],input=archive.read(prefix+'embedded.mobileprovision'),capture_output=True,check=True)
 profile=plistlib.loads(decoded.stdout)
 assert '2N855B68G9' in profile.get('TeamIdentifier',[])
 assert profile.get('Entitlements',{}).get('application-identifier','').endswith('.com.adblock.browser.vn')
 assert profile.get('ProvisionedDevices'),'Internal distribution requires registered devices'
 count=len(profile['ProvisionedDevices'])
with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
print(f'Signing verified: team 2N855B68G9; bundle com.adblock.browser.vn; build3902; registered device count {count}')
key=os.environ.get('LOADLY_IO_TOKEN');assert key,'Loadly credential missing'
boundary='SessionBox'+uuid.uuid4().hex
prefix=(f'--{boundary}\r\nContent-Disposition: form-data; name="_api_key"\r\n\r\n{key}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="SessionBox-ios-development-3902.ipa"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
body=prefix+file.read_bytes()+f'\r\n--{boundary}--\r\n'.encode()
request=urllib.request.Request('https://api.loadly.io/apiv2/app/upload',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary},method='POST')
try:
 with urllib.request.urlopen(request,timeout=600) as response:result=json.load(response)
except urllib.error.HTTPError as error:raise SystemExit(f'Loadly upload failed: HTTP {error.code}') from None
except Exception as error:raise SystemExit('Loadly upload failed: '+type(error).__name__) from None
shortcut=result.get('data',{}).get('buildShortcutUrl','')
assert isinstance(shortcut,str) and re.fullmatch(r'[A-Za-z0-9_-]+',shortcut),'Installation link missing'
url='https://i.loadly.io/'+shortcut
print(f'SESSION_BOX_LOADLY_LINK ios {url}')
print('SESSION_BOX_IPA_SHA256 '+digest)
with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as summary:summary.write(f'iOS development3902: [{url}]({url})\n\nTeam2N855B68G9 / com.adblock.browser.vn; devices{count}; SHA256 {digest}\n')
