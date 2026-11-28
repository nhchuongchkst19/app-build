"""Validate release identity, upload signer, native page alignment and delivery scope."""
import hashlib,json,os,struct,subprocess,zipfile,xml.etree.ElementTree as ET
from pathlib import Path

bundle=Path('delivery/2-camera-1.0.0-1.aab')
manifest=ET.parse(Path(os.environ['RUNNER_TEMP'])/'bundle-manifest.xml').getroot()
a='{http://schemas.android.com/apk/res/android}'
assert manifest.get('package')=='com.luongtrinh.twocamera'
assert manifest.get(a+'versionCode')=='1'
assert manifest.get(a+'versionName')=='1.0.0'
uses=manifest.find('uses-sdk')
assert int(uses.get(a+'targetSdkVersion'))>=36
assert uses.get(a+'minSdkVersion')=='29'
application=manifest.find('application')
assert application.get(a+'debuggable','false')=='false'
config=json.loads((Path(os.environ['RUNNER_TEMP'])/'bundle-config.json').read_text())
assert 'PAGE_ALIGNMENT_16K' in json.dumps(config),'Bundle must request 16 KiB APK alignment'
assert not any(p.get(a+'name') in ['android.permission.MANAGE_EXTERNAL_STORAGE','com.google.android.gms.permission.AD_ID'] for p in manifest.findall('uses-permission'))
cert=subprocess.check_output(['keytool','-printcert','-jarfile',str(bundle),'-rfc'],text=True)
start=cert.index('-----BEGIN CERTIFICATE-----');end=cert.index('-----END CERTIFICATE-----',start)+len('-----END CERTIFICATE-----')
pem=cert[start:end]+'\n'
import base64
raw=base64.b64decode(''.join(pem.splitlines()[1:-1]))
fingerprint=hashlib.sha256(raw).hexdigest()
assert fingerprint==os.environ['TWO_CAMERA_UPLOAD_CERT_SHA256'].lower().replace(':',''),'Unexpected upload signer'
Path('delivery/upload-certificate.pem').write_text(pem)
native=[]
with zipfile.ZipFile(bundle) as archive:
    for name in archive.namelist():
        assert not name.endswith(('.p12','.jks','.keystore','scene.jpg','reaction.jpg'))
        if not name.endswith('.so'):continue
        data=archive.read(name)
        assert data[:4]==b'\x7fELF',name
        endian='<' if data[5]==1 else '>'
        is64=data[4]==2
        if is64:
            offset=struct.unpack_from(endian+'Q',data,32)[0]
            size,count=struct.unpack_from(endian+'HH',data,54)
            for i in range(count):
                h=offset+i*size
                if struct.unpack_from(endian+'I',data,h)[0]==1:
                    align=struct.unpack_from(endian+'Q',data,h+48)[0]
                    assert align>=16384,(name,align)
        native.append({'file':name,'bits':64 if is64 else 32,'pageAlignmentChecked':is64})
report={'sourceSha':os.environ['APP_REF'],'applicationId':manifest.get('package'),'versionName':'1.0.0','versionCode':1,'minSdk':29,'targetSdk':int(uses.get(a+'targetSdkVersion')),'sha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'bytes':bundle.stat().st_size,'signerCertificateSha256':fingerprint,'uploadKey':'dedicated upload certificate; not debug key','bundleValidated':True,'apkPageAlignment':'16K','nativeLibraries':native,'publishing':'Not submitted; user uploads manually','runId':os.environ['GITHUB_RUN_ID']}
Path('delivery/receipt.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
