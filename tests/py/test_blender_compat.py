import pytest
from tools.kantor.blender_compat import without_vertex_colors


def test_legacy_exporter_disables_vertex_colors():
    assert without_vertex_colors({'export_colors'}) == {'export_colors': False}


def test_modern_exporter_disables_vertex_colors():
    assert without_vertex_colors({'export_vertex_color'}) == {'export_vertex_color': 'NONE'}


def test_unknown_exporter_is_not_silently_accepted():
    with pytest.raises(ValueError):
        without_vertex_colors(set())
