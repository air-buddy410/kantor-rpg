"""Authoring helper that writes design/world.json.

world.json is the single dataset read by the CAD generator, the Blender
generator, the runtime and the ICT derivation. This script is only the
editor-of-record for the seed layout: tests regenerate it and fail when the
committed JSON drifts, so the two cannot silently diverge. Office Studio
drafts are overlays and never rewrite world.json.

All dimensions are concept proposals (see assumptions AS-*), not construction
data. Coordinates: metres, origin at the south-west corner of the L1 finished
floor, X east, Y north, Z up.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "design" / "world.json"

REVISION = {"id": "P02", "date": "2026-10-01", "note": "M0 seed layout dua lantai, konsep untuk review"}

# ---------------------------------------------------------------------------
# Catalog: fixture families. size = [w (local x), d (local y), h].
# Convention: the "front" of a fixture is local -Y at rot 0; rot is CCW deg.
# slots are activity spots in local coordinates (dx, dy) with facing relative
# to the fixture front, so they rotate with the fixture.
# ---------------------------------------------------------------------------
CATALOG = {
    "desk": {"size": [1.6, 0.8, 0.75], "label": "Meja kerja + monitor", "collider": True, "family": "furniture"},
    "desk_exec": {"size": [1.8, 0.9, 0.75], "label": "Meja CEO", "collider": True, "family": "furniture"},
    "chair": {"size": [0.6, 0.6, 0.9], "label": "Kursi kerja", "collider": True, "family": "furniture",
              "slots": [{"activity": "desk", "dx": 0, "dy": 0, "pose": "sit"}]},
    "chair_guest": {"size": [0.55, 0.55, 0.85], "label": "Kursi tamu", "collider": True, "family": "furniture",
                    "slots": [{"activity": "chat", "dx": 0, "dy": 0, "pose": "sit"}]},
    "stool": {"size": [0.45, 0.45, 0.7], "label": "Bangku tinggi", "collider": True, "family": "furniture",
              "slots": [{"activity": "chat", "dx": 0, "dy": 0, "pose": "sit"}]},
    "meeting_table": {"size": [4.0, 1.4, 0.75], "label": "Meja rapat", "collider": True, "family": "furniture"},
    "round_table": {"size": [1.2, 1.2, 0.75], "label": "Meja bundar", "collider": True, "family": "furniture"},
    "high_table": {"size": [1.2, 0.7, 1.05], "label": "Meja tinggi", "collider": True, "family": "furniture"},
    "dining_table": {"size": [1.8, 0.9, 0.75], "label": "Meja makan", "collider": True, "family": "furniture"},
    "coffee_table": {"size": [1.0, 0.6, 0.4], "label": "Meja kopi", "collider": True, "family": "furniture"},
    "work_table": {"size": [1.6, 0.8, 0.9], "label": "Meja kerja berdiri", "collider": True, "family": "furniture",
                   "slots": [{"activity": "read", "dx": 0, "dy": -0.7, "pose": "stand"}]},
    "plan_table": {"size": [1.8, 0.9, 0.9], "label": "Meja denah (blueprint)", "collider": True, "family": "furniture",
                   "slots": [{"activity": "read", "dx": 0, "dy": -0.75, "pose": "stand"}],
                   "interaction": "blueprint"},
    "drafting_table": {"size": [1.4, 1.0, 0.95], "label": "Meja gambar", "collider": True, "family": "furniture",
                       "slots": [{"activity": "read", "dx": 0, "dy": -0.8, "pose": "stand"}]},
    "reception_desk": {"size": [3.0, 0.9, 1.1], "label": "Meja resepsi", "collider": True, "family": "furniture",
                       "interaction": "directory"},
    "sofa": {"size": [2.0, 0.9, 0.8], "label": "Sofa", "collider": True, "family": "furniture",
             "slots": [{"activity": "rest", "dx": -0.5, "dy": -0.05, "pose": "sit"},
                       {"activity": "rest", "dx": 0.5, "dy": -0.05, "pose": "sit"}]},
    "armchair": {"size": [0.9, 0.9, 0.85], "label": "Kursi santai", "collider": True, "family": "furniture",
                 "slots": [{"activity": "read", "dx": 0, "dy": -0.05, "pose": "sit"}]},
    "beanbag": {"size": [0.8, 0.8, 0.5], "label": "Beanbag", "collider": True, "family": "furniture",
                "slots": [{"activity": "game", "dx": 0, "dy": 0, "pose": "sit"}]},
    "bench": {"size": [1.6, 0.45, 0.45], "label": "Bangku", "collider": True, "family": "furniture",
              "slots": [{"activity": "rest", "dx": -0.4, "dy": 0, "pose": "sit"},
                        {"activity": "rest", "dx": 0.4, "dy": 0, "pose": "sit"}]},
    "bookshelf": {"size": [1.2, 0.4, 2.0], "label": "Rak buku", "collider": True, "family": "furniture",
                  "slots": [{"activity": "read", "dx": 0, "dy": -0.6, "pose": "stand"}]},
    "model_shelf": {"size": [1.2, 0.4, 1.8], "label": "Rak model", "collider": True, "family": "furniture"},
    "tool_cabinet": {"size": [1.0, 0.5, 1.2], "label": "Lemari alat", "collider": True, "family": "furniture"},
    "storage_shelf": {"size": [1.8, 0.5, 2.0], "label": "Rak gudang", "collider": True, "family": "furniture"},
    "locker": {"size": [1.2, 0.5, 1.8], "label": "Loker", "collider": True, "family": "furniture"},
    "whiteboard": {"size": [1.8, 0.1, 1.2], "label": "Papan tulis", "collider": False, "family": "signage",
                   "slots": [{"activity": "chat", "dx": 0, "dy": -0.8, "pose": "stand"}]},
    "wall_display": {"size": [1.6, 0.1, 0.95], "label": "Layar dinding", "collider": False, "family": "ict"},
    "gallery_panel": {"size": [1.5, 0.3, 2.0], "label": "Panel galeri", "collider": True, "family": "signage",
                      "slots": [{"activity": "read", "dx": 0, "dy": -0.9, "pose": "stand"}], "interaction": "artwork"},
    "poster": {"size": [0.7, 0.05, 1.0], "label": "Poster/pamflet", "collider": False, "family": "signage",
               "interaction": "artwork"},
    "directory_sign": {"size": [1.2, 0.08, 0.9], "label": "Papan direktori", "collider": False, "family": "signage",
                       "interaction": "directory"},
    "easel": {"size": [0.8, 0.8, 1.7], "label": "Easel", "collider": True, "family": "furniture",
              "slots": [{"activity": "read", "dx": 0, "dy": -0.7, "pose": "stand"}]},
    "plant_large": {"size": [0.6, 0.6, 1.6], "label": "Tanaman besar", "collider": True, "family": "plant"},
    "plant_small": {"size": [0.4, 0.4, 0.9], "label": "Tanaman kecil", "collider": True, "family": "plant"},
    "planter_box": {"size": [1.6, 0.6, 0.7], "label": "Planter", "collider": True, "family": "plant"},
    "tree_planter": {"size": [1.2, 1.2, 2.6], "label": "Pohon dalam pot", "collider": True, "family": "plant"},
    "pantry_counter": {"size": [3.0, 0.65, 0.9], "label": "Counter pantry", "collider": True, "family": "pantry",
                       "slots": [{"activity": "coffee", "dx": -0.8, "dy": -0.7, "pose": "stand"},
                                 {"activity": "coffee", "dx": 0.8, "dy": -0.7, "pose": "stand"}]},
    "coffee_bar": {"size": [2.4, 0.6, 1.0], "label": "Coffee bar", "collider": True, "family": "pantry",
                   "slots": [{"activity": "coffee", "dx": -0.6, "dy": -0.7, "pose": "stand"},
                             {"activity": "coffee", "dx": 0.6, "dy": -0.7, "pose": "stand"}], "interaction": "coffee"},
    "fridge": {"size": [0.7, 0.7, 1.8], "label": "Kulkas", "collider": True, "family": "pantry"},
    "sink": {"size": [0.6, 0.45, 0.85], "label": "Wastafel", "collider": True, "family": "sanitary"},
    "wc": {"size": [0.4, 0.7, 0.8], "label": "Kloset", "collider": True, "family": "sanitary"},
    "partition": {"size": [1.5, 0.05, 2.0], "label": "Partisi bilik", "collider": True, "family": "sanitary"},
    "shower_stall": {"size": [0.9, 0.9, 2.1], "label": "Bilik shower", "collider": True, "family": "sanitary"},
    "rack_42u": {"size": [0.6, 1.0, 2.0], "label": "Rack 42U (target)", "collider": True, "family": "ict",
                 "clearance": {"front": 1.2, "rear": 0.9}},
    "lab_bench": {"size": [1.8, 0.75, 0.9], "label": "Meja lab ICT", "collider": True, "family": "ict",
                  "slots": [{"activity": "desk", "dx": 0, "dy": -0.7, "pose": "stand"}]},
    "lab_rack_open": {"size": [0.6, 0.6, 1.2], "label": "Rack lab terbuka 12U", "collider": True, "family": "ict"},
    "billiard_table": {"size": [2.84, 1.57, 0.8], "label": "Meja biliar 9 ft", "collider": True, "family": "recreation",
                       "clearance": {"cue": 1.47, "playing": [2.54, 1.27]},
                       "slots": [{"activity": "billiards", "dx": -1.75, "dy": 0, "pose": "stand", "facingRel": 90},
                                 {"activity": "billiards", "dx": 1.75, "dy": 0, "pose": "stand", "facingRel": -90}],
                       "interaction": "billiards"},
    "cue_rack": {"size": [0.6, 0.12, 1.4], "label": "Rak stik", "collider": False, "family": "recreation"},
    "media_console": {"size": [2.0, 0.5, 1.6], "label": "Konsol game + layar", "collider": True, "family": "recreation",
                      "interaction": "game"},
    "arcade_cabinet": {"size": [0.75, 0.85, 1.8], "label": "Kabinet arcade", "collider": True, "family": "recreation",
                       "slots": [{"activity": "game", "dx": 0, "dy": -0.75, "pose": "stand"}], "interaction": "game"},
    "board_table": {"size": [1.2, 1.2, 0.75], "label": "Meja board game", "collider": True, "family": "recreation"},
    "treadmill": {"size": [0.9, 2.0, 1.4], "label": "Treadmill", "collider": True, "family": "sport",
                  "slots": [{"activity": "exercise", "dx": 0, "dy": 0.2, "pose": "stand", "facingRel": 180}],
                  "interaction": "exercise"},
    "exercise_bike": {"size": [0.6, 1.2, 1.2], "label": "Sepeda statis", "collider": True, "family": "sport",
                      "slots": [{"activity": "exercise", "dx": 0, "dy": 0.1, "pose": "sit", "facingRel": 180}],
                      "interaction": "exercise"},
    "exercise_mat": {"size": [1.8, 0.6, 0.02], "label": "Matras", "collider": False, "family": "sport",
                     "slots": [{"activity": "stretch", "dx": 0, "dy": 0, "pose": "stand"}]},
    "dumbbell_rack": {"size": [1.2, 0.5, 0.9], "label": "Rak dumbbell", "collider": True, "family": "sport"},
    "stair_u": {"size": [2.6, 4.4, 4.0], "label": "Tangga U (konsep)", "collider": True, "family": "shell"},
    "lift": {"size": [1.9, 2.2, 3.0], "label": "Lift (konsep)", "collider": True, "family": "shell"},
}

# Occupant-load comparison factors (m2 per person). Source: IBC 2021 Table
# 1004.5 values converted from ft2; used only as a comparison benchmark, not
# as the governing Indonesian regulation (AS-OCC-01).
FT2 = 0.09290304

ROOM_META = {
    # id: (name, category, access, noise, function, loadKey, finish key)
    "L1-MEET": ("Ruang rapat besar", "work", "public", "moderate", "Rapat tim dan tamu, presentasi", "assembly_tables", "carpet"),
    "L1-LOBBY": ("Lobby & resepsi", "public", "public", "moderate", "Kedatangan, resepsi, titik spawn CEO", "business", "vinyl_wood"),
    "L1-GALLERY": ("Galeri portofolio", "public", "public", "quiet", "Pameran karya tim (artwork original)", "business", "vinyl_wood"),
    "L1-PANTRY": ("Pantry kerja", "wet", "staff", "moderate", "Kopi/air untuk area kerja", "business", "ceramic"),
    "L1-SHAFT-W": ("Shaft basah", "shaft", "restricted", "quiet", "Shaft plumbing (konsep, belum desain MEP)", None, "none"),
    "L1-WC": ("Toilet aksesibel", "wet", "public", "quiet", "Toilet + wastafel; aksesibilitas perlu kajian", None, "ceramic"),
    "L1-CORR": ("Koridor utama L1", "circulation", "public", "moderate", "Sirkulasi timur-barat, dua pintu keluar konsep", None, "vinyl_wood"),
    "L1-DISC": ("Ruang diskusi", "quiet", "staff", "quiet", "Diskusi kecil 4 orang", "assembly_tables", "carpet"),
    "L1-IMPL": ("Ruang implementasi & review", "work", "staff", "moderate", "Workstation implementasi/review (Rex, Max)", "business", "carpet"),
    "L1-CORE": ("Inti tangga & lift L1", "circulation", "public", "moderate", "Tangga U dan lift konsep ke L2", None, "vinyl_wood"),
    "L1-NOVA": ("Area Nova (spesifikasi ICT)", "work", "staff", "quiet", "Spesifikasi ICT, meja denah", "business", "carpet"),
    "L1-LAB": ("Lab ICT", "work", "staff", "moderate", "Bench uji perangkat virtual, terpisah dari server", "business", "vinyl_esd"),
    "L1-NCORR": ("Koridor utara L1", "circulation", "staff", "moderate", "Akses sayap kerja tenang", None, "vinyl_wood"),
    "L1-CEO": ("Ruang CEO", "quiet", "staff", "quiet", "Ruang Budi (CEO)", "business", "carpet"),
    "L1-HUGO": ("Studio Hugo", "work", "staff", "quiet", "Karakter, aset, arsitektur/interior", "business", "vinyl_wood"),
    "L1-KEVIN": ("Studio Kevin", "work", "staff", "quiet", "Pamflet, signage, artwork", "business", "vinyl_wood"),
    "L1-BRUNO": ("Area Bruno", "work", "staff", "moderate", "Instalasi jaringan/server/workstation", "business", "vinyl_esd"),
    "L1-SERVER": ("Ruang server", "restricted", "restricted", "moderate", "Rack virtual; akses terbatas, bukan jalur umum", "storage", "vinyl_esd"),
    "L1-RISER": ("Riser ICT", "shaft", "restricted", "quiet", "Riser kabel vertikal L1-L2", None, "none"),
    "L1-STORE": ("Gudang & utilitas", "service", "staff", "quiet", "Gudang, panel utilitas (konsep)", "storage", "epoxy"),
    "L2-READ": ("Perpustakaan / reading nook", "quiet", "staff", "quiet", "Baca tenang", "library", "carpet"),
    "L2-LOUNGE": ("Lounge & coffee bar", "recreation", "staff", "moderate", "Santai, kopi, ngobrol", "assembly_tables", "vinyl_wood"),
    "L2-DINE": ("Ruang makan & pantry", "recreation", "staff", "moderate", "Makan bersama, pantry", "assembly_tables", "ceramic"),
    "L2-SHOWER": ("Shower & ruang ganti", "wet", "staff", "quiet", "Shower; tanpa kamera (privasi)", None, "ceramic"),
    "L2-SHAFT-W": ("Shaft basah L2", "shaft", "restricted", "quiet", "Lanjutan shaft basah", None, "none"),
    "L2-WC": ("Toilet L2", "wet", "staff", "quiet", "Toilet + wastafel", None, "ceramic"),
    "L2-CORR": ("Koridor utama L2", "circulation", "staff", "moderate", "Sirkulasi rekreasi", None, "vinyl_wood"),
    "L2-CHAT": ("Diskusi santai", "quiet", "staff", "quiet", "Ngobrol santai, jauh dari game", "assembly_tables", "carpet"),
    "L2-GARDEN": ("Taman dalam", "recreation", "staff", "quiet", "Penyangga akustik hijau antara area tenang dan ramai", "assembly_tables", "deck"),
    "L2-CORE": ("Inti tangga & lift L2", "circulation", "staff", "moderate", "Kedatangan dari L1", None, "vinyl_wood"),
    "L2-GAME": ("Ruang game", "recreation", "staff", "loud", "Konsol, arcade, board game", "assembly_tables", "vinyl_wood"),
    "L2-NCORR": ("Koridor utara L2", "circulation", "staff", "moderate", "Akses biliar, gym, balkon", None, "vinyl_wood"),
    "L2-BALCONY": ("Balkon taman", "outdoor", "staff", "moderate", "Teras semi-terbuka, tanaman", "assembly_tables", "deck"),
    "L2-BILLIARD": ("Ruang biliar", "recreation", "staff", "loud", "Meja biliar 9 ft + clearance stik", "assembly_tables", "carpet"),
    "L2-GYM": ("Ruang olahraga", "recreation", "staff", "loud", "Treadmill, sepeda, matras", "exercise", "rubber"),
    "L2-STORE": ("Gudang L2", "service", "staff", "quiet", "Perlengkapan rekreasi", "storage", "epoxy"),
    "L2-RISER": ("Riser ICT L2", "shaft", "restricted", "quiet", "Lanjutan riser", None, "none"),
    "L2-SERVICE": ("Area servis L2", "service", "staff", "quiet", "Kebersihan, utilitas", "storage", "epoxy"),
}

FINISHES = {
    "carpet": {"floor": "karpet tile matte", "wall": "cat matte krem", "ceiling": "akustik panel"},
    "vinyl_wood": {"floor": "vinyl motif kayu", "wall": "cat matte krem + panel kayu", "ceiling": "gypsum"},
    "vinyl_esd": {"floor": "vinyl anti-statik (target)", "wall": "cat matte", "ceiling": "gypsum + akses tray"},
    "ceramic": {"floor": "keramik anti-slip", "wall": "keramik dinding", "ceiling": "gypsum tahan lembab"},
    "deck": {"floor": "deck komposit", "wall": "panel tanaman", "ceiling": "terbuka/pergola"},
    "rubber": {"floor": "lantai karet olahraga", "wall": "cat matte", "ceiling": "akustik panel"},
    "epoxy": {"floor": "epoxy", "wall": "cat matte", "ceiling": "gypsum"},
    "none": {"floor": "-", "wall": "-", "ceiling": "-"},
}

LOAD_FACTORS = {
    "business": {"m2": round(150 * FT2, 2), "basis": "gross", "label": "Business areas 150 ft2 gross"},
    "assembly_tables": {"m2": round(15 * FT2, 2), "basis": "net", "label": "Assembly unconcentrated (tables and chairs) 15 ft2 net"},
    "library": {"m2": round(50 * FT2, 2), "basis": "net", "label": "Library reading rooms 50 ft2 net"},
    "exercise": {"m2": round(50 * FT2, 2), "basis": "gross", "label": "Exercise rooms 50 ft2 gross"},
    "storage": {"m2": round(300 * FT2, 2), "basis": "gross", "label": "Storage/mechanical 300 ft2 gross"},
}


def rect(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


ROOMS_GEOM = {
    # Floor 1 (kerja & kunjungan)
    "L1-MEET": rect(0, 0, 8, 8), "L1-LOBBY": rect(8, 0, 20, 8), "L1-GALLERY": rect(20, 0, 26, 8),
    "L1-PANTRY": rect(26, 0, 29.5, 8), "L1-SHAFT-W": rect(29.5, 0, 32, 1), "L1-WC": rect(29.5, 1, 32, 8),
    "L1-CORR": rect(0, 8, 32, 10.5),
    "L1-DISC": rect(0, 10.5, 6, 16.5), "L1-IMPL": rect(6, 10.5, 14, 16.5), "L1-CORE": rect(14, 10.5, 20, 16.5),
    "L1-NOVA": rect(20, 10.5, 26, 16.5), "L1-LAB": rect(26, 10.5, 32, 16.5),
    "L1-NCORR": rect(0, 16.5, 32, 18.5),
    "L1-CEO": rect(0, 18.5, 7, 24), "L1-HUGO": rect(7, 18.5, 14, 24), "L1-KEVIN": rect(14, 18.5, 20, 24),
    "L1-BRUNO": rect(20, 18.5, 25, 24), "L1-SERVER": rect(25, 18.5, 29, 24), "L1-RISER": rect(29, 18.5, 30, 20),
    "L1-STORE": [[29, 20], [30, 20], [30, 18.5], [32, 18.5], [32, 24], [29, 24]],
    # Floor 2 (rekreasi)
    "L2-READ": rect(0, 0, 8, 8), "L2-LOUNGE": rect(8, 0, 20, 8), "L2-DINE": rect(20, 0, 26, 8),
    "L2-SHOWER": rect(26, 0, 29.5, 8), "L2-SHAFT-W": rect(29.5, 0, 32, 1), "L2-WC": rect(29.5, 1, 32, 8),
    "L2-CORR": rect(0, 8, 32, 10.5),
    "L2-CHAT": rect(0, 10.5, 6, 16.5), "L2-GARDEN": rect(6, 10.5, 14, 16.5), "L2-CORE": rect(14, 10.5, 20, 16.5),
    "L2-GAME": rect(20, 10.5, 32, 16.5),
    "L2-NCORR": rect(0, 16.5, 32, 18.5),
    "L2-BALCONY": rect(0, 18.5, 7, 24), "L2-BILLIARD": rect(7, 18.5, 14, 24), "L2-GYM": rect(14, 18.5, 23, 24),
    "L2-STORE": rect(23, 18.5, 29, 24), "L2-RISER": rect(29, 18.5, 30, 20),
    "L2-SERVICE": [[29, 20], [30, 20], [30, 18.5], [32, 18.5], [32, 24], [29, 24]],
}

ICT_PROFILE = {
    "L1-MEET": ["layar dinding", "outlet meja rapat", "AP coverage"], "L1-LOBBY": ["outlet resepsi", "papan direktori", "AP", "kamera konsep pintu masuk"],
    "L1-GALLERY": ["outlet display galeri"], "L1-IMPL": ["2 port per workstation", "layar review", "AP"],
    "L1-NOVA": ["2 port per workstation"], "L1-LAB": ["4 port per bench", "rack lab terbuka (bukan produksi)"],
    "L1-CEO": ["2 port meja CEO"], "L1-HUGO": ["2 port per workstation"], "L1-KEVIN": ["2 port per workstation"],
    "L1-BRUNO": ["2 port workstation"], "L1-SERVER": ["2 rack 42U target", "UPS (rating TBD)", "patch panel"],
    "L1-RISER": ["riser kabel ke L2"], "L1-CORR": ["AP", "kamera konsep koridor"], "L1-NCORR": ["AP", "kamera konsep pintu server"],
    "L2-LOUNGE": ["AP"], "L2-DINE": ["AP", "signage display"], "L2-GAME": ["2 port per konsol", "1 port per arcade", "AP"],
    "L2-GYM": ["AP", "layar olahraga"], "L2-BILLIARD": ["layar skor"], "L2-CORR": ["AP", "kamera konsep koridor"],
    "L2-NCORR": ["AP"], "L2-RISER": ["riser kabel dari L1"],
    "L2-SHOWER": ["tidak ada kamera (privasi)"], "L2-WC": ["tidak ada kamera (privasi)"], "L1-WC": ["tidak ada kamera (privasi)"],
}

ADJACENCY_RULES = [
    {"id": "ADJ-01", "rule": "near", "a": "L1-LOBBY", "b": "EXT-ENTRANCE", "text": "Resepsi dekat entrance"},
    {"id": "ADJ-02", "rule": "visitor_path_avoids", "a": "L1-LOBBY", "b": "L1-MEET", "avoid": ["L1-SERVER", "L1-RISER"], "text": "Rapat dicapai visitor tanpa melewati server"},
    {"id": "ADJ-03", "rule": "max_path", "a": "L1-BRUNO", "b": "L1-SERVER", "max_m": 6.0, "text": "Bruno dekat rack, akses rack terbatas"},
    {"id": "ADJ-04", "rule": "max_path", "a": "L1-BRUNO", "b": "L1-LAB", "max_m": 12.0, "text": "Bruno dekat lab ICT"},
    {"id": "ADJ-05", "rule": "min_distance", "a": "L1-SERVER", "b_category": "wet", "min_m": 8.0, "text": "Ruang basah jauh dari rack"},
    {"id": "ADJ-06", "rule": "not_shared_wall", "a_noise": "loud", "b_noise": "quiet", "b_exclude_categories": ["service", "shaft", "restricted"], "text": "Game/biliar/gym tidak berbagi dinding dengan area tenang"},
    {"id": "ADJ-07", "rule": "stacked", "a": "L1-WC", "b": "L2-WC", "text": "Area basah ditumpuk (konsep shaft)"},
    {"id": "ADJ-08", "rule": "stacked", "a": "L1-PANTRY", "b": "L2-SHOWER", "text": "Pantry L1 di bawah shower L2 (zona basah)"},
    {"id": "ADJ-09", "rule": "restricted_door_only_from", "a": "L1-SERVER", "allowed": ["L1-BRUNO"], "text": "Pintu server hanya dari area Bruno"},
    {"id": "ADJ-10", "rule": "exits", "floor": "L1", "min_count": 2, "text": "Dua jalur keluar konsep L1 (perlu kajian profesional)"},
]

ASSUMPTIONS = [
    {"id": "AS-DIM-01", "topic": "dimensi", "text": "Footprint 32 m x 24 m per lantai dan tinggi antar lantai 4,0 m adalah proposal PRD, bukan luas lahan yang disahkan."},
    {"id": "AS-DIM-02", "topic": "dimensi", "text": "Polygon ruang diukur pada garis as dinding; luas adalah luas as-drawn, bukan luas bersih/usable."},
    {"id": "AS-DIM-03", "topic": "dimensi", "text": "Tebal dinding konsep: luar 0,30 m, dalam 0,15 m; plafon 3,0 m; slab 0,30 m. Belum ada desain struktur."},
    {"id": "AS-DIM-04", "topic": "dimensi", "text": "Ukuran furniture dari catalog adalah target konsep (bukan katalog vendor). Meja biliar 9 ft memakai luas main 2,54 x 1,27 m dan clearance stik 1,47 m sebagai target ukuran umum, wajib dicek ulang ke spesifikasi produk."},
    {"id": "AS-DIM-05", "topic": "dimensi", "text": "Tangga U: 24 riser x 0,1667 m, tread 0,28 m, lebar flight 1,2 m. Target konsep game; tidak menyatakan tangga layak konstruksi."},
    {"id": "AS-OCC-01", "topic": "okupansi", "text": "Faktor beban hunian memakai IBC 2021 Table 1004.5 sebagai pembanding, bukan regulasi Indonesia yang berlaku. Perhitungan egress resmi butuh profesional."},
    {"id": "AS-OCC-02", "topic": "okupansi", "text": "Kapasitas kursi dihitung dari fixture; bukan target okupansi manusia yang diputuskan Budi."},
    {"id": "AS-EXIT-01", "topic": "keselamatan", "text": "Tangga darurat timur L2 hanya penanda konsep di luar envelope; jalur keluar belum dinilai memenuhi peraturan."},
    {"id": "AS-ICT-01", "topic": "ict", "text": "Jumlah AP adalah placeholder; belum ada model site/material dan target coverage. Tidak ada radius Wi-Fi efektif yang diklaim."},
    {"id": "AS-ICT-02", "topic": "ict", "text": "Slack kabel: 3,0 m sisi rack + 0,3 m sisi outlet; tray pada 3,2 m di atas lantai jadi; outlet meja 0,3 m; outlet plafon 3,0 m. Asumsi proyek, bukan standar."},
    {"id": "AS-ICT-03", "topic": "ict", "text": "Batas panjang permanent link 90 m dipakai sebagai target konsep (praktik umum kabel tembaga terstruktur), wajib diverifikasi ke standar yang dipilih."},
    {"id": "AS-ICT-04", "topic": "ict", "text": "Daya PoE worst-case per kelas memakai nilai PSE IEEE 802.3af/at/bt (Class 3 = 15,4 W, Class 4 = 30 W). Kelas perangkat placeholder sampai datasheet dipilih."},
    {"id": "AS-ICT-05", "topic": "ict", "text": "Rating UPS, thermal/AC dan harga belum ditentukan; tidak ada harga pengadaan dalam paket ini."},
    {"id": "AS-ICT-06", "topic": "ict", "text": "Clearance rack depan 1,2 m / belakang 0,9 m adalah target konsep; verifikasi ke standar/panduan yang dipilih."},
    {"id": "AS-NET-01", "topic": "ict", "text": "Domain jaringan office/demo/guest/lab/server adalah ID abstrak; bukan subnet, VLAN atau perangkat produksi."},
    {"id": "AS-PERF-01", "topic": "performa", "text": "Target FPS/transfer/triangle adalah target PRD; angka hanya disebut terukur setelah benchmark tercatat."},
    {"id": "AS-SITE-01", "topic": "lahan", "text": "Lahan fisik, lokasi, budget, hosting dan okupansi manusia belum diputuskan."},
]


class Builder:
    def __init__(self):
        self.fixtures = []
        self.counter = {"L1": 0, "L2": 0}

    def fx(self, room, kind, x, y, rot=0, **extra):
        floor = room[:2]
        self.counter[floor] += 1
        fid = f"FX-{floor}-{self.counter[floor]:03d}"
        cat = CATALOG[kind]
        rec = {"id": fid, "floor": floor, "room": room, "type": kind, "asset": f"AST-{kind.upper().replace('_', '-')}",
               "pos": [round(x, 3), round(y, 3)], "rot": rot, "size": cat["size"], "collider": cat["collider"]}
        rec.update(extra)
        self.fixtures.append(rec)
        return fid

    def ws(self, room, x, y, rot=0, desk="desk", **extra):
        """Desk + chair; the chair sits 0.75 m in front of the desk front edge."""
        d = self.fx(room, desk, x, y, rot, **extra)
        r = math.radians(rot)
        off = 0.75 if desk == "desk" else 0.85
        cx, cy = x + off * math.sin(r), y - off * math.cos(r)
        c = self.fx(room, "chair", cx, cy, (rot + 180) % 360, pairedWith=d)
        return d, c


def seed_fixtures():
    b = Builder()
    f = b.fx
    # ---------------- L1 ----------------
    # Lobby
    f("L1-LOBBY", "reception_desk", 14, 5.0, 0)
    f("L1-LOBBY", "chair", 14, 5.85, 180)
    f("L1-LOBBY", "sofa", 9.0, 2.0, 270)
    f("L1-LOBBY", "coffee_table", 10.3, 2.0, 90)
    f("L1-LOBBY", "sofa", 18.6, 1.8, 90)
    f("L1-LOBBY", "plant_large", 8.6, 0.6)
    f("L1-LOBBY", "plant_large", 19.4, 0.6)
    f("L1-LOBBY", "plant_large", 8.6, 7.4)
    f("L1-LOBBY", "directory_sign", 11.5, 7.88, 0)
    f("L1-LOBBY", "poster", 19.9, 6.0, 270, artwork="ART-01")
    # Meeting
    f("L1-MEET", "meeting_table", 4.0, 4.2, 0)
    for x in (2.5, 3.5, 4.5, 5.5):
        f("L1-MEET", "chair", x, 3.15, 180)
        f("L1-MEET", "chair", x, 5.25, 0)
    f("L1-MEET", "chair", 1.55, 4.2, 90)
    f("L1-MEET", "chair", 6.45, 4.2, 270)
    f("L1-MEET", "wall_display", 0.2, 4.2, 90)
    f("L1-MEET", "whiteboard", 6.4, 7.88, 0)
    f("L1-MEET", "plant_small", 0.5, 0.5)
    f("L1-MEET", "plant_small", 7.5, 0.5)
    # Gallery
    f("L1-GALLERY", "gallery_panel", 21.5, 0.3, 180, artwork="ART-02")
    f("L1-GALLERY", "gallery_panel", 24.3, 0.3, 180, artwork="ART-03")
    f("L1-GALLERY", "gallery_panel", 25.7, 3.0, 270, artwork="ART-04")
    f("L1-GALLERY", "gallery_panel", 25.7, 5.6, 270, artwork="ART-05")
    f("L1-GALLERY", "bench", 23.2, 3.6, 0)
    f("L1-GALLERY", "gallery_panel", 23.2, 6.2, 0, artwork="ART-06")
    f("L1-GALLERY", "plant_small", 20.5, 7.5)
    # Pantry
    f("L1-PANTRY", "pantry_counter", 27.75, 0.5, 180)
    f("L1-PANTRY", "fridge", 29.05, 2.2, 270)
    f("L1-PANTRY", "high_table", 27.4, 4.6, 0)
    f("L1-PANTRY", "stool", 27.0, 3.95, 180)
    f("L1-PANTRY", "stool", 27.8, 5.25, 0)
    # WC
    f("L1-WC", "wc", 31.45, 2.2, 270)
    f("L1-WC", "sink", 29.85, 4.4, 90)
    f("L1-WC", "partition", 31.1, 5.4, 0)
    f("L1-WC", "wc", 31.45, 6.4, 270)
    # Corridor
    f("L1-CORR", "plant_small", 1.0, 8.4)
    f("L1-CORR", "plant_small", 31.0, 10.1)
    f("L1-CORR", "poster", 8.0, 10.4, 180, artwork="ART-07")
    # Discussion
    f("L1-DISC", "round_table", 3.0, 13.6)
    f("L1-DISC", "chair_guest", 3.0, 12.7, 180)
    f("L1-DISC", "chair_guest", 3.0, 14.5, 0)
    f("L1-DISC", "chair_guest", 2.1, 13.6, 90)
    f("L1-DISC", "chair_guest", 3.9, 13.6, 270)
    f("L1-DISC", "whiteboard", 3.0, 16.38, 0)
    f("L1-DISC", "bookshelf", 0.38, 12.2, 90)
    f("L1-DISC", "plant_small", 5.5, 11.0)
    # Implementation / review
    for x in (8.0, 9.6, 11.2):
        b.ws("L1-IMPL", x, 13.2, 0)
        b.ws("L1-IMPL", x, 15.95, 0)
    f("L1-IMPL", "wall_display", 13.88, 13.6, 270)
    f("L1-IMPL", "plant_small", 6.5, 11.0)
    # Core: stair + lift (vertical links)
    f("L1-CORE", "stair_u", 15.5, 14.1, 0, verticalLink="VL-STAIR-A")
    f("L1-CORE", "lift", 18.875, 15.3, 0, verticalLink="VL-LIFT-A")
    # Nova
    b.ws("L1-NOVA", 21.6, 15.95, 0)
    b.ws("L1-NOVA", 24.4, 15.95, 0)
    f("L1-NOVA", "plan_table", 23.0, 13.0, 0)
    f("L1-NOVA", "bookshelf", 25.7, 12.4, 270)
    # Lab
    f("L1-LAB", "lab_bench", 31.45, 12.5, 270)
    f("L1-LAB", "lab_bench", 31.45, 14.6, 270)
    f("L1-LAB", "lab_bench", 28.4, 13.2, 0)
    f("L1-LAB", "stool", 28.4, 12.5, 180)
    f("L1-LAB", "lab_rack_open", 26.6, 15.9, 0)
    # North corridor
    f("L1-NCORR", "plant_small", 13.0, 17.0)
    f("L1-NCORR", "poster", 20.0, 18.4, 180, artwork="ART-08")
    # CEO
    b.ws("L1-CEO", 3.5, 22.2, 180, desk="desk_exec")
    f("L1-CEO", "chair_guest", 3.0, 21.05, 180)
    f("L1-CEO", "chair_guest", 4.0, 21.05, 180)
    f("L1-CEO", "sofa", 6.45, 20.6, 90)
    f("L1-CEO", "bookshelf", 0.38, 21.2, 90)
    f("L1-CEO", "plant_large", 0.6, 23.4)
    # Hugo
    b.ws("L1-HUGO", 8.6, 23.4, 0)
    b.ws("L1-HUGO", 10.4, 23.4, 0)
    f("L1-HUGO", "drafting_table", 12.8, 21.2, 270)
    f("L1-HUGO", "model_shelf", 7.3, 20.4, 90)
    f("L1-HUGO", "plant_small", 13.5, 23.5)
    # Kevin
    b.ws("L1-KEVIN", 16.0, 23.4, 0)
    f("L1-KEVIN", "easel", 18.7, 22.6, 0)
    f("L1-KEVIN", "work_table", 16.6, 20.8, 0)
    f("L1-KEVIN", "poster", 19.9, 20.5, 270, artwork="ART-09")
    # Bruno
    b.ws("L1-BRUNO", 22.4, 23.4, 0)
    f("L1-BRUNO", "tool_cabinet", 20.35, 21.3, 90)
    f("L1-BRUNO", "plant_small", 24.5, 19.0)
    # Server
    f("L1-SERVER", "rack_42u", 26.4, 22.4, 0, ictRack="RK-L1-01")
    f("L1-SERVER", "rack_42u", 27.0, 22.4, 0, ictRack="RK-L1-02")
    # Store
    f("L1-STORE", "storage_shelf", 30.5, 23.6, 0)
    f("L1-STORE", "storage_shelf", 31.6, 21.4, 270)

    # ---------------- L2 ----------------
    # Reading
    for y in (2.0, 4.0, 6.0):
        f("L2-READ", "bookshelf", 0.38, y, 90)
    f("L2-READ", "armchair", 2.6, 2.5, 270)
    f("L2-READ", "armchair", 2.6, 5.5, 270)
    f("L2-READ", "coffee_table", 4.2, 4.0, 90)
    f("L2-READ", "bench", 5.5, 0.45, 180)
    f("L2-READ", "plant_large", 7.4, 7.4)
    f("L2-READ", "plant_small", 7.5, 0.5)
    # Lounge
    f("L2-LOUNGE", "sofa", 11.0, 0.6, 180)
    f("L2-LOUNGE", "sofa", 8.6, 3.0, 270)
    f("L2-LOUNGE", "coffee_table", 11.0, 2.4, 0)
    f("L2-LOUNGE", "armchair", 12.8, 3.4, 90)
    f("L2-LOUNGE", "coffee_bar", 16.5, 0.5, 180)
    f("L2-LOUNGE", "beanbag", 15.0, 3.6, 0)
    f("L2-LOUNGE", "beanbag", 16.4, 3.8, 0)
    f("L2-LOUNGE", "high_table", 12.0, 6.2, 0)
    f("L2-LOUNGE", "stool", 11.6, 5.55, 180)
    f("L2-LOUNGE", "stool", 12.4, 6.85, 0)
    f("L2-LOUNGE", "plant_large", 19.4, 0.6)
    f("L2-LOUNGE", "poster", 8.1, 6.0, 90, artwork="ART-10")
    # Dining
    for ty in (2.4, 5.6):
        f("L2-DINE", "dining_table", 22.2, ty, 0)
        for x in (21.7, 22.7):
            f("L2-DINE", "chair", x, ty - 0.75, 180)
            f("L2-DINE", "chair", x, ty + 0.75, 0)
    f("L2-DINE", "pantry_counter", 25.6, 3.0, 270)
    f("L2-DINE", "fridge", 25.55, 5.5, 270)
    f("L2-DINE", "wall_display", 20.12, 6.6, 90)
    # Shower
    for x in (26.65, 27.75, 28.85):
        f("L2-SHOWER", "shower_stall", x, 0.62, 180)
    f("L2-SHOWER", "bench", 27.75, 3.6, 0)
    f("L2-SHOWER", "locker", 29.15, 5.6, 270)
    # WC
    f("L2-WC", "wc", 31.45, 2.2, 270)
    f("L2-WC", "sink", 29.85, 4.4, 90)
    f("L2-WC", "partition", 31.1, 5.4, 0)
    f("L2-WC", "wc", 31.45, 6.4, 270)
    # Corridor
    f("L2-CORR", "plant_small", 1.0, 8.4)
    f("L2-CORR", "poster", 22.0, 10.4, 180, artwork="ART-11")
    # Chat
    f("L2-CHAT", "sofa", 3.0, 15.95, 0)
    f("L2-CHAT", "armchair", 1.3, 13.6, 90)
    f("L2-CHAT", "armchair", 4.7, 13.6, 270)
    f("L2-CHAT", "coffee_table", 3.0, 14.2, 0)
    f("L2-CHAT", "plant_small", 0.5, 11.0)
    # Garden
    f("L2-GARDEN", "planter_box", 6.9, 12.6, 90)
    f("L2-GARDEN", "planter_box", 6.9, 15.0, 90)
    f("L2-GARDEN", "planter_box", 10.0, 16.05, 0)
    f("L2-GARDEN", "tree_planter", 12.6, 13.8)
    f("L2-GARDEN", "bench", 10.0, 13.6, 180)
    # Core
    f("L2-CORE", "stair_u", 15.5, 14.1, 0, verticalLink="VL-STAIR-A")
    f("L2-CORE", "lift", 18.875, 15.3, 0, verticalLink="VL-LIFT-A")
    # Game
    f("L2-GAME", "media_console", 23.0, 16.15, 0)
    f("L2-GAME", "beanbag", 22.4, 14.6, 180)
    f("L2-GAME", "beanbag", 23.6, 14.6, 180)
    f("L2-GAME", "media_console", 28.6, 16.15, 0)
    f("L2-GAME", "beanbag", 28.0, 14.6, 180)
    f("L2-GAME", "beanbag", 29.2, 14.6, 180)
    f("L2-GAME", "arcade_cabinet", 31.4, 11.6, 270)
    f("L2-GAME", "arcade_cabinet", 31.4, 12.5, 270)
    f("L2-GAME", "board_table", 26.0, 12.6)
    for dx, dy, r in ((0, -0.85, 180), (0, 0.85, 0), (-0.85, 0, 90), (0.85, 0, 270)):
        f("L2-GAME", "stool", 26.0 + dx, 12.6 + dy, r)
    # North corridor
    f("L2-NCORR", "plant_small", 13.0, 17.0)
    # Balcony
    f("L2-BALCONY", "planter_box", 2.0, 23.5, 0)
    f("L2-BALCONY", "planter_box", 5.0, 23.5, 0)
    f("L2-BALCONY", "planter_box", 0.48, 21.0, 90)
    f("L2-BALCONY", "bench", 3.5, 21.6, 180)
    f("L2-BALCONY", "round_table", 5.2, 20.4)
    # Billiard
    f("L2-BILLIARD", "billiard_table", 10.5, 21.4, 0)
    f("L2-BILLIARD", "cue_rack", 13.85, 22.6, 270)
    f("L2-BILLIARD", "wall_display", 7.12, 21.4, 90)
    # Gym
    f("L2-GYM", "treadmill", 15.2, 22.6, 180)
    f("L2-GYM", "treadmill", 16.6, 22.6, 180)
    f("L2-GYM", "exercise_bike", 18.2, 23.0, 180)
    f("L2-GYM", "exercise_mat", 20.6, 20.8, 0)
    f("L2-GYM", "exercise_mat", 20.6, 21.8, 0)
    f("L2-GYM", "dumbbell_rack", 22.6, 20.4, 270)
    f("L2-GYM", "bench", 21.0, 23.4, 0)
    f("L2-GYM", "wall_display", 14.12, 20.4, 90)
    # Store / service
    f("L2-STORE", "storage_shelf", 26.0, 23.6, 0)
    f("L2-STORE", "storage_shelf", 28.6, 21.4, 270)
    f("L2-SERVICE", "sink", 31.6, 22.0, 270)
    f("L2-SERVICE", "storage_shelf", 30.5, 23.6, 0)
    return b.fixtures


DOORS = [
    # id, floor, rooms, center, width, type, access, exit
    ("D-L1-ENT", "L1", ["EXT", "L1-LOBBY"], [14, 0], 2.0, "double", "public", True),
    ("D-L1-01", "L1", ["L1-LOBBY", "L1-CORR"], [17, 8], 3.0, "opening", "public", False),
    ("D-L1-02", "L1", ["L1-LOBBY", "L1-MEET"], [8, 4], 1.8, "double", "public", False),
    ("D-L1-03", "L1", ["L1-MEET", "L1-CORR"], [4, 8], 1.0, "single", "public", False),
    ("D-L1-04", "L1", ["L1-LOBBY", "L1-GALLERY"], [20, 4], 2.4, "opening", "public", False),
    ("D-L1-05", "L1", ["L1-GALLERY", "L1-CORR"], [23, 8], 1.0, "single", "public", False),
    ("D-L1-06", "L1", ["L1-PANTRY", "L1-CORR"], [27.75, 8], 1.0, "single", "staff", False),
    ("D-L1-07", "L1", ["L1-WC", "L1-CORR"], [30.75, 8], 1.0, "single", "public", False),
    ("D-L1-08", "L1", ["L1-WC", "L1-SHAFT-W"], [30.75, 1], 0.6, "hatch", "restricted", False),
    ("D-L1-EXW", "L1", ["EXT", "L1-CORR"], [0, 9.25], 1.2, "single", "public", True),
    ("D-L1-EXE", "L1", ["EXT", "L1-CORR"], [32, 9.25], 1.2, "single", "public", True),
    ("D-L1-09", "L1", ["L1-CORR", "L1-DISC"], [3, 10.5], 1.0, "single", "staff", False),
    ("D-L1-10", "L1", ["L1-CORR", "L1-IMPL"], [10, 10.5], 1.0, "single", "staff", False),
    ("D-L1-11", "L1", ["L1-CORR", "L1-CORE"], [18.4, 10.5], 2.4, "opening", "public", False),
    ("D-L1-12", "L1", ["L1-CORR", "L1-NOVA"], [23, 10.5], 1.0, "single", "staff", False),
    ("D-L1-13", "L1", ["L1-CORR", "L1-LAB"], [29, 10.5], 1.0, "single", "staff", False),
    ("D-L1-14", "L1", ["L1-CORE", "L1-NCORR"], [17.35, 16.5], 1.0, "single", "staff", False),
    ("D-L1-22", "L1", ["L1-LAB", "L1-NCORR"], [28, 16.5], 1.0, "single", "staff", False),
    ("D-L1-EXN", "L1", ["EXT", "L1-NCORR"], [0, 17.5], 1.2, "single", "staff", True),
    ("D-L1-15", "L1", ["L1-NCORR", "L1-CEO"], [3.5, 18.5], 1.0, "single", "staff", False),
    ("D-L1-16", "L1", ["L1-NCORR", "L1-HUGO"], [10.5, 18.5], 1.0, "single", "staff", False),
    ("D-L1-17", "L1", ["L1-NCORR", "L1-KEVIN"], [17, 18.5], 1.0, "single", "staff", False),
    ("D-L1-18", "L1", ["L1-NCORR", "L1-BRUNO"], [22.5, 18.5], 1.0, "single", "staff", False),
    ("D-L1-19", "L1", ["L1-BRUNO", "L1-SERVER"], [25, 20.25], 1.0, "single", "restricted", False),
    ("D-L1-20", "L1", ["L1-NCORR", "L1-RISER"], [29.5, 18.5], 0.8, "hatch", "restricted", False),
    ("D-L1-21", "L1", ["L1-NCORR", "L1-STORE"], [31, 18.5], 1.0, "single", "staff", False),
    ("D-L2-01", "L2", ["L2-LOUNGE", "L2-CORR"], [17, 8], 3.0, "opening", "staff", False),
    ("D-L2-02", "L2", ["L2-READ", "L2-CORR"], [4, 8], 1.0, "single", "staff", False),
    ("D-L2-03", "L2", ["L2-DINE", "L2-CORR"], [23, 8], 1.2, "single", "staff", False),
    ("D-L2-04", "L2", ["L2-LOUNGE", "L2-DINE"], [20, 4], 2.0, "opening", "staff", False),
    ("D-L2-05", "L2", ["L2-SHOWER", "L2-CORR"], [27.75, 8], 1.0, "single", "staff", False),
    ("D-L2-06", "L2", ["L2-WC", "L2-CORR"], [30.75, 8], 1.0, "single", "staff", False),
    ("D-L2-07", "L2", ["L2-WC", "L2-SHAFT-W"], [30.75, 1], 0.6, "hatch", "restricted", False),
    ("D-L2-EXE", "L2", ["EXT", "L2-CORR"], [32, 9.25], 1.2, "single", "staff", True),
    ("D-L2-08", "L2", ["L2-CORR", "L2-CHAT"], [3, 10.5], 1.0, "single", "staff", False),
    ("D-L2-09", "L2", ["L2-CORR", "L2-GARDEN"], [10, 10.5], 2.0, "opening", "staff", False),
    ("D-L2-10", "L2", ["L2-CORR", "L2-CORE"], [18.4, 10.5], 2.4, "opening", "staff", False),
    ("D-L2-11", "L2", ["L2-CORR", "L2-GAME"], [24, 10.5], 1.6, "double", "staff", False),
    ("D-L2-12", "L2", ["L2-CORE", "L2-NCORR"], [17.35, 16.5], 1.0, "single", "staff", False),
    ("D-L2-19", "L2", ["L2-GAME", "L2-NCORR"], [26, 16.5], 1.0, "single", "staff", False),
    ("D-L2-13", "L2", ["L2-NCORR", "L2-BALCONY"], [3.5, 18.5], 1.6, "sliding", "staff", False),
    ("D-L2-14", "L2", ["L2-NCORR", "L2-BILLIARD"], [10.5, 18.5], 1.2, "single", "staff", False),
    ("D-L2-15", "L2", ["L2-NCORR", "L2-GYM"], [18.5, 18.5], 1.6, "double", "staff", False),
    ("D-L2-16", "L2", ["L2-NCORR", "L2-STORE"], [26, 18.5], 1.0, "single", "staff", False),
    ("D-L2-17", "L2", ["L2-NCORR", "L2-RISER"], [29.5, 18.5], 0.8, "hatch", "restricted", False),
    ("D-L2-18", "L2", ["L2-NCORR", "L2-SERVICE"], [31, 18.5], 1.0, "single", "staff", False),
]

VERTICAL_LINKS = [
    {"id": "VL-STAIR-A", "type": "stair", "fixtureRoom": {"L1": "L1-CORE", "L2": "L2-CORE"},
     "ends": [{"floor": "L1", "point": [14.8, 11.25], "facing": 90, "arrive": [14.8, 11.25]},
              {"floor": "L2", "point": [16.2, 11.25], "facing": 270, "arrive": [16.2, 11.25]}],
     "prompt": "Tangga ke lantai lain", "travelSeconds": 2.5, "status": "konsep"},
    {"id": "VL-LIFT-A", "type": "lift", "fixtureRoom": {"L1": "L1-CORE", "L2": "L2-CORE"},
     "ends": [{"floor": "L1", "point": [18.875, 13.65], "facing": 90, "arrive": [18.875, 13.55]},
              {"floor": "L2", "point": [18.875, 13.65], "facing": 90, "arrive": [18.875, 13.55]}],
     "prompt": "Lift ke lantai lain", "travelSeconds": 3.0, "status": "konsep"},
    {"id": "VL-ESC-E", "type": "escape_concept", "playable": False, "ends": [{"floor": "L2", "point": [32, 9.25]}],
     "prompt": "Tangga darurat luar (penanda konsep, perlu kajian)", "status": "konsep, di luar envelope"},
]

WAYPOINTS = [
    {"id": "WP-L1-SPAWN", "floor": "L1", "pos": [14, 1.8], "kind": "spawn", "facing": 90},
    {"id": "WP-L1-SAFE", "floor": "L1", "pos": [14, 3.2], "kind": "safe"},
    {"id": "WP-L2-SAFE", "floor": "L2", "pos": [17, 9.25], "kind": "safe"},
    {"id": "WP-L1-CORR-W", "floor": "L1", "pos": [4, 9.25], "kind": "patrol"},
    {"id": "WP-L1-CORR-E", "floor": "L1", "pos": [28, 9.25], "kind": "patrol"},
    {"id": "WP-L1-NCORR", "floor": "L1", "pos": [10, 17.5], "kind": "patrol"},
    {"id": "WP-L2-NCORR", "floor": "L2", "pos": [22, 17.5], "kind": "patrol"},
]

ACTORS = [
    {"id": "ACT-BUDI", "displayName": "Budi", "role": "CEO", "kind": "player", "avatarAsset": "CH-CEO",
     "homeRoom": "L1-CEO", "rolePreference": {}, "allowedPublicFields": ["displayName", "role"]},
    {"id": "ACT-MAX", "displayName": "Max", "role": "Supervisor", "kind": "npc", "avatarAsset": "CH-SUPERVISOR",
     "homeRoom": "L1-IMPL", "rolePreference": {"desk": 3, "read": 2, "chat": 2, "coffee": 1, "billiards": 1},
     "allowedPublicFields": ["displayName", "role", "activityState"]},
    {"id": "ACT-HUGO", "displayName": "Hugo", "role": "Karakter, aset & arsitektur", "kind": "npc", "avatarAsset": "CH-ARCHITECT",
     "homeRoom": "L1-HUGO", "rolePreference": {"desk": 3, "read": 2, "rest": 1, "game": 1, "coffee": 1},
     "allowedPublicFields": ["displayName", "role", "activityState"]},
    {"id": "ACT-NOVA", "displayName": "Nova", "role": "Spesifikasi ICT", "kind": "npc", "avatarAsset": "CH-ICTSPEC",
     "homeRoom": "L1-NOVA", "rolePreference": {"desk": 3, "read": 3, "coffee": 1, "stretch": 1, "exercise": 1},
     "allowedPublicFields": ["displayName", "role", "activityState"]},
    {"id": "ACT-BRUNO", "displayName": "Bruno", "role": "Instalasi jaringan & server", "kind": "npc", "avatarAsset": "CH-NETINSTALL",
     "homeRoom": "L1-BRUNO", "rolePreference": {"desk": 3, "exercise": 2, "billiards": 2, "coffee": 1},
     "allowedPublicFields": ["displayName", "role", "activityState"]},
    {"id": "ACT-KEVIN", "displayName": "Kevin", "role": "Pamflet & materi visual", "kind": "npc", "avatarAsset": "CH-VISUAL",
     "homeRoom": "L1-KEVIN", "rolePreference": {"desk": 3, "read": 1, "game": 2, "chat": 2, "rest": 1},
     "allowedPublicFields": ["displayName", "role", "activityState"]},
    {"id": "ACT-REX", "displayName": "Rex", "role": "Review & QA", "kind": "npc", "avatarAsset": "CH-QA",
     "homeRoom": "L1-IMPL", "rolePreference": {"desk": 4, "read": 1, "coffee": 2, "game": 1},
     "allowedPublicFields": ["displayName", "role", "activityState"]},
]


def door_axis(rooms, center):
    """'x' when the door sits in a wall running along X (horizontal in plan), else 'y'."""
    cx, cy = center
    room = next(r for r in rooms if r != "EXT")
    poly = ROOMS_GEOM[room]
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if y0 == y1 == cy and min(x0, x1) <= cx <= max(x0, x1):
            return "x"
        if x0 == x1 == cx and min(y0, y1) <= cy <= max(y0, y1):
            return "y"
    raise ValueError(f"door at {center} not on an edge of {room}")


def rotate(dx, dy, rot):
    r = math.radians(rot)
    return dx * math.cos(r) - dy * math.sin(r), dx * math.sin(r) + dy * math.cos(r)


def derive_slots(fixtures):
    slots = []
    for fx in fixtures:
        cat = CATALOG[fx["type"]]
        for i, s in enumerate(cat.get("slots", [])):
            ox, oy = rotate(s["dx"], s["dy"], fx["rot"])
            facing = (fx["rot"] - 90 + s.get("facingRel", 0)) % 360
            slots.append({"id": f"SL-{fx['id'][3:]}-{i + 1}", "fixture": fx["id"], "floor": fx["floor"], "room": fx["room"],
                          "activity": s["activity"], "pos": [round(fx["pos"][0] + ox, 3), round(fx["pos"][1] + oy, 3)],
                          "facing": round(facing, 1), "pose": s["pose"], "capacity": 1})
    return slots


def assign_homes(fixtures):
    """Map each NPC to a free desk chair in its home room, deterministic by ID order."""
    taken = set()
    homes = {}
    for actor in ACTORS:
        for fx in fixtures:
            if fx["room"] == actor["homeRoom"] and fx["type"] == "chair" and fx.get("pairedWith") and fx["id"] not in taken:
                homes[actor["id"]] = fx["id"]
                taken.add(fx["id"])
                break
    return homes


# ---------------------------------------------------------------------------
# ICT: devices placed from the same coordinates; cables are derived later by
# tools/ict_derive.py from this pathway graph, never stored as free lengths.
# ---------------------------------------------------------------------------
def seed_ict(fixtures):
    by_id = {f["id"]: f for f in fixtures}
    outlets = []
    n = {"L1": 0, "L2": 0}

    def outlet(room, pos, ports, mount, serves, domain, endpoint_types):
        floor = room[:2]
        n[floor] += 1
        outlets.append({"id": f"TO-{floor}-{n[floor]:03d}", "floor": floor, "room": room, "pos": [round(pos[0], 3), round(pos[1], 3)],
                        "mount": mount, "z": 0.3 if mount == "floor_wall" else (3.0 if mount == "ceiling" else 1.2),
                        "ports": ports, "serves": serves, "domain": domain, "endpointTypes": endpoint_types})

    for fx in fixtures:
        t = fx["type"]
        if t in ("desk", "desk_exec"):
            dom = "NET-OFFICE"
            outlet(fx["room"], fx["pos"], 2, "floor_wall", fx["id"], dom, ["workstation", "phone_or_spare"])
        elif t == "lab_bench":
            outlet(fx["room"], fx["pos"], 4, "floor_wall", fx["id"], "NET-LAB", ["lab_device"] * 4)
        elif t == "reception_desk":
            outlet(fx["room"], fx["pos"], 2, "floor_wall", fx["id"], "NET-OFFICE", ["workstation", "printer"])
        elif t == "wall_display":
            dom = "NET-DEMO" if fx["floor"] == "L2" else "NET-OFFICE"
            outlet(fx["room"], fx["pos"], 1, "wall_high", fx["id"], dom, ["display"])
        elif t == "media_console":
            outlet(fx["room"], fx["pos"], 2, "floor_wall", fx["id"], "NET-DEMO", ["console", "display"])
        elif t == "arcade_cabinet":
            outlet(fx["room"], fx["pos"], 1, "floor_wall", fx["id"], "NET-DEMO", ["arcade"])
        elif t == "directory_sign":
            outlet(fx["room"], fx["pos"], 1, "wall_high", fx["id"], "NET-DEMO", ["signage"])
        elif t == "meeting_table":
            outlet(fx["room"], fx["pos"], 2, "floor_wall", fx["id"], "NET-OFFICE", ["table_box", "spare"])
        elif t == "lab_rack_open":
            outlet(fx["room"], fx["pos"], 2, "floor_wall", fx["id"], "NET-LAB", ["lab_uplink", "spare"])

    aps = [("L1", "L1-LOBBY", [14, 3.4]), ("L1", "L1-IMPL", [10, 13.9]), ("L1", "L1-CORR", [25, 9.25]),
           ("L1", "L1-NCORR", [9, 17.5]), ("L1", "L1-NCORR", [23, 17.5]),
           ("L2", "L2-LOUNGE", [13.5, 4.5]), ("L2", "L2-DINE", [23, 4.0]), ("L2", "L2-GAME", [26, 14.0]),
           ("L2", "L2-CORR", [6, 9.25]), ("L2", "L2-NCORR", [10.5, 17.5]), ("L2", "L2-GYM", [18.5, 21.5])]
    devices = []
    for i, (fl, room, pos) in enumerate(aps, 1):
        did = f"AP-{fl}-{sum(1 for d in devices if d['type'] == 'ap' and d['floor'] == fl) + 1:02d}"
        outlet(room, pos, 1, "ceiling", did, "NET-OFFICE", ["ap"])
        devices.append({"id": did, "type": "ap", "floor": fl, "room": room, "pos": pos, "z": 3.0,
                        "outlet": outlets[-1]["id"], "poeClass": 4, "status": "placeholder (AS-ICT-01)"})
    cams = [("L1", "L1-LOBBY", [9, 7.5], 300), ("L1", "L1-CORR", [31, 9.25], 180), ("L1", "L1-BRUNO", [24.5, 23.5], 300),
            ("L2", "L2-CORR", [31, 9.25], 180), ("L2", "L2-NCORR", [31, 17.5], 180)]
    for fl, room, pos, aim in cams:
        did = f"CAM-{fl}-{sum(1 for d in devices if d['type'] == 'camera' and d['floor'] == fl) + 1:02d}"
        outlet(room, pos, 1, "ceiling", did, "NET-OFFICE", ["camera"])
        devices.append({"id": did, "type": "camera", "floor": fl, "room": room, "pos": pos, "z": 2.8, "aimDeg": aim,
                        "outlet": outlets[-1]["id"], "poeClass": 3, "status": "opsional konsep, privacy mask perlu kajian"})

    racks = [
        {"id": "RK-L1-01", "fixture": next(f["id"] for f in fixtures if f.get("ictRack") == "RK-L1-01"), "room": "L1-SERVER",
         "floor": "L1", "units": 42, "contents": [
             {"device": "PP-01", "type": "patch_panel_24", "u": 40, "height": 1},
             {"device": "CM-01", "type": "cable_manager", "u": 39, "height": 1},
             {"device": "PP-02", "type": "patch_panel_24", "u": 38, "height": 1},
             {"device": "CM-02", "type": "cable_manager", "u": 37, "height": 1},
             {"device": "PP-03", "type": "patch_panel_24", "u": 36, "height": 1},
             {"device": "CM-03", "type": "cable_manager", "u": 35, "height": 1},
             {"device": "PP-04", "type": "patch_panel_24", "u": 34, "height": 1},
             {"device": "CM-04", "type": "cable_manager", "u": 33, "height": 1},
             {"device": "SW-ACC-01", "type": "switch_access_48_poe", "u": 31, "height": 1},
             {"device": "SW-ACC-02", "type": "switch_access_48_poe", "u": 30, "height": 1},
             {"device": "SW-ACC-03", "type": "switch_access_48_poe", "u": 29, "height": 1},
             {"device": "SW-AGG-01", "type": "switch_aggregation", "u": 28, "height": 1},
             {"device": "GW-DEMO-01", "type": "gateway_virtual", "u": 26, "height": 1},
         ]},
        {"id": "RK-L1-02", "fixture": next(f["id"] for f in fixtures if f.get("ictRack") == "RK-L1-02"), "room": "L1-SERVER",
         "floor": "L1", "units": 42, "contents": [
             {"device": "SRV-DEMO-01", "type": "server_placeholder", "u": 20, "height": 2},
             {"device": "NAS-DEMO-01", "type": "storage_placeholder", "u": 17, "height": 2},
             {"device": "PDU-01", "type": "pdu", "u": 10, "height": 1},
             {"device": "UPS-01", "type": "ups_placeholder", "u": 1, "height": 3},
         ]},
    ]
    rack_device_types = {
        "patch_panel_24": {"ports": 24}, "switch_access_48_poe": {"ports": 48, "uplinks": 4, "poeBudgetW": None},
        "switch_aggregation": {"ports": 24, "uplinks": 2}, "gateway_virtual": {"ports": 8},
        "server_placeholder": {"ports": 2}, "storage_placeholder": {"ports": 2}, "pdu": {}, "ups_placeholder": {},
        "cable_manager": {},
    }
    pathways = {
        "trayHeight": 3.2,
        "nodes": [
            {"id": "PN-L1-RK", "floor": "L1", "pos": [26.7, 21.4], "note": "di atas depan rack"},
            {"id": "PN-L1-SRV-S", "floor": "L1", "pos": [27.0, 18.5], "note": "penetrasi dinding server ke koridor utara"},
            {"id": "PN-L1-SRV-E", "floor": "L1", "pos": [29.0, 19.25], "note": "penetrasi server ke riser"},
            {"id": "PN-L1-RISER", "floor": "L1", "pos": [29.5, 19.25], "note": "riser L1"},
            {"id": "PN-L2-RISER", "floor": "L2", "pos": [29.5, 19.25], "note": "riser L2"},
            {"id": "PN-L2-RISER-S", "floor": "L2", "pos": [29.5, 18.5]},
        ],
        "edges": [
            ["PN-L1-RK", "PN-L1-SRV-S"], ["PN-L1-RK", "PN-L1-SRV-E"], ["PN-L1-SRV-E", "PN-L1-RISER"],
            ["PN-L1-RISER", "PN-L2-RISER"], ["PN-L2-RISER", "PN-L2-RISER-S"],
        ],
        "trays": [
            {"id": "TR-L1-N", "floor": "L1", "from": [0.5, 17.5], "to": [31.5, 17.5], "joins": [["PN-L1-SRV-S", [27.0, 17.5]]]},
            {"id": "TR-L1-CORE", "floor": "L1", "from": [17.0, 17.5], "to": [17.0, 9.25], "joins": []},
            {"id": "TR-L1-S", "floor": "L1", "from": [0.5, 9.25], "to": [31.5, 9.25], "joins": []},
            {"id": "TR-L2-N", "floor": "L2", "from": [0.5, 17.5], "to": [31.5, 17.5], "joins": [["PN-L2-RISER-S", [29.5, 17.5]]]},
            {"id": "TR-L2-CORE", "floor": "L2", "from": [17.0, 17.5], "to": [17.0, 9.25], "joins": []},
            {"id": "TR-L2-S", "floor": "L2", "from": [0.5, 9.25], "to": [31.5, 9.25], "joins": []},
        ],
        "riserVertical": 4.0,
        "rackRise": 1.2,
        "slack": {"rack": 3.0, "outlet": 0.3},
        "maxLinkM": 90.0,
        "assumptions": ["AS-ICT-02", "AS-ICT-03"],
    }
    domains = [
        {"id": "NET-OFFICE", "label": "office", "note": "abstrak"}, {"id": "NET-DEMO", "label": "demo", "note": "abstrak"},
        {"id": "NET-GUEST", "label": "guest", "note": "abstrak, SSID tamu konsep"}, {"id": "NET-LAB", "label": "lab", "note": "abstrak, terisolasi konsep"},
        {"id": "NET-SERVER", "label": "server", "note": "abstrak"},
    ]
    poe_classes = {"3": {"pseW": 15.4, "source": "IEEE 802.3af/at Class 3 PSE output"},
                   "4": {"pseW": 30.0, "source": "IEEE 802.3at Class 4 PSE output"}}
    return {"status": "rancangan virtual konsep; tidak terhubung perangkat/IP/ISP nyata", "domains": domains,
            "outlets": outlets, "devices": devices, "racks": racks, "rackDeviceTypes": rack_device_types,
            "pathways": pathways, "poeClasses": poe_classes,
            "assumptions": ["AS-ICT-01", "AS-ICT-02", "AS-ICT-03", "AS-ICT-04", "AS-ICT-05", "AS-ICT-06", "AS-NET-01"]}


def build():
    fixtures = seed_fixtures()
    rooms = []
    for rid, poly in ROOMS_GEOM.items():
        name, cat, access, noise, func, load, fin = ROOM_META[rid]
        rooms.append({"id": rid, "floor": rid[:2], "name": name, "category": cat, "access": access, "noise": noise,
                      "function": func, "polygon": poly, "occupantLoadKey": load, "finish": FINISHES[fin],
                      "ict": ICT_PROFILE.get(rid, []), "status": "proposal konsep",
                      "assumptions": ["AS-DIM-01", "AS-DIM-02"]})
    doors = [{"id": d[0], "floor": d[1], "rooms": d[2], "center": d[3], "width": d[4], "type": d[5],
              "access": d[6], "exit": d[7], "wallAxis": door_axis(d[2], d[3])} for d in DOORS]
    homes = assign_homes(fixtures)
    actors = []
    for a in ACTORS:
        rec = dict(a)
        if a["kind"] == "npc":
            rec["homeSeat"] = homes.get(a["id"])
        rec["simulated"] = True
        actors.append(rec)
    world = {
        "$schema": "./world.schema.json",
        "schemaVersion": "1.0.0",
        "project": "kantor-rpg",
        "revision": REVISION,
        "status": "KONSEP - bukan untuk konstruksi. Semua ukuran proposal untuk review.",
        "units": {"length": "m", "cadExportUnit": "mm", "cadScale": 1000, "angle": "deg"},
        "coordinates": {
            "origin": "sudut barat daya lantai jadi L1",
            "axes": {"x": "timur", "y": "utara", "z": "atas"},
            "runtimeThree": "three = [x, z, -y] (Y-up); rotasi world rot -> three rotation.y = rad(rot)",
            "blender": "identik dengan world (Z-up); exporter glTF mengubah ke Y-up: gltf = [x, z, -y]",
            "cad": "DXF WCS = world * 1000 (mm), Z = elevasi lantai",
            "fixtureFront": "lokal -Y pada rot 0; rot CCW derajat",
        },
        "building": {"id": "KRPG-01", "name": "kantor-rpg", "footprint": [32, 24], "floorToFloor": 4.0,
                     "ceilingHeight": 3.0, "slab": 0.3, "wall": {"exterior": 0.3, "interior": 0.15},
                     "assumptions": ["AS-DIM-01", "AS-DIM-03"]},
        "floors": [
            {"id": "L1", "name": "Lantai 1 - Kerja & Kunjungan", "level": 1, "elevation": 0.0,
             "envelope": rect(0, 0, 32, 24), "spawn": "WP-L1-SPAWN", "safePoint": "WP-L1-SAFE"},
            {"id": "L2", "name": "Lantai 2 - Rekreasi", "level": 2, "elevation": 4.0,
             "envelope": rect(0, 0, 32, 24), "spawn": "WP-L2-SAFE", "safePoint": "WP-L2-SAFE"},
        ],
        "rooms": rooms,
        "doors": doors,
        "verticalLinks": VERTICAL_LINKS,
        "catalog": CATALOG,
        "fixtures": fixtures,
        "activitySlots": derive_slots(fixtures),
        "waypoints": WAYPOINTS,
        "actors": actors,
        "ict": seed_ict(fixtures),
        "adjacency": ADJACENCY_RULES,
        "occupantLoadFactors": LOAD_FACTORS,
        "assumptions": ASSUMPTIONS,
    }
    return world


def dumps(world):
    return json.dumps(world, indent=1, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    OUT.write_text(dumps(build()), encoding="utf-8")
    print(OUT.relative_to(ROOT))
