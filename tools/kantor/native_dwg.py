"""Require immutable source/output hashes and Autodesk reopen evidence for DWG."""
import hashlib
import json
import re
from pathlib import Path


def attach_native_register(root: Path) -> int:
    register = root / 'drawings/register.json'
    doc = json.loads(register.read_text())
    attached = 0
    for sheet in doc['sheets']:
        dxf_info = sheet.get('files', {}).get('dxf')
        if not dxf_info:
            continue
        dxf = root / dxf_info['path']
        if hashlib.sha256(dxf.read_bytes()).hexdigest() != dxf_info['sha256']:
            raise ValueError(f"Stale DXF register entry: {sheet['id']}")
        dwg = dxf.with_suffix('.dwg')
        if verified_native_dwg(dwg, root):
            sheet['files']['dwg'] = {'path': str(dwg.relative_to(root)),
                                      'sha256': hashlib.sha256(dwg.read_bytes()).hexdigest()}
            sheet['native_dwg'] = 'GENERATED (Autodesk reopen/AUDIT/counts; native plot pending)'
            attached += 1
    doc['note'] = 'DXF/PDF concept drawings. Native DWG hashes/reopen evidence attached separately; native plot/font review pending.'
    register.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + '\n')
    return attached


def verified_native_dwg(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        data = path.read_bytes()
        if not data.startswith(b'AC1032'):
            return False
        digest = hashlib.sha256(data).hexdigest()
        source = path.with_suffix('.dxf')
        source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
        for report in (root / 'docs/evidence').glob('*/native-dwg/report.json'):
            for row in json.loads(report.read_text()):
                if row.get('sheet') != path.stem:
                    continue
                if row.get('dwg_sha256') != digest or row.get('dxf_sha256') != source_digest:
                    continue
                log = (report.parent / f'{path.stem}-reopen.log').read_text(errors='replace')
                units = re.search(r'^NATIVE_UNITS=4(?:\r?$)', log, re.M)
                audit = re.findall(r'Total errors found\s+(\d+)\s+fixed\s+(\d+)', log)
                layouts = re.findall(r'^NATIVE_LAYOUT=([^\r\n]+)', log, re.M)
                compare = (report.parent / f'{path.stem}-compare.log').read_text()
                if ('AutoCAD Core Engine Console' in log and units and audit and audit[-1] == ('0', '0')
                        and layouts == row.get('paper_layouts') and 'HASIL: cocok' in compare
                        and row.get('reopen') and row.get('model_counts_match') and row.get('audit_errors') == 0):
                    return True
    except (OSError, ValueError, TypeError, KeyError):
        return False
    return False
