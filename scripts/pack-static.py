#!/usr/bin/env python3
"""Package an existing, verified static directory without recompressing image pixels."""
import argparse, hashlib, json, zipfile
from pathlib import Path
p = argparse.ArgumentParser(); p.add_argument('source', type=Path); p.add_argument('--out', type=Path, default=Path('asset-packs')); args=p.parse_args()
root=args.source.resolve(); out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
limit=4*1024*1024
files=[]; groups=[]; group=[]; total=0
for path in sorted(root.rglob('*')):
    if path.is_symlink(): raise SystemExit(f'Symlink forbidden: {path}')
    if not path.is_file():continue
    name=path.relative_to(root).as_posix(); size=path.stat().st_size
    if size>limit-65536:raise SystemExit(f'File too large: {name}')
    if group and total+size+512>limit-65536:groups.append(group);group=[];total=0
    data=path.read_bytes();files.append({'path':name,'bytes':size,'sha256':hashlib.sha256(data).hexdigest()})
    group.append(path);total+=size+512
if group:groups.append(group)
packs=[]
for i,group in enumerate(groups,1):
    target=out/f'part-{i:03d}.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for path in group:
            info=zipfile.ZipInfo(path.relative_to(root).as_posix(),(2026,11,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,path.read_bytes(),compresslevel=9)
    data=target.read_bytes();assert len(data)<=limit
    packs.append({'path':target.name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'files':len(group)})
manifest={'schema':1,'source_commit':'125c16886af45f58aea0d15c7dca203310a61e78','episodes':271,'images':1084,'files':files,'packs':packs,'unpacked_bytes':sum(f['bytes'] for f in files),'packed_bytes':sum(p['bytes'] for p in packs)}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in manifest.items() if k not in ['files','packs']}|{'file_count':len(files),'pack_count':len(packs),'largest_pack':max(p['bytes'] for p in packs)},indent=2))
