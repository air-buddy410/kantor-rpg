"""Convert and reopen every sheet in Autodesk Core Console; compare model counts.

Use --core with the installed AcCoreConsole executable. No third-party DWG
converter is used. Licensing is supplied by the installed Autodesk application.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--core', required=True)
    args = ap.parse_args()
    evidence = ROOT / 'docs/evidence/MAX/native-dwg'
    cache = ROOT / '.cache/autocad'
    evidence.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    lisp = cache / 'counts.lsp'
    lisp.write_text('''(defun c:KRCOUNT (/ ss i ed key pair lst fn f total)
(setq ss (ssget "_X" '((410 . "Model"))) lst '() total 0)
(if ss (progn (setq i 0 total (sslength ss))
(repeat total (setq ed (entget (ssname ss i)) key (strcat (cdr (assoc 8 ed)) " " (cdr (assoc 0 ed))) pair (assoc key lst))
(if pair (setq lst (subst (cons key (1+ (cdr pair))) pair lst)) (setq lst (cons (cons key 1) lst))) (setq i (1+ i)))))
(setq fn (strcat (getvar "DWGPREFIX") (vl-filename-base (getvar "DWGNAME")) ".autocad-counts.txt") f (open fn "w"))
(foreach p (vl-sort lst '(lambda (a b) (< (car a) (car b)))) (write-line (strcat (car p) " " (itoa (cdr p))) f))
(write-line (strcat "TOTAL MODELSPACE " (itoa total)) f) (close f)
(princ (strcat "\\nNATIVE_UNITS=" (itoa (getvar "INSUNITS"))))
(foreach x (dictsearch (namedobjdict) "ACAD_LAYOUT") (if (= (car x) 3) (princ (strcat "\\nNATIVE_LAYOUT=" (cdr x))))) (princ))
''')
    report = []
    for dxf in sorted((ROOT / 'cad/out').glob('*.dxf')):
        sid = dxf.stem
        dwg = dxf.with_suffix('.dwg')
        if dwg.exists():
            dwg.unlink()
        convert = cache / f'{sid}-convert.scr'
        convert.write_text(f'FILEDIA\n0\nCMDDIA\n0\n_.AUDIT\n_Y\n_.SAVEAS\n2018\n"{dwg}"\n_.QUIT\n')
        def run(script, name, input_file=None):
            cmd = [args.core, '/s', str(script), '/l', 'en-US']
            if input_file:
                cmd.extend(['/i', str(input_file)])
            with (evidence / name).open('w') as log:
                r = subprocess.run(cmd, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=90)
            if r.returncode:
                raise RuntimeError(f'{sid}: Core Console exit {r.returncode}')
            return (evidence / name).read_text(errors='replace')
        run(convert, f'{sid}-convert.log', dxf)
        if not dwg.exists() or dwg.read_bytes()[:6] != b'AC1032':
            raise RuntimeError(f'{sid}: no genuine R2018 DWG')
        verify = cache / f'{sid}-verify.scr'
        inline_lisp = ' '.join(lisp.read_text().splitlines())
        verify.write_text(f'{inline_lisp}\n_.AUDIT\n_Y\nKRCOUNT\n_.QUIT\n_N\n')
        text = run(verify, f'{sid}-reopen.log', dwg)
        audits = re.findall(r'Total errors found\s+(\d+)\s+fixed\s+(\d+)', text)
        if not audits or audits[-1] != ('0', '0') or 'NATIVE_UNITS=4' not in text:
            raise RuntimeError(f'{sid}: audit or millimetre unit verification failed')
        counts = dxf.with_suffix('.autocad-counts.txt')
        result = subprocess.run([str(ROOT / '.venv/bin/python'), str(ROOT / 'cad/autocad/compare_counts.py'), str(dxf.with_suffix('.counts.json')), str(counts)], capture_output=True, text=True)
        (evidence / f'{sid}-compare.log').write_text(result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError(f'{sid}: model entity counts differ')
        row = {'sheet': sid, 'dxf_sha256': sha(dxf), 'dwg_sha256': sha(dwg), 'bytes': dwg.stat().st_size, 'reopen': True, 'audit_errors': 0, 'units': 4, 'model_counts_match': True, 'paper_layouts': re.findall(r'^NATIVE_LAYOUT=([^\r\n]+)', text, re.M), 'font_note': 'See convert log: substituted fonts; visual native plot review not complete.'}
        report.append(row)
        (evidence / 'report.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(row), flush=True)
    print(f'NATIVE_DWG_REOPENED_AND_COUNTED={len(report)}', flush=True)

if __name__ == '__main__':
    main()
