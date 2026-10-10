// Roster agen yang boleh menerima perintah dari RPG (PRD 17.3). Diambil dari
// profil Hermes yang aktif; actorId mengikat karakter di dunia ke profil.
// yupus (keluarga) dan wealth (pribadi) tidak pernah menerima perintah RPG
// dan hanya tampil sebagai "Tugas pribadi" di papan.
export const ROSTER = [
  { profile: 'default', name: 'Max', lane: 'Koordinator, asisten utama Budi', actorId: 'ACT-MAX', badan: 'PRIBADI' },
  { profile: 'echo', name: 'Echo', lane: 'Asisten kedua, riset umum (model 9router)', actorId: 'ACT-ECHO', badan: 'PRIBADI' },
  { profile: 'leo', name: 'Leo', lane: 'Desain grafis, web, video', actorId: 'ACT-LEO', badan: 'PRIBADI' },
  { profile: 'enterprise', name: 'Nova', lane: 'Desain ICT Enterprise', actorId: 'ACT-NOVA', badan: 'ENT' },
  { profile: 'sipil', name: 'Hugo', lane: 'Sipil, CAD, RAB fisik', actorId: 'ACT-HUGO', badan: 'ENT' },
  { profile: 'infra', name: 'Bruno', lane: 'Infra, server, homelab', actorId: 'ACT-BRUNO', badan: 'ISP' },
  { profile: 'sales', name: 'Kevin', lane: 'Sales dan marketing', actorId: 'ACT-KEVIN', badan: 'ENT' },
  { profile: 'labs', name: 'Rex', lane: 'PerumNet Labs, produk', actorId: 'ACT-REX', badan: 'LABS' },
  { profile: 'perumnet', name: 'Atlas', lane: 'Aplikasi PerumNet (ISP)', actorId: null, badan: 'ISP' },
  { profile: 'finance', name: 'Clara', lane: 'Keuangan, harga, margin', actorId: null, badan: 'ENT' },
  { profile: 'legal', name: 'Stella', lane: 'Kontrak dan legal', actorId: null, badan: 'ENT' },
];

export const PRIVATE_PROFILES = new Set(['yupus', 'wealth']);

export const byProfile = (p) => ROSTER.find((r) => r.profile === p) ?? null;
