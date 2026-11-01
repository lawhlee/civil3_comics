#!/usr/bin/env python3
"""Verify bounded ZIP packs and every file before atomically assembling dist/."""
import hashlib,json,os,re,shutil,stat,tempfile,zipfile
from pathlib import Path,PurePosixPath
ROOT=Path(__file__).resolve().parents[1];PACKS=ROOT/'asset-packs';OUT=ROOT/'dist'
manifest=json.loads((PACKS/'manifest.json').read_text(encoding='utf-8'))
assert manifest['schema']==1

def safe(name):
    p=PurePosixPath(name)
    assert name and not p.is_absolute() and '\\' not in name and not any(c in name for c in '\x00\r\n') and all(s not in ('','.','..') for s in name.split('/')),f'Unsafe path: {name!r}'
    return p
expected={f['path']:f for f in manifest['files']};assert len(expected)==len(manifest['files'])
for name in expected:safe(name)
assert sum(f['bytes'] for f in expected.values())==manifest['unpacked_bytes']<1024**3
staging=Path(tempfile.mkdtemp(prefix='.static-build-',dir=ROOT));seen=set()
try:
    for pack in manifest['packs']:
        assert re.fullmatch(r'part-\d{3}\.zip',pack['path'])
        path=PACKS/pack['path'];data=path.read_bytes()
        assert len(data)==pack['bytes']<=4*1024*1024,f'Pack size mismatch: {path.name}'
        assert hashlib.sha256(data).hexdigest()==pack['sha256'],f'Pack hash mismatch: {path.name}'
        with zipfile.ZipFile(path) as z:
            assert len(z.infolist())==pack['files']
            for info in z.infolist():
                name=info.filename;rel=safe(name)
                assert not info.is_dir() and not stat.S_ISLNK(info.external_attr>>16),name
                assert name in expected and name not in seen,name
                record=expected[name];assert info.file_size==record['bytes']<=4*1024*1024,name
                content=z.read(info)
                assert len(content)==record['bytes'] and hashlib.sha256(content).hexdigest()==record['sha256'],name
                target=staging/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(content);seen.add(name)
    assert seen==set(expected),'Missing files'
    html=(staging/'index.html').read_text(encoding='utf-8')
    catalog_name=re.search(r'<script src="(catalog[^"?]*\.js)',html).group(1)
    catalog=json.loads((staging/catalog_name).read_text(encoding='utf-8').split('=',1)[1].rstrip(';\n'))
    episodes=catalog['episodes'];assert len(episodes)==manifest['episodes']==271
    assert len({e['id'] for e in episodes})==len(episodes)
    assert sum(c['count'] for c in catalog['chapters'])==len(episodes)
    images=set()
    for episode in episodes:
        for key in ('image','thumbnail'):
            name=episode[key];safe(name);assert name in expected;images.add(name)
        for quality,width in [('low',480),('standard',768),('high',1024)]:
            source=episode['sources'][quality];name=source['src'];safe(name)
            assert name in expected and expected[name]['bytes']==source['bytes'] and source['width']==width and source['height']==width*3//2,name
            images.add(name)
    assert len(images)==manifest['images']==1084
    for name in images:
        data=(staging/name).read_bytes();assert data[:4]==b'RIFF' and data[8:12]==b'WEBP',name
    for ref in re.findall(r'(?:src|href)="([^"#?]+)',html):
        if not ref.startswith(('https:','http:','data:')):safe(ref);assert (staging/ref).is_file(),ref
    (staging/'build-info.json').write_text(json.dumps({'commit':os.environ.get('GITHUB_SHA','local')})+'\n',encoding='utf-8')
    (staging/'.nojekyll').touch()
    if OUT.exists():shutil.rmtree(OUT)
    staging.replace(OUT)
    print(f'PASS: {len(episodes)} episodes, {len(images)} WebP images, {len(seen)} exact files; all paths, sizes, hashes and ZIP CRCs verified')
finally:
    if staging.exists():shutil.rmtree(staging)
