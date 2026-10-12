"""Publish immutable already-built binaries on GitHub runner; no Telegram or host copies."""
import hashlib,json,os,re,subprocess,urllib.request,urllib.error,uuid
from pathlib import Path
repo='nhchuongchkst19/app-build'
source='0123d3214d25ff11893f61d73642bde248620032'
platform=os.environ['BUILD_PLATFORM']
expected={
 'android':(38215488341,'session-box-app-android-qa-2266','e6cfe95611dfccd902c6e515f9bd159a4ffd283faae8435209571797d1ce034c','.apk','ubuntu-latest'),
 'ios':(38215490963,'session-box-app-ios-qa-2267','6264e2a5c70e01f8ae94e3d3c690149b7403cd2555c675e6c70cad47919c5b84','.ipa','macos-26')}
run,name,digest,extension,runner=expected[platform]
metadata=json.loads(subprocess.check_output(['gh','api',f'repos/{repo}/actions/runs/{run}']))
assert metadata['conclusion']=='success'
assert metadata['head_sha']=='4aa6629331d36169e880e678c08e207cbb5d820e'
assert metadata['display_title']==f'{runner} | {platform} | qa | session-box-app | {source} | upload'
directory=Path(os.environ['RUNNER_TEMP'])/'session-box-loadly'
subprocess.run(['gh','run','download',str(run),'--repo',repo,'--name',name,'--dir',str(directory)],check=True)
files=list(directory.rglob('*'+extension));assert len(files)==1
file=files[0]
with file.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==digest
key=os.environ.get('LOADLY_IO_TOKEN');assert key,'Loadly credential missing'
boundary='SessionBox'+uuid.uuid4().hex
prefix=(f'--{boundary}\r\nContent-Disposition: form-data; name="_api_key"\r\n\r\n{key}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="SessionBox-development-3901{extension}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode()
body=prefix+file.read_bytes()+f'\r\n--{boundary}--\r\n'.encode()
request=urllib.request.Request('https://api.loadly.io/apiv2/app/upload',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary},method='POST')
try:
 with urllib.request.urlopen(request,timeout=600) as response:
  result=json.load(response)
except urllib.error.HTTPError as error:
 raise SystemExit(f'Loadly upload failed: HTTP {error.code}') from None
except Exception as error:
 raise SystemExit('Loadly upload failed: '+type(error).__name__) from None
shortcut=result.get('data',{}).get('buildShortcutUrl','')
assert isinstance(shortcut,str) and re.fullmatch(r'[A-Za-z0-9_-]+',shortcut),'Loadly did not return an installation link'
url='https://i.loadly.io/'+shortcut
print(f'SESSION_BOX_LOADLY_LINK {platform} {url}',flush=True)
with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as summary:
 summary.write(f'{platform} development3901: [{url}]({url})\n\nSource build: {run}; SHA256: {digest}\n')
