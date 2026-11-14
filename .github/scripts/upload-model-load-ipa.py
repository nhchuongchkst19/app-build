"""Upload the verified existing device IPA. Credentials stay in the runner environment."""
import hashlib,json,os,pathlib,subprocess
files=list(pathlib.Path('download').rglob('*.ipa'))
assert len(files)==1,'Expected one signed IPA'
p=files[0].resolve();sha=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
assert sha=='e899982fb2cdf74fa5a3b8bc6f087435ec02a6cf61c5f3c6b295460bf0088b5e','IPA differs from reviewed build'
key=os.environ['LOADLYIO_TOKEN'];assert key
config='\n'.join(['url = "https://api.loadly.io/apiv2/app/upload"','silent','show-error','fail-with-body','max-time = 600','form = '+json.dumps('_api_key='+key),'form = '+json.dumps('file=@'+str(p))])+'\n'
r=subprocess.run(['curl','--config','-'],input=config,text=True,capture_output=True)
if r.returncode:raise SystemExit('Loadly transport failed, code '+str(r.returncode))
try:data=json.loads(r.stdout)
except ValueError:raise SystemExit('Loadly returned a non-JSON response')
d=data.get('data') or {};shortcut=d.get('buildShortcutUrl')
if not shortcut:raise SystemExit('Loadly did not return an installation link; status='+str(data.get('status')))
assert isinstance(shortcut,str) and len(shortcut)<300
url=shortcut if shortcut.startswith('https://') else 'https://i.loadly.io/'+shortcut
result={'status':'uploaded','sourceRunId':43549703964,'sha256':sha,'bytes':p.stat().st_size,'buildIdentifier':d.get('buildIdentifier'),'installUrl':url,'qrCodeUrl':d.get('buildQRCodeURL')}
pathlib.Path('release.json').write_text(json.dumps(result,indent=2))
with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:f.write('Model Load iOS development: '+url+'\n\nVerified IPA SHA-256: '+sha+'\n')
print(json.dumps(result))
