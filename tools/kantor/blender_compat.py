"""Map the removed Blender glTF vertex-colour switch without changing output."""
def without_vertex_colors(properties):
    if 'export_colors' in properties:
        return {'export_colors': False}
    if 'export_vertex_color' in properties:
        return {'export_vertex_color': 'NONE'}
    raise ValueError('glTF exporter exposes no supported vertex-colour control')
