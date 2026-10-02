from pathlib import Path
from tools.kantor.native_dwg import verified_native_dwg

ROOT = Path(__file__).resolve().parents[2]


def test_unattested_dwg_is_rejected(tmp_path):
    p = tmp_path / 'fake.dwg'
    p.write_bytes(b'AC1032made up')
    assert not verified_native_dwg(p, tmp_path)


def test_bad_magic_is_rejected(tmp_path):
    p = tmp_path / 'fake.dwg'
    p.write_text('DXF renamed to DWG')
    assert not verified_native_dwg(p, tmp_path)


def test_changed_native_file_is_rejected(tmp_path):
    source = ROOT / 'cad/out/A-101.dwg'
    p = tmp_path / 'A-101.dwg'
    p.write_bytes(source.read_bytes() + b'changed')
    assert not verified_native_dwg(p, ROOT)


def test_native_batch_is_attested_by_reopen_logs_and_source_hashes():
    dwgs = list((ROOT / 'cad/out').glob('*.dwg'))
    if dwgs:
        assert len(dwgs) == 15
        assert all(verified_native_dwg(p, ROOT) for p in dwgs)
