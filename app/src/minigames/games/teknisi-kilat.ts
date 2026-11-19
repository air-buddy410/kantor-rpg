// Teknisi Kilat (Game Station slot 8). Co-op, top-down: outage tickets pop up
// at customer homes, each needing one tool from the PerumNet warehouse. Fetch
// the right tool, hold A at the house until the bar fills, before the SLA runs
// out. Three minute shift, one team score for the leaderboard.
// No CPU players: every technician is a human, and more humans means more
// tickets, so the shift stays busy at any table size.
import type { CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { PLAYER_COLORS } from '../local-players';
import { PAL, drawToken, roundRect, text } from '../cast';

export type Tool = 'ont' | 'kabel' | 'konektor' | 'splitter';
export const TOOLS: Tool[] = ['ont', 'kabel', 'konektor', 'splitter'];
const TOOL_LABEL: Record<Tool, string> = { ont: 'ONT baru', kabel: 'Kabel drop', konektor: 'Konektor', splitter: 'Splitter' };
const TOOL_COLOR: Record<Tool, string> = { ont: '#3c6e91', kabel: '#d0702a', konektor: '#2f8f8a', splitter: '#8a5a9c' };

export const W = 960;
export const H = 600;
export const TOP = 40;
export const SHIFT = 180;
export const REPAIR_T = 1.5;
export const SLA0 = 28;
export const SLA_MIN = 20;
export const STRIKES = 3;
/** How close (centre to building edge) a technician must stand to use it. */
export const REACH = 26;
const HALF = 12;
const SPEED = 210;
/** Mean seconds between tickets at the start of the shift, by player count. */
const SPAWN_BASE = [13, 8, 6, 4.5];
/** Road centre lines; roads are drawn only, every open tile is walkable. */
export const ROADS_Y = [220, 430];
export const ROADS_X = [230, 480, 720];
const ROOF = ['#a34a27', '#3c6e91', '#6f9a58', '#8a6d3b'];

export interface Rect { x: number; y: number; w: number; h: number }
export interface House extends Rect { door: 'top' | 'bottom' }
export const STATIONS = TOOLS.map((tool, i) => ({ tool, x: 24, y: 80 + i * 120, w: 56, h: 64 }));
// the bottom row opens toward the road above it, so every door faces a road
export const HOUSES: House[] = [[310, 70], [550, 70], [790, 70], [310, 280], [790, 280], [310, 500], [550, 500], [790, 500]]
  .map(([x, y]): House => ({ x, y, w: 100, h: 64, door: y > 450 ? 'top' : 'bottom' }));
const ODP: Rect = { x: 584, y: 294, w: 32, h: 36 };
const SOLIDS: Rect[] = [...STATIONS, ...HOUSES, ODP];

/** Where a technician stands to use a station or a house (inside REACH). */
export function approach(r: Rect | House): { x: number; y: number } {
  if ('door' in r) return { x: r.x + r.w / 2, y: r.door === 'top' ? r.y - 22 : r.y + r.h + 22 };
  return { x: r.x + r.w + 22, y: r.y + r.h / 2 };
}

const distTo = (px: number, py: number, r: Rect) => Math.hypot(Math.max(r.x - px, 0, px - r.x - r.w), Math.max(r.y - py, 0, py - r.y - r.h));

const meta: GameModule['meta'] = {
  id: 'teknisi-kilat', title: 'Teknisi Kilat', place: 'arcade', music: 'puzzle',
  blurb: 'Kerja tim: perbaiki gangguan sebelum SLA habis.',
  view: { w: W, h: H }, score: { unit: 'poin', higherIsBetter: true },
  touch: ['left', 'up', 'down', 'right', 'a', 'b'],
  tutorial: [
    'Jalan dengan {arah}. Tekan {a} di rak gudang untuk ambil alat yang diminta tiket.',
    'Di rumah bertiket, tahan {a} sampai bar penuh. Alat salah tidak bisa dipakai.',
    'Tekan {b} untuk menaruh alat, rekan bisa mengambilnya. Lewat SLA 3 kali, shift selesai.',
  ],
  legend: [['arah', 'Jalan'], ['a', 'Ambil / perbaiki'], ['b', 'Taruh alat']],
  actions: { arah: 'Jalan', a: 'Ambil alat, tahan untuk perbaiki', b: 'Taruh alat di tanah' },
  players: 4,
  playersHint: 'Kerja sama sampai 4 pemain. Tidak ada lawan komputer: makin banyak pemain, makin banyak tiket.',
};

const NONE = { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false };
const NO_INPUT: InputState = { down: NONE, hit: NONE, ax: 0, ay: 0, tap: null };

interface Tech { c: CastMember; x: number; y: number; carry: Tool | null; moving: boolean; say: string; sayT: number }
interface Ticket { id: number; house: number; tool: Tool; sla: number; max: number; progress: number; alarmed: boolean; working: boolean }
interface Item { x: number; y: number; tool: Tool }
interface Fx { x: number; y: number; s: string; t: number; ok: boolean }

function create(ctx: GameCtx): GameInstance {
  const { g } = ctx;
  const humans = Math.max(1, Math.min(4, ctx.players));
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  // field crew first: Bruno and Nova do the real installs
  const pref = ['CH-NETINSTALL', 'CH-ICTSPEC', 'CH-SUPERVISOR', 'CH-QA'].map((id) => ctx.cast.find((c) => c.id === id));
  const crew: CastMember[] = [me];
  for (const c of [...pref, ...ctx.cast]) if (c && crew.length < humans && !crew.includes(c)) crew.push(c);
  const techs: Tech[] = crew.map((c, i) => ({ c, x: 150, y: 130 + i * 90, carry: null, moving: false, say: '', sayT: 0 }));
  // a scripted perfect solo run scores about 2800; a human crew should need real teamwork
  const target = 1500 + 800 * (humans - 1);

  let tickets: Ticket[] = [];
  const ground: Item[] = [];
  let fx: Fx[] = [];
  let phase: 'play' | 'over' = 'play';
  let elapsed = 0, time = 0, shake = 0;
  let spawnT = 2;
  let spawned = 0, fixed = 0, missed = 0, strikes = 0, score = 0;

  const pan = (x: number) => (x / W) * 2 - 1;
  const near = (p: Tech, r: Rect) => distTo(p.x, p.y, r) <= REACH;
  const ticketFor = (p: Tech, tool: Tool | null) => tickets.find((tk) => tk.tool === tool && near(p, HOUSES[tk.house]));
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const left = () => Math.max(0, Math.ceil(SHIFT - elapsed));
  const hud = () => ctx.setHud(ctx.t('Skor {s} · Tiket {n} · Waktu {m}', { s: score, n: fixed, m: mmss(left()) }));
  const say = (p: Tech, s: string) => { p.say = s; p.sayT = 1.1; };

  function spawn(k: number) {
    const free = HOUSES.map((_, i) => i).filter((i) => !tickets.some((tk) => tk.house === i));
    if (!free.length) return;
    const house = free[Math.floor(ctx.rand() * free.length)];
    const tool = TOOLS[Math.floor(ctx.rand() * TOOLS.length)];
    const max = SLA0 - (SLA0 - SLA_MIN) * k;
    tickets.push({ id: ++spawned, house, tool, sla: max, max, progress: 0, alarmed: false, working: false });
    ctx.sfx('beep', { pan: pan(HOUSES[house].x), gain: 0.5 });
  }

  /** Move one axis, then push out of any building it ran into (slides along walls). */
  function slide(p: Tech, dx: number, dy: number) {
    p.x = Math.max(HALF, Math.min(W - HALF, p.x + dx));
    p.y = Math.max(TOP + HALF, Math.min(H - HALF, p.y + dy));
    for (const r of SOLIDS) {
      if (p.x + HALF <= r.x || p.x - HALF >= r.x + r.w || p.y + HALF <= r.y || p.y - HALF >= r.y + r.h) continue;
      if (dx > 0) p.x = r.x - HALF; else if (dx < 0) p.x = r.x + r.w + HALF;
      if (dy > 0) p.y = r.y - HALF; else if (dy < 0) p.y = r.y + r.h + HALF;
    }
  }

  function press(p: Tech) {
    const st = STATIONS.find((s) => near(p, s));
    if (st) {
      if (p.carry !== st.tool) { p.carry = st.tool; ctx.sfx('click', { pan: pan(p.x) }); }
      return;
    }
    // the matching ticket is worked by holding A, a press must not swap the tool away
    if (p.carry && ticketFor(p, p.carry)) return;
    let gi = -1, gd = REACH;
    ground.forEach((it, i) => { const d = Math.hypot(it.x - p.x, it.y - p.y); if (d <= gd) { gd = d; gi = i; } });
    if (gi >= 0) {
      const it = ground.splice(gi, 1)[0];
      if (p.carry) ground.push({ x: it.x, y: it.y, tool: p.carry });
      p.carry = it.tool;
      ctx.sfx('click', { pan: pan(p.x) });
      return;
    }
    const tk = tickets.find((k) => near(p, HOUSES[k.house]));
    if (!tk) return;
    if (p.carry) { say(p, ctx.t('Alat salah')); ctx.sfx('wrong', { pan: pan(p.x), gain: 0.6 }); }
    else say(p, ctx.t('Butuh {tool}', { tool: ctx.t(TOOL_LABEL[tk.tool]) }));
  }

  function fix(tk: Ticket, p: Tech) {
    const pts = 100 + Math.floor(tk.sla) * 5;
    score += pts;
    fixed++;
    tickets = tickets.filter((k) => k !== tk);
    p.carry = null;
    const hs = HOUSES[tk.house];
    fx.push({ x: hs.x + hs.w / 2, y: hs.y + 10, s: `+${pts}`, t: 1.2, ok: true });
    ctx.sfx('connect', { pan: pan(hs.x) });
  }

  function miss(tk: Ticket) {
    score -= 50;
    missed++;
    strikes++;
    tickets = tickets.filter((k) => k !== tk);
    const hs = HOUSES[tk.house];
    fx.push({ x: hs.x + hs.w / 2, y: hs.y + 10, s: ctx.t('Lewat SLA'), t: 1.4, ok: false });
    ctx.sfx('wrong', { pan: pan(hs.x) });
    ctx.rumble(0.5, 160);
    if (!ctx.reducedMotion) shake = 0.3;
  }

  function finish() {
    phase = 'over';
    hud();
    // the running score may dip below zero; the leaderboard never shows a negative
    ctx.end({ score: Math.max(0, score), won: score >= target, summary: ctx.t('{n} tiket beres, {m} lewat SLA', { n: fixed, m: missed }) });
  }

  hud();

  return {
    update(dt, inp) {
      if (phase === 'over') return;
      time += dt;
      elapsed += dt;
      shake = Math.max(0, shake - dt);
      const k = Math.min(1, elapsed / SHIFT);
      spawnT -= dt;
      if (spawnT <= 0) {
        spawn(k);
        spawnT = SPAWN_BASE[humans - 1] * (1 - 0.3 * k) * (0.8 + ctx.rand() * 0.4);
      }
      const ins = inp.players ?? [inp];
      for (const tk of tickets) tk.working = false;
      techs.forEach((p, i) => {
        const pin = ins[i] ?? NO_INPUT;
        p.sayT = Math.max(0, p.sayT - dt);
        const m = Math.hypot(pin.ax, pin.ay);
        p.moving = m > 0.15;
        if (p.moving) {
          // full speed at full tilt or on keys (diagonals normalised), slower on a gentle tilt
          const s = (SPEED * dt * Math.min(1, m)) / m;
          slide(p, pin.ax * s, 0);
          slide(p, 0, pin.ay * s);
        }
        if (pin.hit.b && p.carry) {
          ground.push({ x: p.x, y: p.y + 4, tool: p.carry });
          // keep the street readable: the oldest dropped tool goes back to the warehouse
          if (ground.length > 12) ground.shift();
          p.carry = null;
          ctx.sfx('clank', { pan: pan(p.x) });
        } else if (pin.hit.a) press(p);
        if (pin.down.a && p.carry) {
          const tk = ticketFor(p, p.carry);
          if (tk) {
            tk.progress += dt;
            tk.working = true;
            if (tk.progress >= REPAIR_T) fix(tk, p);
          }
        }
      });
      for (const tk of [...tickets]) {
        tk.sla -= dt;
        if (!tk.alarmed && tk.sla < 5) { tk.alarmed = true; ctx.sfx('alarm', { pan: pan(HOUSES[tk.house].x), gain: 0.6 }); }
        if (tk.sla <= 0) miss(tk);
      }
      for (const f of fx) f.t -= dt;
      fx = fx.filter((f) => f.t > 0);
      hud();
      if (strikes >= STRIKES || elapsed >= SHIFT) finish();
    },

    render() {
      g.save();
      if (shake > 0 && !ctx.reducedMotion) g.translate(Math.sin(time * 80) * shake * 10, Math.cos(time * 63) * shake * 7);
      g.fillStyle = '#bcd49c';
      g.fillRect(-12, -12, W + 24, H + 24);
      drawRoads();
      drawWarehouse();
      drawTown();
      for (const it of ground) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.beginPath(); g.ellipse(it.x, it.y + 9, 10, 3.5, 0, 0, Math.PI * 2); g.fill();
        drawTool(it.tool, it.x, it.y, 10);
      }
      const order = techs.map((_, i) => i).sort((a, b) => techs[a].y - techs[b].y);
      for (const i of order) drawTech(i);
      for (const tk of tickets) drawTicket(tk);
      for (const f of fx) {
        const u = f.t / 1.2;
        g.globalAlpha = Math.min(1, u * 1.5);
        text(g, f.s, f.x, f.y - (ctx.reducedMotion ? 0 : (1 - u) * 26), 18, f.ok ? PAL.green : PAL.red);
        g.globalAlpha = 1;
      }
      g.restore();
      drawBar();
      if (elapsed < 1.8 && phase === 'play') {
        g.globalAlpha = Math.min(1, (1.8 - elapsed) / 0.4);
        g.fillStyle = 'rgba(255,250,240,0.92)';
        roundRect(g, W / 2 - 130, H / 2 - 28, 260, 56, 14);
        text(g, ctx.t('Shift dimulai!'), W / 2, H / 2, 26, PAL.green);
        g.globalAlpha = 1;
      }
    },

    snapshot: () => ({
      phase, timeLeft: Math.round(Math.max(0, SHIFT - elapsed) * 100) / 100, elapsed: Math.round(elapsed * 100) / 100,
      score, target, fixed, missed, strikes, spawned, humans,
      tickets: tickets.map((tk) => ({ id: tk.id, house: tk.house, tool: tk.tool, slaLeft: Math.round(tk.sla * 100) / 100, sla: Math.round(tk.max * 100) / 100, progress: Math.round(tk.progress * 1000) / 1000 })),
      players: techs.map((p) => ({ id: p.c.id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, carrying: p.carry })),
      ground: ground.map((it) => ({ x: Math.round(it.x), y: Math.round(it.y), tool: it.tool })),
    }),
  };

  function drawRoads() {
    g.fillStyle = PAL.road;
    for (const y of ROADS_Y) g.fillRect(210, y - 20, W - 198, 40);
    for (const x of ROADS_X) g.fillRect(x - 20, TOP, 40, H - TOP + 12);
    g.fillStyle = 'rgba(233,226,208,0.7)';
    for (const y of ROADS_Y) for (let x = 262; x < W; x += 36) if (!ROADS_X.some((rx) => Math.abs(x + 8 - rx) < 28)) g.fillRect(x, y - 1.5, 16, 3);
    for (const x of ROADS_X) for (let y = TOP + 10; y < H; y += 36) if (!ROADS_Y.some((ry) => Math.abs(y + 8 - ry) < 28)) g.fillRect(x - 1.5, y, 3, 16);
  }

  function drawWarehouse() {
    g.fillStyle = '#d9d2c3';
    g.fillRect(0, TOP, 200, H - TOP);
    g.fillStyle = '#5d5a52';
    g.fillRect(0, TOP, 200, 6);
    g.fillRect(0, H - 6, 200, 6);
    g.fillRect(0, TOP, 6, H - TOP);
    // loading dock edge: the open side faces the road
    for (let y = TOP + 6, n = 0; y < H - 6; y += 12, n++) { g.fillStyle = n % 2 ? '#d9a441' : '#2b2b2b'; g.fillRect(196, y, 6, 12); }
    text(g, ctx.t('Gudang PerumNet'), 104, TOP + 22, 14, PAL.green);
    for (const s of STATIONS) {
      g.fillStyle = 'rgba(0,0,0,0.15)';
      roundRect(g, s.x + 3, s.y + 5, s.w, s.h, 8);
      g.fillStyle = '#8a6d3b';
      roundRect(g, s.x, s.y, s.w, s.h, 8);
      g.fillStyle = '#efe3cc';
      roundRect(g, s.x + 4, s.y + 4, s.w - 8, s.h - 8, 6);
      g.fillStyle = TOOL_COLOR[s.tool];
      g.fillRect(s.x + 4, s.y + s.h - 10, s.w - 8, 6);
      drawTool(s.tool, s.x + s.w / 2, s.y + s.h / 2 - 3, 18);
      text(g, ctx.t(TOOL_LABEL[s.tool]), s.x + s.w / 2 + 10, s.y + s.h + 13, 13, PAL.ink);
    }
  }

  function drawTown() {
    // small park around the ODP box in the middle block
    g.fillStyle = '#9fc27f';
    roundRect(g, 540, 272, 120, 82, 12);
    g.fillStyle = PAL.grass;
    for (const [x, y] of [[556, 290], [646, 336], [560, 338]]) { g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#7d8288';
    roundRect(g, ODP.x, ODP.y, ODP.w, ODP.h, 4);
    text(g, 'ODP', ODP.x + ODP.w / 2, ODP.y + ODP.h / 2, 11, '#fffaf0');
    HOUSES.forEach((hs, i) => {
      const down = tickets.some((tk) => tk.house === i);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      roundRect(g, hs.x + 4, hs.y + 6, hs.w, hs.h, 6);
      g.fillStyle = '#c9b48a';
      g.fillRect(hs.x + hs.w / 2 - 12, hs.door === 'top' ? hs.y - 9 : hs.y + hs.h + 3, 24, 6);
      // the roof sits on the side away from the road, the door on the wall facing it
      const top = hs.door === 'bottom';
      g.fillStyle = '#f4e7cf';
      roundRect(g, hs.x, top ? hs.y + 14 : hs.y, hs.w, hs.h - 14, 5);
      g.fillStyle = ROOF[i % ROOF.length];
      roundRect(g, hs.x - 4, top ? hs.y : hs.y + hs.h - 24, hs.w + 8, 24, 6);
      // windows go dark while the customer is offline
      g.fillStyle = down ? '#7d8288' : '#bfe0e6';
      const wy = top ? hs.y + 32 : hs.y + 18;
      g.fillRect(hs.x + 12, wy, 18, 14);
      g.fillRect(hs.x + hs.w - 30, wy, 18, 14);
      g.fillStyle = '#8a6d3b';
      if (top) g.fillRect(hs.x + hs.w / 2 - 8, hs.y + hs.h - 20, 16, 20);
      else g.fillRect(hs.x + hs.w / 2 - 8, hs.y, 16, 20);
      text(g, String(i + 1), hs.x + hs.w - 10, top ? hs.y + hs.h - 9 : hs.y + 9, 12, PAL.ink2);
      if (down) {
        g.strokeStyle = PAL.red;
        g.lineWidth = 3;
        g.strokeRect(hs.x - 6, hs.y - 2, hs.w + 12, hs.h + 4);
      }
    });
  }

  function drawTicket(tk: Ticket) {
    const hs = HOUSES[tk.house];
    const bx = hs.x + hs.w / 2, by = hs.y + 6;
    const f = Math.max(0, tk.sla / tk.max);
    const col = f > 0.5 ? '#3f9a54' : f > 0.25 ? PAL.gold : PAL.red;
    const blink = tk.sla < 5 && !ctx.reducedMotion && Math.floor(time * 4) % 2 === 0;
    g.fillStyle = blink ? '#f6d9cf' : PAL.surface;
    g.beginPath(); g.arc(bx, by, 19, 0, Math.PI * 2); g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(29,42,35,0.18)';
    g.beginPath(); g.arc(bx, by, 19, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = col;
    g.beginPath(); g.arc(bx, by, 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); g.stroke();
    drawTool(tk.tool, bx, by, 13);
    g.fillStyle = 'rgba(255,250,240,0.9)';
    roundRect(g, bx + 24, by - 10, 30, 20, 6);
    text(g, String(Math.ceil(tk.sla)), bx + 39, by, 13, col);
    if (tk.progress > 0) {
      g.fillStyle = 'rgba(29,42,35,0.55)';
      roundRect(g, bx - 36, by + 26, 72, 10, 4);
      g.fillStyle = tk.working ? '#7ee08f' : PAL.gold;
      roundRect(g, bx - 34, by + 28, 68 * Math.min(1, tk.progress / REPAIR_T), 6, 3);
    }
  }

  function drawTech(i: number) {
    const p = techs[i];
    g.strokeStyle = PLAYER_COLORS[i];
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(p.x, p.y + 12, 15, 6, 0, 0, Math.PI * 2); g.stroke();
    drawToken(g, p.c, p.x, p.y - 4, 14, time, p.moving && !ctx.reducedMotion);
    if (humans > 1) text(g, `P${i + 1}`, p.x, p.y - 30, 11, PLAYER_COLORS[i]);
    if (p.carry) drawTool(p.carry, p.x + 17, p.y - 20, 9);
    const k = ctx.key('a', i > 0);
    let msg = p.sayT > 0 ? p.say : '';
    if (!msg && STATIONS.some((s) => s.tool !== p.carry && near(p, s))) msg = ctx.t('{k}: ambil', { k });
    else if (!msg && p.carry && ticketFor(p, p.carry)) msg = ctx.t('Tahan {k}: perbaiki', { k });
    else if (!msg && ground.some((it) => Math.hypot(it.x - p.x, it.y - p.y) <= REACH)) msg = ctx.t('{k}: ambil', { k });
    if (!msg) return;
    const bw = msg.length * 6.5 + 16;
    g.fillStyle = p.sayT > 0 ? '#f6d9cf' : 'rgba(255,250,240,0.92)';
    roundRect(g, p.x - bw / 2, p.y + 20, bw, 18, 6);
    text(g, msg, p.x, p.y + 29, 11, p.sayT > 0 ? PAL.red : PAL.ink);
  }

  function drawBar() {
    g.fillStyle = '#f2e8d6';
    g.fillRect(0, 0, W, TOP);
    techs.forEach((p, i) => {
      const x = 8 + i * 150;
      g.fillStyle = PAL.surface;
      roundRect(g, x, 5, 142, 30, 8);
      g.fillStyle = PLAYER_COLORS[i];
      roundRect(g, x, 31, 142, 4, 2);
      drawToken(g, p.c, x + 17, 19, 10, time, false);
      text(g, `P${i + 1} ${p.c.name}`, x + 34, 20, 13, PAL.ink, 'left');
      if (p.carry) drawTool(p.carry, x + 128, 19, 8);
    });
    text(g, ctx.t('Target {t}', { t: target }), 622, 20, 13, PAL.ink2, 'left');
    text(g, ctx.t('Lewat SLA'), 836, 20, 12, PAL.ink2, 'right');
    for (let k = 0; k < STRIKES; k++) {
      g.fillStyle = k < strikes ? PAL.red : '#d8cfbd';
      roundRect(g, 842 + k * 20, 12, 16, 16, 4);
    }
    const s = left();
    text(g, mmss(s), 930, 20, 18, s <= 20 ? PAL.red : PAL.ink);
  }

  /** Tool badge: a coloured disc with a white glyph, readable at any size. */
  function drawTool(tool: Tool, x: number, y: number, r: number) {
    g.fillStyle = TOOL_COLOR[tool];
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fffaf0';
    g.strokeStyle = '#fffaf0';
    g.lineWidth = Math.max(1.5, r * 0.16);
    g.lineCap = 'round';
    g.beginPath();
    if (tool === 'ont') {
      g.moveTo(x - r * 0.35, y - r * 0.1); g.lineTo(x - r * 0.45, y - r * 0.6);
      g.moveTo(x + r * 0.35, y - r * 0.1); g.lineTo(x + r * 0.45, y - r * 0.6);
      g.stroke();
      roundRect(g, x - r * 0.6, y - r * 0.15, r * 1.2, r * 0.6, r * 0.12);
      g.fillStyle = TOOL_COLOR[tool];
      for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(x + k * r * 0.3, y + r * 0.15, r * 0.09, 0, Math.PI * 2); g.fill(); }
    } else if (tool === 'kabel') {
      g.arc(x, y, r * 0.5, 0, Math.PI * 2);
      g.moveTo(x + r * 0.25, y); g.arc(x, y, r * 0.25, 0, Math.PI * 2);
      g.moveTo(x + r * 0.5, y); g.lineTo(x + r * 0.72, y + r * 0.5);
      g.stroke();
    } else if (tool === 'konektor') {
      g.fillRect(x - r * 0.55, y - r * 0.24, r * 0.65, r * 0.48);
      g.fillRect(x + r * 0.1, y - r * 0.11, r * 0.45, r * 0.22);
      g.moveTo(x - r * 0.55, y); g.lineTo(x - r * 0.8, y);
      g.stroke();
    } else {
      g.moveTo(x - r * 0.65, y); g.lineTo(x - r * 0.1, y);
      for (const k of [-0.45, -0.15, 0.15, 0.45]) { g.moveTo(x - r * 0.1, y); g.lineTo(x + r * 0.6, y + k * r); }
      g.stroke();
    }
  }
}

export default { meta, create } satisfies GameModule;
