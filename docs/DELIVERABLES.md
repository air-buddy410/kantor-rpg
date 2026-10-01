# Register deliverable dan brief spesialis
Status semuanya: target, belum dibuat kecuali PRD/PDF perencanaan yang ada. Claude mengerjakan; nama spesialis adalah reviewer/keahlian acuan, bukan task bot yang telah dikirim.

M0: PRD v0.2 + PDF; keputusan/asumsi; room schedule dan adjacency; design/world.json + schema + validators; sheet register; capability-report (OS, Blender, CAD/native DWG, browsers, libraries); capacity.json dengan perhitungan runnable; requirement matrix.
M1: runnable vertical slice dua lantai, CEO controls/collision/floor links, original avatar source + GLB, directory fallback; satu sample drawing dari schema; perf harness.
M2: persona/idle/group/reservations/stuck recovery, panels/interactions, responsive/accessibility tests dan screenshots; test public/demo/private separation.
M3: Office Studio + Avatar Studio; source blend/GLB/PNG; CAD DXF + DWG bila tool native tersedia; blueprint PDFs terpisah dari PRD; port map/rack/BOM; instructions clean rebuild; QA report.
M4 gated: read-only sanitized private adapter/auth, no public payload. Disabled sampai approved.

Hugo brief: character sheets, rig/clip deform checks, original modular furniture, envelope/interior finishes, architectural sections/elevations, Blender source/export. Bukan signoff sipil/struktur profesional.
Nova brief: room-by-room ICT requirements/device schedule, AP assumptions, outlet/backbone/rack drawings, power sources, privacy shower/toilet. Spesifikasi harus bersumber dan label masih discovery bila belum ada.
Bruno brief: installability, rack/patch port map/cable routes, safe servicing, commissioning checklist. Semua virtual, bukan config hardware real.
Kevin brief: original pamflet/signage/artwork in-office dan poster proyek; copy faktual, source fonts/images legal; no performance/capability marketing claims sebelum bukti.
Rex review brief bila ditugaskan: implementation security/QA/performance, requirement/test mapping; tidak mengganti creator Claude pada project ini.
Max: scope, decisions, prompt cloud, supervision dan verification; Budi menyetujui keputusan nondelegable.

## Struktur hasil target
- PRD/: manuscript/PDF/source research notes.
- design/: schema/world/room schedules/fixtures/ICT/asset registry.
- cad/: DXF/DWG/native scripts; export source identity truthful.
- blender/: generator scripts/source blend; idempotent runbook.
- assets/: optimized original runtime GLB/textures.
- drawings/: drawing register/vector PDFs/previews.
- app/ dan tests/: runnable runtime/interaction/studio.
- docs/evidence/: command receipts/logs/screenshots, exact SHA and requirement IDs.

Matriks traceability: ID requirement, story, milestone/task, AC/test, exact evidence path/commit, status (target/asumsi/belum diuji/terverifikasi/tidak didukung). Jangan menandai requirement terverifikasi hanya dari worker claim. Tidak ada CAD/3D blueprint dalam bootstrap ini; worker harus memproduksinya, bukan mencentang folder kosong.
