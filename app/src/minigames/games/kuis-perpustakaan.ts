// Kuis Perpustakaan (bookshelf, L2-READ). Five multiple choice questions per
// session from a bank of office and ICT/ISP questions. Office facts are
// computed from world.json at load time, never typed in by hand.
import type { GameCtx, GameInstance, GameModule } from '../types';
import { PAL, drawChar, roundRect, text } from '../cast';
import worldJson from '@design/world.json';

interface WRoom { id: string; floor: string; name: string; polygon: number[][] }
interface WActor { displayName: string; role: string; homeRoom: string; avatarAsset: string }
export const WORLD = worldJson as unknown as {
  floors: { id: string; level: number; name: string }[]; rooms: WRoom[]; actors: WActor[];
  building: { footprint: number[]; floorToFloor: number };
};

export interface Question { id: string; q: string; opts: string[]; answer: number; why: string }
type T = GameCtx['t'];

const levelOf = (floorId: string) => WORLD.floors.find((f) => f.id === floorId)!.level;
const roomById = (id: string) => WORLD.rooms.find((r) => r.id === id)!;
const actorByName = (n: string) => WORLD.actors.find((a) => a.displayName === n)!;
const roomByFn = (re: RegExp) => WORLD.rooms.find((r) => re.test(r.id))!;

/** Three distinct positive numbers near n, never n itself. */
function nearNumbers(n: number, step: number, rand: () => number): number[] {
  const cand = [n + step, n + 2 * step, n - step, n + 3 * step, n - 2 * step].filter((v) => v > 0 && v !== n);
  const out: number[] = [];
  while (out.length < 3) out.push(cand.splice(Math.floor(rand() * Math.min(cand.length, 4)), 1)[0]);
  return out;
}

/** Correct option first; the session shuffles. */
type Raw = { id: string; q: string; right: string; wrong: string[]; why: string };

