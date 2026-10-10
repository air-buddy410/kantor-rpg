// Papan demo untuk pengunjung publik (REQ-BOARD-04): data simulasi berlabel
// `Demo`. Tidak ada judul tugas, nama berkas, atau peristiwa nyata di bundle.
import type { Boards } from './api';

export function DEMO_BOARDS(now: number): Boards {
  const h = 3600_000;
  return {
    observedAt: new Date(now).toISOString(),
    mode: 'demo',
    handoffs: { ok: true, source: 'data demo', items: [
      { id: 'demo-h1', project: 'Contoh Villa A', badan: 'ENT', from: 'Hugo', to: 'Nova', summary: 'Contoh: volume ruang siap untuk desain ICT', diminta: 'Contoh: hitung titik akses per ruang.', hasFile: true, status: 'Dikerjakan', createdAt: now - 5 * h, ageHours: 5, attention: false, chain: ['Hugo', 'Nova', 'Clara', 'Stella'], chainActive: 1 },
      { id: 'demo-h2', project: 'Contoh Kafe B', badan: 'ENT', from: 'Nova', to: 'Clara', summary: 'Contoh: BoQ menunggu harga modal', diminta: 'Contoh: isi harga dan margin.', hasFile: true, status: 'Dikirim', createdAt: now - 30 * h, ageHours: 30, attention: true },
      { id: 'demo-h3', project: 'Contoh Kantor C', badan: 'ENT', from: 'Clara', to: 'Stella', summary: 'Contoh: draf kontrak dari penawaran', diminta: '', hasFile: true, status: 'Selesai', createdAt: now - 50 * h, ageHours: 50, attention: false },
    ] },
    tasks: { ok: true, source: 'data demo', items: [
      { id: 'demo-t1', title: 'Contoh tugas yang diblokir', owner: 'Bruno', requester: 'Max', status: 'blocked', badan: 'ENT', createdAt: now - 3 * h, ageHours: 3, handoff: false },
      { id: 'demo-t2', title: 'Contoh desain poster', owner: 'Leo', requester: 'Kevin', status: 'running', badan: 'ENT', createdAt: now - 1 * h, ageHours: 1, handoff: false },
      { id: 'demo-t3', title: 'Contoh riset harga', owner: 'Clara', requester: 'Nova', status: 'todo', badan: 'ENT', createdAt: now - 2 * h, ageHours: 2, handoff: true },
      { id: 'demo-t4', title: 'Contoh laporan mingguan', owner: 'Max', requester: 'Max', status: 'done', badan: 'ENT', createdAt: now - 20 * h, ageHours: 20, handoff: false },
    ] },
    log: { ok: true, source: 'data demo', items: [
      { at: now - 2 * 60_000, kind: 'tool', bot: 'Leo', verb: 'Mengubah berkas', object: '', taskId: null },
      { at: now - 5 * 60_000, kind: 'task', bot: 'Bruno', verb: 'Tugas diblokir', object: 'Contoh tugas yang diblokir', taskId: 'demo-t1' },
      { at: now - 9 * 60_000, kind: 'tool', bot: 'Nova', verb: 'Riset web', object: '', taskId: null },
      { at: now - 14 * 60_000, kind: 'task', bot: 'Leo', verb: 'Mengambil tugas', object: 'Contoh desain poster', taskId: 'demo-t2' },
    ] },
  };
}
