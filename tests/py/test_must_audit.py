"""Every PRD section 12 Must has AC/test/failure/boundary rows whose references exist (R2)."""
from tools.must_audit import audit


def test_must_audit_is_complete_and_references_exist():
    rep = audit()
    assert rep["problems"] == [], rep["problems"]
    assert len(rep["prdRequirements"]) == 12