export function buildBank(t: T, rand: () => number): Question[] {
  const raw: Raw[] = [];
  const levels = WORLD.floors.map((f) => f.level);
  const floorOpts = (lvl: number) => {
    const others = [1, 2, 3, 4].filter((v) => v !== lvl);
    return { right: t('Lantai {n}', { n: lvl }), wrong: others.slice(0, 3).map((v) => t('Lantai {n}', { n: v })) };
  };
  const roomsOn = (fl: string) => WORLD.rooms.filter((r) => r.floor === fl && !/CORR|SHAFT|CORE/.test(r.id));

  // office facts (all from world.json)
  const nFloors = WORLD.floors.length;
  raw.push({ id: 'office-floors', q: t('Berapa lantai kantor ini?'), right: t('{n} lantai', { n: nFloors }), wrong: nearNumbers(nFloors, 1, rand).map((v) => t('{n} lantai', { n: v })), why: t('Kantor punya {n} lantai: kerja di bawah, rekreasi di atas.', { n: nFloors }) });
  const where = (id: string, rid: RegExp, q: string, why: (n: number) => string) => {
    const r = roomByFn(rid);
    const lvl = levelOf(r.floor);
    const o = floorOpts(lvl);
    raw.push({ id, q, right: o.right, wrong: o.wrong, why: why(lvl) });
  };
  where('office-billiard', /BILLIARD/, t('Ruang biliar ada di lantai berapa?'), (n) => t('Ruang biliar ada di lantai {n}, area rekreasi.', { n }));
  where('office-server', /SERVER/, t('Ruang server ada di lantai berapa?'), (n) => t('Ruang server ada di lantai {n}, dekat area Bruno.', { n }));
  where('office-read', /-READ$/, t('Perpustakaan ada di lantai berapa?'), (n) => t('Perpustakaan ada di lantai {n}, kamu sedang di sana.', { n }));
  where('office-gym', /-GYM$/, t('Ruang olahraga ada di lantai berapa?'), (n) => t('Ruang olahraga ada di lantai {n}.', { n }));
  where('office-meet', /-MEET$/, t('Ruang rapat besar ada di lantai berapa?'), (n) => t('Ruang rapat besar ada di lantai {n}, dekat lobby.', { n }));
  const nL1 = WORLD.rooms.filter((r) => r.floor === WORLD.floors[0].id).length;
  const lv1 = WORLD.floors[0].level;
  raw.push({ id: 'office-rooms-l1', q: t('Berapa ruang tercatat di denah lantai {f}?', { f: lv1 }), right: t('{n} ruang', { n: nL1 }), wrong: nearNumbers(nL1, 2, rand).map((v) => t('{n} ruang', { n: v })), why: t('Denah lantai {f} memuat {n} ruang, termasuk koridor dan shaft.', { f: lv1, n: nL1 }) });
  const [fw, fd] = WORLD.building.footprint;
  const area = fw * fd;
  raw.push({ id: 'office-area', q: t('Berapa luas tapak satu lantai kantor?'), right: t('{n} m²', { n: area }), wrong: nearNumbers(area, 96, rand).map((v) => t('{n} m²', { n: v })), why: t('Tapak {w} x {d} m = {n} m² per lantai.', { w: fw, d: fd, n: area }) });
  const pickRoom = (fl: string, other: string) => {
    const on = roomsOn(fl), off = roomsOn(other);
    const right = on[Math.floor(rand() * on.length)];
    const bag = [...off];
    const wrong: string[] = [];
    while (wrong.length < 3) wrong.push(t(bag.splice(Math.floor(rand() * bag.length), 1)[0].name));
    return { right: t(right.name), wrong };
  };
  const l1 = WORLD.floors.find((f) => f.level === Math.min(...levels))!.id;
  const l2 = WORLD.floors.find((f) => f.level === Math.max(...levels))!.id;
  { const p = pickRoom(l2, l1); const n = levelOf(l2); raw.push({ id: 'office-on-l2', q: t('Ruang mana yang ada di lantai {n}?', { n }), ...p, why: t('{r} ada di lantai {n}, lantai rekreasi.', { r: p.right, n }) }); }
  { const p = pickRoom(l1, l2); const n = levelOf(l1); raw.push({ id: 'office-on-l1', q: t('Ruang mana yang ada di lantai {n}?', { n }), ...p, why: t('{r} ada di lantai {n}, lantai kerja.', { r: p.right, n }) }); }
  const roleQ = (id: string, name: string, q: string) => {
    const a = actorByName(name);
    const others = WORLD.actors.filter((x) => x.role !== a.role && x.displayName !== 'Budi').map((x) => t(x.role));
    const wrong: string[] = [];
    while (wrong.length < 3) wrong.push(others.splice(Math.floor(rand() * others.length), 1)[0]);
    raw.push({ id, q, right: t(a.role), wrong, why: t('{who}: {r}.', { who: name, r: t(a.role) }) });
  };
  roleQ('office-nova', 'Nova', t('Apa peran Nova di tim?'));
  roleQ('office-bruno', 'Bruno', t('Apa peran Bruno di tim?'));
  roleQ('office-kevin', 'Kevin', t('Apa peran Kevin di tim?'));
  {
    const a = actorByName('Hugo');
    const home = roomById(a.homeRoom);
    const others = WORLD.rooms.filter((r) => r.floor === home.floor && r.id !== home.id && !/CORR|SHAFT|CORE/.test(r.id)).map((r) => t(r.name));
    const wrong: string[] = [];
    while (wrong.length < 3) wrong.push(others.splice(Math.floor(rand() * others.length), 1)[0]);
    raw.push({ id: 'office-hugo-home', q: t('Di ruang mana Hugo biasa bekerja?'), right: t(home.name), wrong, why: t('Hugo bekerja di {r}, ada meja gambarnya.', { r: t(home.name) }) });
  }
  const f2f = WORLD.building.floorToFloor;
  raw.push({ id: 'office-f2f', q: t('Berapa tinggi lantai ke lantai di kantor ini?'), right: t('{n} m', { n: f2f }), wrong: nearNumbers(f2f, 0.5, rand).map((v) => t('{n} m', { n: v })), why: t('Jarak lantai ke lantai {n} m.', { n: f2f }) });

  // ICT / ISP general knowledge
  const ict = (id: string, q: string, right: string, wrong: string[], why: string) => raw.push({ id, q, right, wrong, why });
  ict('ict-olt', t('Apa itu OLT pada jaringan fiber GPON?'), t('Perangkat pusat di sisi penyedia yang melayani banyak ONT'), [t('Modem di rumah pelanggan'), t('Kabel fiber untuk dalam ruangan'), t('Alat ukur redaman kabel')], t('OLT (Optical Line Terminal) ada di sisi ISP dan melayani banyak ONT lewat splitter.'));
  ict('ict-ont', t('ONT dipasang di mana?'), t('Di lokasi pelanggan'), [t('Di kantor pusat ISP'), t('Di tiang listrik'), t('Di dalam splitter')], t('ONT (Optical Network Terminal) adalah perangkat ujung di lokasi pelanggan.'));
  ict('ict-poe', t('PoE adalah singkatan dari?'), t('Power over Ethernet'), [t('Port of Entry'), t('Power of Electricity'), t('Point of Exchange')], t('PoE mengalirkan daya listrik lewat kabel Ethernet, misalnya untuk AP dan kamera.'));
  ict('ict-patch', t('Apa fungsi patch panel di rak?'), t('Titik terminasi kabel horizontal agar rapi dan mudah dipindah'), [t('Membagi alamat IP otomatis'), t('Menguatkan sinyal WiFi'), t('Menyimpan cadangan data server')], t('Kabel dari outlet berakhir di patch panel, lalu disambung ke switch dengan kabel patch pendek.'));
  ict('ict-wifi6', t('Wi-Fi 6 adalah standar IEEE yang mana?'), t('802.11ax'), [t('802.11ac'), t('802.11n'), t('802.3af')], t('Wi-Fi 6 = IEEE 802.11ax. Wi-Fi 5 adalah 802.11ac.'));
  ict('ict-wifi5', t('Wi-Fi 5 adalah standar IEEE yang mana?'), t('802.11ac'), [t('802.11ax'), t('802.11g'), t('802.1Q')], t('Wi-Fi 5 = IEEE 802.11ac.'));
  ict('ict-speed', t('Satuan yang umum untuk kecepatan internet adalah?'), t('Mbps'), [t('MB'), t('GHz'), t('dBm')], t('Kecepatan internet diukur dalam bit per detik, misalnya Mbps.'));
  ict('ict-cat6', t('Panjang maksimal satu link kabel tembaga Ethernet menurut standar?'), t('100 meter'), [t('30 meter'), t('500 meter'), t('2 kilometer')], t('Link tembaga Ethernet dibatasi 100 m (90 m permanen + patch cord).'));
  ict('ict-rj45', t('Berapa jumlah pin pada konektor RJ45?'), t('8'), [t('4'), t('6'), t('12')], t('RJ45 (8P8C) punya 8 pin untuk 4 pasang kabel.'));
  ict('ict-vlan', t('Apa fungsi VLAN?'), t('Memisahkan jaringan secara logis di switch yang sama'), [t('Menambah kecepatan internet dari ISP'), t('Mengubah sinyal listrik jadi cahaya'), t('Memberi daya ke kamera')], t('VLAN memecah satu switch fisik menjadi beberapa jaringan logis, misalnya tamu dan kantor.'));
  ict('ict-dhcp', t('Protokol apa yang membagikan alamat IP otomatis?'), t('DHCP'), [t('DNS'), t('FTP'), t('SNMP')], t('DHCP memberi alamat IP, gateway dan DNS ke perangkat secara otomatis.'));
  ict('ict-dns', t('Apa tugas DNS?'), t('Menerjemahkan nama domain menjadi alamat IP'), [t('Mengenkripsi kata sandi WiFi'), t('Mengatur antrean cetak'), t('Mengukur kecepatan internet')], t('DNS mengubah nama seperti contoh.id menjadi alamat IP.'));
  ict('ict-ipv4', t('Berapa bit panjang alamat IPv4?'), t('32 bit'), [t('64 bit'), t('128 bit'), t('16 bit')], t('IPv4 = 32 bit, IPv6 = 128 bit.'));
  ict('ict-ipv6', t('Berapa bit panjang alamat IPv6?'), t('128 bit'), [t('32 bit'), t('64 bit'), t('256 bit')], t('IPv6 memakai alamat 128 bit.'));
  ict('ict-ping', t('Perintah ping memakai protokol apa?'), t('ICMP'), [t('HTTP'), t('SMTP'), t('ARP')], t('Ping mengirim ICMP echo request dan menunggu echo reply.'));
  ict('ict-ssid', t('SSID pada WiFi adalah?'), t('Nama jaringan WiFi'), [t('Kata sandi WiFi'), t('Alamat MAC router'), t('Kanal frekuensi')], t('SSID adalah nama jaringan yang muncul di daftar WiFi.'));
  ict('ict-band', t('Pita frekuensi WiFi yang jangkauannya paling jauh tapi lebih padat?'), t('2,4 GHz'), [t('5 GHz'), t('6 GHz'), t('60 GHz')], t('2,4 GHz menembus dinding lebih baik, tapi kanalnya sedikit dan ramai.'));
  ict('ict-1u', t('Berapa tinggi 1U pada rak server?'), t('1,75 inci (44,45 mm)'), [t('1 inci (25,4 mm)'), t('2 inci (50,8 mm)'), t('10 cm')], t('1 rack unit = 1,75 inci. Rak 42U kira-kira 1,87 m ruang perangkat.'));
  ict('ict-ups', t('Apa fungsi UPS di ruang server?'), t('Memberi daya cadangan saat listrik padam'), [t('Mendinginkan rak'), t('Membagi bandwidth'), t('Mencatat log jaringan')], t('UPS menjaga perangkat tetap hidup sebentar dan memberi waktu shutdown rapi.'));
  ict('ict-https', t('Port standar untuk HTTPS adalah?'), t('443'), [t('80'), t('22'), t('8080')], t('HTTPS memakai port 443, HTTP port 80, SSH port 22.'));
  ict('ict-subnet', t('Subnet /24 menyediakan berapa alamat host yang bisa dipakai?'), t('254'), [t('256'), t('255'), t('128')], t('/24 punya 256 alamat, dikurangi alamat network dan broadcast = 254.'));
  ict('ict-mac', t('Alamat MAC panjangnya berapa bit?'), t('48 bit'), [t('32 bit'), t('64 bit'), t('128 bit')], t('Alamat MAC 48 bit, ditulis 6 pasang heksadesimal.'));
  ict('ict-switch', t('Switch biasa bekerja di lapisan OSI berapa?'), t('Lapisan 2 (data link)'), [t('Lapisan 1 (fisik)'), t('Lapisan 4 (transport)'), t('Lapisan 7 (aplikasi)')], t('Switch meneruskan frame berdasarkan alamat MAC, lapisan 2.'));
  ict('ict-sm', t('Jaket kabel fiber single-mode umumnya berwarna?'), t('Kuning'), [t('Oranye'), t('Biru muda'), t('Ungu')], t('Single-mode umumnya kuning; multimode oranye atau aqua.'));
  ict('ict-latency', t('Latensi jaringan biasanya diukur dalam satuan?'), t('Milidetik (ms)'), [t('Megabit (Mb)'), t('Desibel (dB)'), t('Hertz (Hz)')], t('Latensi adalah waktu tempuh paket, biasanya dalam ms.'));
  ict('ict-af', t('Standar PoE pertama (sekitar 15,4 W per port) adalah?'), t('IEEE 802.3af'), [t('IEEE 802.3bt'), t('IEEE 802.11ax'), t('IEEE 802.1X')], t('802.3af sekitar 15,4 W, 802.3at sekitar 30 W, 802.3bt lebih tinggi lagi.'));
  ict('ict-splitter', t('Pada GPON, alat pasif yang membagi satu fiber ke banyak pelanggan disebut?'), t('Splitter optik'), [t('Repeater'), t('Media converter'), t('Patch panel')], t('Splitter optik pasif membagi sinyal OLT ke banyak ONT, misalnya 1:8 atau 1:16.'));
  ict('ict-nvr', t('NVR pada sistem CCTV berfungsi untuk?'), t('Merekam dan menyimpan video kamera IP'), [t('Memberi daya ke kamera'), t('Memperbesar jangkauan WiFi'), t('Mengatur suhu ruang server')], t('NVR (Network Video Recorder) menyimpan rekaman dari kamera IP.'));

  return raw.map((r) => {
    const opts = [r.right, ...r.wrong];
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    return { id: r.id, q: r.q, opts, answer: opts.indexOf(r.right), why: r.why };
  });
}

