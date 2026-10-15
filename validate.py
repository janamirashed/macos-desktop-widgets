#!/usr/bin/env python3
"""Validate generated builds without installing, enabling, or changing settings."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile

root=Path(__file__).resolve().parent
source=root.parent
versions=range(45,52)
original_schema=ET.parse(source/'schemas/org.gnome.shell.extensions.peachos-widgets.gschema.xml')
personal_names={original_schema.find(f'.//key[@name="{key}"]/default').text.strip("'").casefold() for key in ['leetcode-user','codeforces-handle']} - {''}
checks=[]
for version in versions:
    build=root/f'gnome-{version}'
    metadata=json.loads((build/'metadata.json').read_text())
    assert metadata['shell-version']==[str(version)]
    assert metadata['uuid']=='peachos-widgets@peachos'
    schema=ET.parse(build/'schemas/org.gnome.shell.extensions.peachos-widgets.gschema.xml')
    for key in ['leetcode-user','codeforces-handle']:
        assert schema.find(f'.//key[@name="{key}"]/default').text=="''"
    subprocess.run(['glib-compile-schemas','--strict','--dry-run',str(build/'schemas')],check=True)
    subprocess.run(['bash','-n',str(build/'install.sh')],check=True)
    code=[build/'extension.js',*(build/'lib').rglob('*.js'),*(build/'widgets').rglob('*.js')]
    for path in code:
        text=path.read_text()
        assert not any(name in text.casefold() for name in personal_names),path
        if version<=47:assert not re.search(r'orientation:\s*Clutter\.Orientation',text),path
        else:assert not re.search(r'\bvertical:\s*(?:true|false)\b',text),path
        # All relative imports must be within the self-contained distribution.
        for relative in re.findall(r"from\s+['\"](\.[^'\"]+)['\"]",text):
            target=(path.parent/relative).resolve()
            assert target.is_file() and build.resolve() in target.parents,(path,relative)
    def parse(path):
        result=subprocess.run(['node','--input-type=module','--check'],input=path.read_text(),text=True,capture_output=True)
        assert result.returncode==0,(path,result.stderr)
    with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(parse,code))
    # Check Python sources without creating bytecode or executing account code.
    for path in (build/'helpers').glob('*.py'):
        text=path.read_text();compile(text,str(path),'exec')
        assert not any(name in text.casefold() for name in personal_names),path
    package=root/'archives'/f'peachos-widgets-gnome-{version}.zip'
    with zipfile.ZipFile(package) as archive:
        assert archive.testzip() is None
        assert json.loads(archive.read('metadata.json'))['shell-version']==[str(version)]
        assert 'schemas/gschemas.compiled' in archive.namelist()
        assert 'helpers/configure-accounts.py' in archive.namelist()
        assert not any('__pycache__' in name or name.startswith(('original/','new/','.git/')) for name in archive.namelist())
        for path in build.rglob('*'):
            if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                assert archive.read(str(path.relative_to(build)))==path.read_bytes(),path
    checks.append({'version':version,'javascript_files_parsed':len(code),'layout_property':'vertical' if version<=47 else 'orientation',
                   'schema_checked':True,'archive_checked':True,'blank_account_defaults':True,
                   'runtime_tested_distribution':False,'baseline_user_tested_gnome46':version==46})
subprocess.run(['node',str(root/'check-empty-accounts.mjs')],check=True)
manifest=json.loads((root/'SOURCE-MANIFEST.json').read_text())
assert all(hashlib.sha256((source/name).read_bytes()).hexdigest()==digest for name,digest in manifest.items()),'Source tree changed'
(root/'VALIDATION.json').write_text(json.dumps({'versions':checks,'source_unchanged':True,'installed':False},indent=2)+'\n')
print(f'Validated {len(checks)} versions, {sum(item["javascript_files_parsed"] for item in checks)} JavaScript modules, schemas, imports, empty-account behavior and all archives.')
