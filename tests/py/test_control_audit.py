"""Every app control and shortcut is in the inventory and driven by an E2E spec (R2)."""
from tools.control_audit import audit


def test_no_unlisted_missing_or_untested_controls():
    rep = audit()
    assert rep["unlistedHtmlControls"] == []
    assert rep["missingInSource"] == []
    assert rep["untested"] == []
