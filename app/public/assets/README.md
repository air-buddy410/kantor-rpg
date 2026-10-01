# Runtime assets (generated, do not edit by hand)

All files here are written by scripts under `blender/` and validated before use; see `blender/README.md` for the rebuild order and `design/asset-registry.json` for measured size, triangles and status per asset.

| Folder | Generator | Contract |
|---|---|---|
| `characters/` | `blender/characters/build_characters.py` | origin at feet, faces glTF +Z, 13 named clips, shared 18-bone skin; CEO holds all `hair_<style>` nodes (show one) |
| `building/` | `blender/building/build_building.py` | `building-L1.glb`, `building-L2.glb` in world coordinates: world (x, y, z) maps to glTF (x, z, -y), node transforms are identity; node names `WALL-<floor>-<n>`, `OPEN-<doorId>`, `LINTEL-<doorId>`, `ROOM-<roomId>`, `SLAB-<floor>`, `STAIR-*`, `STAIRWELL-*`, `LIFT-*`, `FASCIA-*`, `ROOF` (in L2, hide for cutaway); walls are full 3.0 m height |
| `furniture/` | `blender/furniture/build_furniture.py` | one GLB per world.json catalog type, bbox = catalog [w, d, h] within 2 cm, origin footprint centre on the floor, front = glTF +Z (world -Y at rot 0); place with the fixture `pos`/`rot`; wall items carry `kantor_mount_height_m` in node extras |

Materials use the palette key names from `app/src/world/palette.ts` (furniture) or descriptive names (building, characters), so colours can be swapped by material name. Status of the building geometry: concept, not a construction model.