const PER_SESSION = 5;
const Q_TIME = 15;
const REVEAL = 4;
/** Reveal ignores input this long so the tap that answered cannot also skip the explanation. */
const REVEAL_GUARD = 0.3;

const meta: GameModule['meta'] = {
  id: 'kuis-perpustakaan', title: 'Kuis Perpustakaan', place: 'bookshelf', music: 'calm',
  blurb: 'Lima soal tentang kantor ini dan dunia ICT/ISP. 15 detik per soal.',
  view: { w: 640, h: 400 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'right', 'up', 'down', 'a'],
  tutorial: [
    'Baca soal, pilih jawaban dengan {arah}.',
    'Tekan {a} untuk mengunci jawaban. Waktunya 15 detik per soal.',
    'Jawaban cepat dapat bonus. Tekan {a} lagi untuk soal berikutnya.',
  ],
  legend: [['arah', 'Pilih jawaban'], ['a', 'Kunci / lanjut']],
  actions: { arah: 'Pilih jawaban', a: 'Kunci jawaban / soal berikutnya' },
  pointerHint: 'Ketuk jawaban untuk menguncinya, ketuk lagi untuk soal berikutnya',
};

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const bank = buildBank(ctx.t, () => ctx.rand());
  const qs: Question[] = [];
  {
    const office = bank.filter((q) => q.id.startsWith('office'));
    const other = bank.filter((q) => !q.id.startsWith('office'));
    // two office questions, three ICT, then shuffle the order
    for (let i = 0; i < 2; i++) qs.push(office.splice(Math.floor(ctx.rand() * office.length), 1)[0]);
    for (let i = 0; i < PER_SESSION - 2; i++) qs.push(other.splice(Math.floor(ctx.rand() * other.length), 1)[0]);
    for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(ctx.rand() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
  }
  let idx = 0;
  let sel = 0;
  let left = Q_TIME;
  let phase: 'ask' | 'reveal' = 'ask';
  let revealT = 0;
  let picked: number | null = null;
  let correct = 0, bonus = 0;
  let ended = false;
  let anim = 0;
  let selT = 0;
  let pickT = 0;
  let shake = 0;
  let qIn = 0;
  let gained = 0;
  let lastPtr = { x: -1, y: -1 };
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; col: string }[] = [];
  const results: boolean[] = [];
  const nova = ctx.cast.find((c) => c.id === 'CH-ICTSPEC') ?? ctx.cast[0];

  const score = () => correct * 100 + bonus;
  const hud = () => ctx.setHud(ctx.t('Benar {c} · {p} poin', { c: correct, p: score() }));

  function answer(i: number | null) {
    picked = i;
    const ok = i !== null && i === qs[idx].answer;
    results.push(ok);
    gained = 0;
    if (ok) { gained = 100 + Math.ceil(left) * 5; correct++; bonus += Math.ceil(left) * 5; ctx.sfx('right'); } else { ctx.sfx('wrong'); shake = i === null ? 0 : 0.35; }
    phase = 'reveal';
    revealT = REVEAL;
    pickT = 1;
    if (ok && !ctx.reducedMotion) {
      const b = box(i!);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const v = 80 + (k % 3) * 40;
        sparks.push({ x: b.x + OW / 2, y: b.y + OH / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.7, col: k % 2 ? PAL.gold : '#9be37a' });
      }
    }
    hud();
  }
  function next() {
    idx++;
    if (idx >= PER_SESSION) {
      ended = true;
      ctx.end({ score: score(), won: correct >= 3, summary: ctx.t('{c} dari {m} soal benar', { c: correct, m: PER_SESSION }) });
      return;
    }
    phase = 'ask'; left = Q_TIME; sel = 0; picked = null; qIn = 1; selT = 1;
    ctx.sfx('page');
    hud();
  }

  // option boxes, 2x2
  const OX = 20, OY = 168, OW = 296, OH = 74, GAP = 8;
  const box = (i: number) => ({ x: OX + (i % 2) * (OW + GAP), y: OY + Math.floor(i / 2) * (OH + GAP) });
  const boxAt = (x: number, y: number) => {
    for (let i = 0; i < 4; i++) { const b = box(i); if (x >= b.x && x <= b.x + OW && y >= b.y && y <= b.y + OH) return i; }
    return -1;
  };

  hud();

  return {
    update(dt, inp) {
      if (ended) return;
      anim += dt;
      selT = Math.max(0, selT - dt * 6);
      pickT = Math.max(0, pickT - dt * 3);
      shake = Math.max(0, shake - dt);
      qIn = Math.max(0, qIn - dt * 4);
      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 240 * dt; s.life -= dt; }
      for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
      if (phase === 'reveal') {
        revealT -= dt;
        if (revealT <= 0 || (revealT < REVEAL - REVEAL_GUARD && (inp.hit.a || inp.tap))) next();
        return;
      }
      left -= dt;
      if (left <= 0) { left = 0; answer(null); return; }
      if (inp.tap) {
        const i = boxAt(inp.tap.x, inp.tap.y);
        if (i >= 0) { sel = i; answer(i); }
        return;
      }
      // mouse hover moves the highlight, so a click and the keys agree on the choice
      if (inp.ptr && (inp.ptr.x !== lastPtr.x || inp.ptr.y !== lastPtr.y)) {
        lastPtr = { x: inp.ptr.x, y: inp.ptr.y };
        const i = boxAt(inp.ptr.x, inp.ptr.y);
        if (i >= 0 && i !== sel) { sel = i; selT = 1; ctx.sfx('tick'); }
      }
      if (inp.hit.left || inp.hit.right) { sel ^= 1; selT = 1; ctx.sfx('tick'); }
      if (inp.hit.up || inp.hit.down) { sel ^= 2; selT = 1; ctx.sfx('tick'); }
      if (inp.hit.a) answer(sel);
    },
    render() {
      g.fillStyle = '#efe3cc';
      g.fillRect(0, 0, w, h);
      const q = qs[Math.min(idx, PER_SESSION - 1)];
      g.fillStyle = PAL.surface;
      roundRect(g, 12, 10, w - 24, 148, 10);
      text(g, ctx.t('Soal {n}/{m}', { n: Math.min(idx + 1, PER_SESSION), m: PER_SESSION }), 28, 30, 15, PAL.accent, 'left');
      // timer
      const tw = 200;
      g.fillStyle = 'rgba(29,42,35,0.12)';
      g.fillRect(w - 28 - tw, 26, tw, 8);
      g.fillStyle = left < 5 ? PAL.red : PAL.green;
      g.fillRect(w - 28 - tw, 26, tw * (left / Q_TIME), 8);
      text(g, ctx.t('{s} dtk', { s: Math.ceil(left) }), w - 34 - tw, 30, 14, left < 5 ? PAL.red : PAL.ink2, 'right');
      wrapText(q.q, 28, 64, w - 150, 21, 25, PAL.ink, 3);
      drawChar(g, nova, w - 62, 150, 80, -1, phase === 'reveal' ? (picked === q.answer ? 'win' : 'hurt') : 'idle', anim);

      for (let i = 0; i < 4; i++) {
        const b0 = box(i);
        let fill = PAL.surface, ink = PAL.ink;
        if (phase === 'reveal') {
          if (i === q.answer) { fill = PAL.green; ink = '#ffffff'; }
          else if (i === picked) { fill = PAL.red; ink = '#ffffff'; }
        } else if (i === sel) fill = '#fff3d6';
        // squash on the picked box, slide-in for a new question, shake on a miss
        let sc = 1, dx = 0, dy = 0;
        if (!ctx.reducedMotion) {
          if (phase === 'reveal' && i === picked) sc = 1 + Math.sin(pickT * Math.PI) * 0.06;
          else if (phase === 'reveal' && i === q.answer && picked !== q.answer) sc = 1 + Math.sin(pickT * Math.PI * 2) * 0.03;
          else if (phase === 'ask' && i === sel) sc = 1 + selT * 0.035;
          if (phase === 'reveal' && i === picked && picked !== q.answer) dx = Math.sin(shake * 70) * shake * 18;
          dy = qIn * qIn * (24 + i * 10);
        }
        g.save();
        g.translate(b0.x + OW / 2 + dx, b0.y + OH / 2 + dy);
        g.scale(sc, sc);
        g.globalAlpha = 1 - qIn * 0.8;
        const b = { x: -OW / 2, y: -OH / 2 };
        g.fillStyle = fill;
        roundRect(g, b.x, b.y, OW, OH, 10);
        if (phase === 'ask' && i === sel) { g.strokeStyle = PAL.gold; g.lineWidth = 3; g.strokeRect(b.x + 1.5, b.y + 1.5, OW - 3, OH - 3); }
        text(g, 'ABCD'[i], b.x + 18, 0, 18, phase === 'reveal' && (i === q.answer || i === picked) ? '#ffffff' : PAL.accent);
        wrapText(q.opts[i], b.x + 36, 0, OW - 66, 15, 17, ink, 3, true);
        if (phase === 'reveal' && (i === q.answer || i === picked)) text(g, i === q.answer ? '✓' : '✗', b.x + OW - 16, 0, 18, '#ffffff');
        g.restore();
      }
      for (const sp of sparks) { g.globalAlpha = Math.max(0, sp.life / 0.7); g.fillStyle = sp.col; g.fillRect(sp.x - 2.5, sp.y - 2.5, 5, 5); }
      g.globalAlpha = 1;
      if (phase === 'reveal' && gained > 0 && picked !== null) {
        const b = box(picked);
        const k = 1 - pickT;
        g.globalAlpha = Math.min(1, pickT * 3);
        text(g, ctx.t('+{p} poin', { p: gained }), b.x + OW / 2, b.y - 4 - k * 18, 18, PAL.green);
        g.globalAlpha = 1;
      }
      if (phase === 'reveal') {
        const k = ctx.reducedMotion ? 1 : Math.min(1, (REVEAL - revealT) / 0.18);
        const py = h - 66 + (1 - (1 - Math.pow(1 - k, 3))) * 70;
        g.fillStyle = 'rgba(29,42,35,0.94)';
        roundRect(g, 12, py, w - 24, 58, 10);
        const ok = picked === q.answer;
        text(g, picked === null ? ctx.t('Waktu habis!') : ok ? ctx.t('Benar!') : ctx.t('Kurang tepat'), 28, py + 16, 15, ok ? '#9be37a' : '#ffb39e', 'left');
        if (revealT < REVEAL - REVEAL_GUARD) text(g, idx + 1 < PER_SESSION ? ctx.t('{a} atau ketuk: lanjut', { a: ctx.key('a') }) : ctx.t('{a} atau ketuk: lihat hasil', { a: ctx.key('a') }), w - 28, py + 16, 12, '#d9e4dc', 'right', 400);
        wrapText(q.why, 28, py + 38, w - 60, 13, 15, '#fffaf0', 2);
      }
    },
    snapshot: () => ({
      idx, sel, phase, picked, left: Math.round(left * 100) / 100, correct, bonus, score: score(), ended, results: [...results],
      qs: qs.map((q) => ({ id: q.id, answer: q.answer, opts: [...q.opts] })),
    }),
  };

  function wrapText(s: string, x: number, y: number, maxW: number, size: number, lh: number, color: string, maxLines: number, vcenter = false) {
    let sz = size;
    let lines: string[] = [];
    for (; sz >= 11; sz--) {
      g.font = `700 ${sz}px 'Alegreya Sans', system-ui, sans-serif`;
      lines = [];
      let cur = '';
      for (const wd of s.split(' ')) { const tt = cur ? `${cur} ${wd}` : wd; if (g.measureText(tt).width > maxW && cur) { lines.push(cur); cur = wd; } else cur = tt; }
      lines.push(cur);
      if (lines.length <= maxLines) break;
    }
    const l = lh * (sz / size);
    const y0 = vcenter ? y - ((lines.length - 1) * l) / 2 : y;
    lines.slice(0, maxLines).forEach((ln, i) => text(g, ln, x, y0 + i * l, sz, color, 'left'));
  }
}

export default { meta, create } satisfies GameModule;
