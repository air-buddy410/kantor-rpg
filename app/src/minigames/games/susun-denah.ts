// Susun Denah (drafting_table, Studio Hugo). Floor plan puzzle: rooms from
// world.json are snapped to a coarse 1.5 m grid, a handful of them is cut out
// of the plan and the player puts each piece back into its place. Three plans
// per session, 60 s each.
import type { GameCtx, GameInstance, GameModule } from '../types';
import { PAL, drawChar, roundRect, text } from '../cast';
import worldJson from '@design/world.json';

export const CELL_M = 1.5;
const PLANS = 3;
const PLAN_TIME = 60;
const PIECES = 7;
const MAX_W = 12;

interface WorldRoom { id: string; floor: string; name: string; polygon: number[][] }
const WORLD = worldJson as unknown as { floors: { id: string; level: number; envelope: number[][] }[]; rooms: WorldRoom[] };

export interface RoomCell { id: string; floor: string; name: string; x: number; y: number; w: number; h: number }

/** Room bounding boxes on the coarse grid. Rounding is monotonic, so rooms that tile in metres still tile in cells. */
export function roomCells(floor: string): RoomCell[] {
  return WORLD.rooms.filter((r) => r.floor === floor).map((r) => {
    const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
    const x0 = Math.round(Math.min(...xs) / CELL_M), x1 = Math.round(Math.max(...xs) / CELL_M);
    const y0 = Math.round(Math.min(...ys) / CELL_M), y1 = Math.round(Math.max(...ys) / CELL_M);
    return { id: r.id, floor: r.floor, name: r.name, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }).filter((c) => c.w > 0 && c.h > 0);
}

export function floorCells(floor: string) {
  const env = WORLD.floors.find((f) => f.id === floor)!.envelope;
  return { w: Math.round(Math.max(...env.map((p) => p[0])) / CELL_M), h: Math.round(Math.max(...env.map((p) => p[1])) / CELL_M) };
}

const meta: GameModule['meta'] = {
  id: 'susun-denah', title: 'Susun Denah', place: 'drafting_table', music: 'puzzle',
  blurb: 'Potongan ruang lepas dari denah kantor. Kembalikan tiap ruang ke tempatnya sebelum waktu habis.',
  view: { w: 640, h: 400 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'right', 'up', 'down', 'a', 'b'],
  tutorial: [
    'Pilih potongan ruang di baki dengan {arah}, tekan {a} untuk ambil.',
    'Geser ke garis putus-putus yang cocok, lalu {a} untuk taruh.',
    '{b} mengembalikan potongan ke baki. Tiap denah 60 detik.',
  ],
  legend: [['arah', 'Pilih / geser'], ['a', 'Ambil / taruh'], ['b', 'Kembalikan']],
  actions: { arah: 'Pilih potongan / geser di denah', a: 'Ambil / taruh potongan', b: 'Kembalikan ke baki' },
  pointerHint: 'Seret potongan dari baki ke garis putus-putus yang cocok, lalu lepas',
};

interface Piece extends RoomCell { placed: boolean; tx: number; ty: number; pop: number }
interface Fx { x: number; y: number; vx: number; vy: number; life: number; col: string }

const REPEAT_DELAY = 0.24;
const REPEAT_RATE = 0.07;

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const used = new Set<string>();
  let planNo = 0;
  let floor = 'L1';
  let fw = 21, fh = 16;
  let context: RoomCell[] = [];
  let pieces: Piece[] = [];
  let left = PLAN_TIME;
  let sel = 0;
  let holding = false;
  const pos = { x: 0, y: 0 };
  let placedTotal = 0, timeBonus = 0, wrong = 0, plansDone = 0;
  let msg = '';
  let msgBad = false;
  let msgT = 0;
  let pause = 0;
  let ended = false;
  let anim = 0;
  // pointer drag: `drag` is set by a press on a piece, live position comes from input.ptr
  let drag: { ox: number; oy: number; sx: number; sy: number; moved: boolean; fromTray: boolean } | null = null;
  const dragAt = { x: 0, y: 0 };
  let overPlan = true;
  let repT = 0;
  let lastDir = '';
  let shake = 0;
  let squash = 0;
  const fx: Fx[] = [];
  const floats: { x: number; y: number; t: number; s: string }[] = [];
  const hugo = ctx.cast.find((c) => c.id === 'CH-ARCHITECT') ?? ctx.cast[0];

  // layout
  const FX = 14, FY = 70, CP = 14;
  const TX = 330, TY = 44, TW = 298, TH = 344;
  let tscale = 1;

  const say = (s: string, bad = false) => { msg = s; msgBad = bad; msgT = 2.2; };
  const score = () => placedTotal * 50 + timeBonus;
  const hud = () => ctx.setHud(ctx.t('Denah {n}/{m} · {p} poin', { n: Math.min(planNo, PLANS), m: PLANS, p: score() }));
  const open = () => pieces.filter((p) => !p.placed);
  const inPlan = (x: number, y: number) => x >= FX && x < FX + fw * CP && y >= FY && y < FY + fh * CP;
  const clampPos = (p: Piece) => {
    pos.x = Math.max(0, Math.min(fw - p.w, pos.x));
    pos.y = Math.max(0, Math.min(fh - p.h, pos.y));
  };

  function layoutTray() {
    // shelf packing; shrink the tray scale until everything fits
    const sorted = [...pieces].sort((a, b) => b.h - a.h || b.w - a.w || a.id.localeCompare(b.id));
    for (tscale = 1; tscale > 0.4; tscale -= 0.05) {
      let x = 0, y = 0, row = 0, ok = true;
      for (const p of sorted) {
        const pw = p.w * CP * tscale, ph = p.h * CP * tscale;
        if (x + pw > TW - 16) { x = 0; y += row + 8; row = 0; }
        if (y + ph > TH - 104) { ok = false; break; }
        p.tx = TX + 8 + x; p.ty = TY + 32 + y;
        x += pw + 8; row = Math.max(row, ph);
      }
      if (ok) break;
    }
    // arrow keys walk the tray in reading order, so keep the array in that order
    pieces.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  }

  function nextPlan() {
    planNo++;
    floor = planNo === 1 ? 'L1' : planNo === 2 ? 'L2' : ctx.rand() < 0.5 ? 'L1' : 'L2';
    ({ w: fw, h: fh } = floorCells(floor));
    const all = roomCells(floor);
    const cand = all.filter((r) => r.w <= MAX_W && r.w * r.h >= 2);
    const fresh = cand.filter((r) => !used.has(r.id));
    const pool = fresh.length >= PIECES ? fresh : [...fresh, ...cand.filter((r) => used.has(r.id))];
    const chosen: RoomCell[] = [];
    const bag = fresh.length >= PIECES ? [...pool] : [...fresh];
    while (chosen.length < PIECES && bag.length) chosen.push(bag.splice(Math.floor(ctx.rand() * bag.length), 1)[0]);
    const rest = pool.filter((r) => !chosen.includes(r));
    while (chosen.length < PIECES && rest.length) chosen.push(rest.splice(Math.floor(ctx.rand() * rest.length), 1)[0]);
    chosen.forEach((r) => used.add(r.id));
    pieces = chosen.map((r) => ({ ...r, placed: false, tx: 0, ty: 0, pop: 0 }));
    context = all.filter((r) => !chosen.some((c) => c.id === r.id));
    layoutTray();
    left = PLAN_TIME;
    sel = 0;
    holding = false;
    drag = null;
    say(ctx.t('Denah {n}: susun {k} ruang', { n: planNo, k: pieces.length }));
    hud();
  }

  function finish(won: boolean) {
    if (ended) return;
    ended = true;
    hud();
    ctx.end({ score: score(), won, summary: won ? ctx.t('{d} denah selesai, {p} potongan pas', { d: plansDone, p: placedTotal }) : ctx.t('Waktu habis di denah {n}, {p} potongan pas', { n: planNo, p: placedTotal }) });
  }

  function pick(i: number) {
    sel = i;
    holding = true;
    const p = open()[i];
    pos.x = Math.floor((fw - p.w) / 2);
    pos.y = Math.floor((fh - p.h) / 2);
    clampPos(p);
    squash = 1;
    ctx.sfx('click');
  }

  function burst(x: number, y: number, col: string) {
    if (ctx.reducedMotion) return;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const v = 60 + (k % 3) * 30;
      fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.6, col });
    }
  }

  function drop() {
    const p = open()[sel];
    if (!p) return;
    if (pos.x === p.x && pos.y === p.y) {
      p.placed = true;
      p.pop = 1;
      placedTotal++;
      holding = false;
      drag = null;
      ctx.sfx('connect');
      say(ctx.t('Pas!'));
      const cx = FX + (p.x + p.w / 2) * CP, cy = FY + (p.y + p.h / 2) * CP;
      burst(cx, cy, PAL.gold);
      floats.push({ x: cx, y: cy, t: 0.9, s: '+50' });
      sel = 0;
      if (!open().length) {
        plansDone++;
        timeBonus += Math.floor(left);
        ctx.sfx('right');
        say(ctx.t('Denah {n} selesai! Bonus waktu {s}', { n: planNo, s: Math.floor(left) }));
        pause = 1.4;
      }
      hud();
    } else {
      wrong++;
      shake = 0.3;
      ctx.sfx('wrong');
      say(ctx.t('Belum pas, coba posisi lain'), true);
    }
  }

  /** Grid position for a piece whose top-left corner sits at game point (x, y). */
  function snapTo(p: Piece, x: number, y: number) {
    pos.x = Math.round((x - FX) / CP);
    pos.y = Math.round((y - FY) / CP);
    clampPos(p);
  }

  function hitTray(x: number, y: number) {
    const list = open();
    return list.findIndex((p) => !(holding && list[sel] === p) && x >= p.tx - 3 && x <= p.tx + p.w * CP * tscale + 3 && y >= p.ty - 3 && y <= p.ty + p.h * CP * tscale + 3);
  }

  function press(x: number, y: number) {
    const list = open();
    const ti = hitTray(x, y);
    if (ti >= 0) {
      pick(ti);
      const p = list[ti];
      // finger holds the piece at the same relative spot it grabbed it, in plan scale
      const ox = ((x - p.tx) / tscale), oy = ((y - p.ty) / tscale);
      drag = { ox, oy, sx: x, sy: y, moved: false, fromTray: true };
      dragAt.x = x - ox; dragAt.y = y - oy;
      overPlan = false;
      return;
    }
    if (!holding) return;
    const p = list[sel];
    const px = FX + pos.x * CP, py = FY + pos.y * CP;
    if (x >= px && x <= px + p.w * CP && y >= py && y <= py + p.h * CP) {
      drag = { ox: x - px, oy: y - py, sx: x, sy: y, moved: false, fromTray: false };
      dragAt.x = px; dragAt.y = py;
      overPlan = true;
      squash = 1;
      return;
    }
    if (inPlan(x, y)) {
      // tap to place: centre the held piece on the tapped cell
      pos.x = Math.round((x - FX) / CP - p.w / 2);
      pos.y = Math.round((y - FY) / CP - p.h / 2);
      clampPos(p);
      drop();
    } else if (x >= TX && y >= TY - 6) { holding = false; ctx.sfx('back'); }
  }

  function updateDrag(ptr: { x: number; y: number; down: boolean } | null | undefined) {
    if (!drag) return;
    const p = open()[sel];
    if (!p) { drag = null; return; }
    if (ptr && ptr.down) {
      if (Math.hypot(ptr.x - drag.sx, ptr.y - drag.sy) > 6) drag.moved = true;
      dragAt.x = ptr.x - drag.ox; dragAt.y = ptr.y - drag.oy;
      const cx = dragAt.x + (p.w * CP) / 2;
      const was = overPlan;
      overPlan = cx < FX + fw * CP + CP;
      if (overPlan) {
        const ox = pos.x, oy = pos.y;
        snapTo(p, dragAt.x, dragAt.y);
        if (ox !== pos.x || oy !== pos.y || !was) ctx.sfx('tick');
      }
      return;
    }
    // released (or the pointer left the canvas)
    const d = drag;
    drag = null;
    overPlan = true;
    if (!d.moved) { if (!d.fromTray) drop(); return; }
    if (dragAt.x + (p.w * CP) / 2 < FX + fw * CP + CP) drop();
    else { holding = false; ctx.sfx('back'); }
  }

  nextPlan();

  return {
    update(dt, inp) {
      if (ended) return;
      anim += dt;
      msgT -= dt;
      shake = Math.max(0, shake - dt);
      squash = Math.max(0, squash - dt * 5);
      for (const p of pieces) p.pop = Math.max(0, p.pop - dt * 2.5);
      for (const f of fx) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 220 * dt; f.life -= dt; }
      for (let i = fx.length - 1; i >= 0; i--) if (fx[i].life <= 0) fx.splice(i, 1);
      for (const f of floats) f.t -= dt;
      for (let i = floats.length - 1; i >= 0; i--) if (floats[i].t <= 0) floats.splice(i, 1);
      if (pause > 0) {
        pause -= dt;
        if (pause <= 0) { if (plansDone >= PLANS) finish(true); else nextPlan(); }
        return;
      }
      left -= dt;
      if (left <= 0) { left = 0; ctx.sfx('alarm'); finish(false); return; }
      if (inp.tap) press(inp.tap.x, inp.tap.y);
      if (drag) { updateDrag(inp.ptr); return; }
      const list = open();
      if (!list.length) return;
      if (sel >= list.length) sel = 0;
      // held direction auto-repeats so long moves do not need many presses
      const dirs = ['right', 'left', 'down', 'up'] as const;
      let dir: string = dirs.find((d) => inp.hit[d]) ?? '';
      const held = dirs.find((d) => inp.down[d]) ?? '';
      if (dir) { repT = REPEAT_DELAY; lastDir = dir; } else if (held && held === lastDir) {
        repT -= dt;
        if (repT <= 0) { repT += REPEAT_RATE; dir = held; }
      } else { lastDir = held; repT = REPEAT_DELAY; }
      if (!holding) {
        if (dir === 'right' || dir === 'down') { sel = (sel + 1) % list.length; ctx.sfx('tick'); }
        if (dir === 'left' || dir === 'up') { sel = (sel - 1 + list.length) % list.length; ctx.sfx('tick'); }
        if (inp.hit.a) pick(sel);
        return;
      }
      const p = list[sel];
      const dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
      const dy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
      if (dx || dy) {
        pos.x += dx; pos.y += dy;
        clampPos(p);
        ctx.sfx('tick');
      }
      if (inp.hit.b) { holding = false; ctx.sfx('back'); return; }
      if (inp.hit.a) drop();
    },
    render() {
      g.fillStyle = '#e9dcc2';
      g.fillRect(0, 0, w, h);
      // drafting sheet
      g.fillStyle = '#fbf7ee';
      roundRect(g, 4, 4, 318, 392, 8);
      text(g, ctx.t('Denah {n}/{m} · Lantai {f}', { n: planNo, m: PLANS, f: floor.replace('L', '') }), 16, 22, 17, PAL.ink, 'left');
      const low = left < 10;
      const pulse = low && !ctx.reducedMotion ? 1 + Math.max(0, Math.sin(anim * 8)) * 0.12 : 1;
      text(g, ctx.t('{s} dtk', { s: Math.ceil(left) }), 310, 22, Math.round(17 * pulse), low ? PAL.red : PAL.ink2, 'right');
      g.fillStyle = 'rgba(29,42,35,0.15)';
      g.fillRect(16, 38, 294, 5);
      g.fillStyle = low ? PAL.red : PAL.green;
      g.fillRect(16, 38, 294 * (left / PLAN_TIME), 5);
      text(g, ctx.t('Grid 1,5 m'), 16, 56, 11, PAL.ink2, 'left', 400);

      g.save();
      if (shake > 0 && !ctx.reducedMotion) g.translate(Math.sin(shake * 60) * shake * 10, 0);
      g.fillStyle = '#ffffff';
      g.fillRect(FX, FY, fw * CP, fh * CP);
      g.strokeStyle = 'rgba(60,110,145,0.18)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= fw; i++) { g.moveTo(FX + i * CP + 0.5, FY); g.lineTo(FX + i * CP + 0.5, FY + fh * CP); }
      for (let j = 0; j <= fh; j++) { g.moveTo(FX, FY + j * CP + 0.5); g.lineTo(FX + fw * CP, FY + j * CP + 0.5); }
      g.stroke();
      for (const r of context) {
        g.fillStyle = '#e7e0d1';
        g.fillRect(FX + r.x * CP + 1, FY + r.y * CP + 1, r.w * CP - 2, r.h * CP - 2);
      }
      for (const p of pieces) {
        if (p.placed) continue;
        g.setLineDash([4, 3]);
        g.strokeStyle = PAL.blue;
        g.lineWidth = 1.5;
        g.strokeRect(FX + p.x * CP + 1.5, FY + p.y * CP + 1.5, p.w * CP - 3, p.h * CP - 3);
        g.setLineDash([]);
        if (p.w >= 2 && p.h >= 2) fitLine(p.id.replace(/^L\d-/, ''), FX + (p.x + p.w / 2) * CP, FY + (p.y + p.h / 2) * CP, p.w * CP - 6, 9, PAL.blue);
      }
      pieces.forEach((p, i) => { if (p.placed) drawPiece(p, FX + p.x * CP, FY + p.y * CP, CP, i, false, 1 + p.pop * 0.15); });
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2.5;
      g.strokeRect(FX, FY, fw * CP, fh * CP);
      g.restore();

      // tray
      g.fillStyle = '#d9c7a4';
      roundRect(g, TX, TY - 6, TW, TH, 8);
      text(g, ctx.t('Baki potongan'), TX + 10, TY + 12, 14, PAL.ink, 'left');
      const list = open();
      list.forEach((p, i) => {
        if (holding && i === sel) {
          // empty slot keeps its outline so the tray does not jump
          g.setLineDash([3, 3]); g.strokeStyle = 'rgba(29,42,35,0.35)'; g.lineWidth = 1;
          g.strokeRect(p.tx + 1, p.ty + 1, p.w * CP * tscale - 2, p.h * CP * tscale - 2); g.setLineDash([]);
          return;
        }
        const hi = !holding && i === sel;
        const bob = hi && !ctx.reducedMotion ? Math.sin(anim * 6) * 1.5 : 0;
        drawPiece(p, p.tx, p.ty + bob, CP * tscale, pieces.indexOf(p), hi);
      });
      // name of the selected piece, since small pieces have tiny labels
      const cur = list[sel];
      if (cur) fitLine(holding ? ctx.t('Dipegang: {r}', { r: ctx.t(cur.name) }) : ctx.t('Terpilih: {r}', { r: ctx.t(cur.name) }), TX + TW / 2, TY + TH - 60, TW - 24, 13, PAL.ink);
      if (holding && cur) {
        const free = drag && !overPlan;
        const x = free ? dragAt.x : FX + pos.x * CP, y = free ? dragAt.y : FY + pos.y * CP;
        if (drag && overPlan && !ctx.reducedMotion) {
          // ghost under the finger, snapped piece shows where it lands
          g.globalAlpha = 0.3;
          drawPiece(cur, dragAt.x, dragAt.y, CP, pieces.indexOf(cur), false);
        }
        g.globalAlpha = 0.88;
        const sq = ctx.reducedMotion ? 1 : 1 + Math.sin(squash * Math.PI) * 0.08;
        drawPiece(cur, x, y, CP, pieces.indexOf(cur), true, sq);
        g.globalAlpha = 1;
      }
      for (const f of fx) { g.globalAlpha = Math.max(0, f.life / 0.6); g.fillStyle = f.col; g.fillRect(f.x - 2, f.y - 2, 4, 4); }
      g.globalAlpha = 1;
      for (const f of floats) { g.globalAlpha = Math.min(1, f.t * 2); text(g, f.s, f.x, f.y - (0.9 - f.t) * 30, 16, PAL.green); }
      g.globalAlpha = 1;
      drawChar(g, hugo, 34, 392, 66, 1, pause > 0 ? 'win' : 'idle', anim);
      fitLine(ctx.t('Hugo: cocokkan bentuk dengan garis putus-putus'), 62, 372, 252, 12, PAL.ink2, 'left');
      if (msgT > 0 || pause > 0) {
        g.fillStyle = msgBad ? '#f6d9cf' : '#e6efe0';
        roundRect(g, TX + 8, TY + TH - 42, TW - 16, 28, 6);
        fitLine(msg, TX + TW / 2, TY + TH - 28, TW - 28, 13, msgBad ? PAL.red : PAL.green);
      } else {
        fitLine(holding ? ctx.t('Geser dengan {arah}, {a}: taruh', { arah: ctx.key('arah'), a: ctx.key('a') }) : ctx.t('Pilih potongan, {a}: ambil', { a: ctx.key('a') }), TX + TW / 2, TY + TH - 28, TW - 24, 12, PAL.ink);
      }
    },
    snapshot: () => ({
      plan: planNo, floor, left: Math.round(left * 100) / 100, sel, holding, dragging: !!drag, pos: { ...pos },
      placedTotal, timeBonus, wrong, plansDone, score: score(), ended,
      pieces: pieces.map((p) => ({ id: p.id, name: p.name, floor: p.floor, x: p.x, y: p.y, w: p.w, h: p.h, placed: p.placed, tx: Math.round(p.tx), ty: Math.round(p.ty) })),
      openIds: open().map((p) => p.id),
      tscale: Math.round(tscale * 100) / 100,
    }),
  };

  function drawPiece(p: Piece, x: number, y: number, cp: number, i: number, hi: boolean, scale = 1) {
    const pw = p.w * cp, ph = p.h * cp;
    g.save();
    if (scale !== 1) { g.translate(x + pw / 2, y + ph / 2); g.scale(scale, 2 - scale); g.translate(-(x + pw / 2), -(y + ph / 2)); }
    const hues = ['#f2c48d', '#b9d8c2', '#c9d7ec', '#efc1b4', '#d9cdea', '#f0dd9a', '#c7e1e0'];
    g.fillStyle = hues[i % hues.length];
    g.fillRect(x + 1, y + 1, pw - 2, ph - 2);
    g.strokeStyle = hi ? PAL.accent : PAL.ink2;
    g.lineWidth = hi ? 3 : 1.5;
    g.strokeRect(x + 1, y + 1, pw - 2, ph - 2);
    fitLabel(ctx.t(p.name), x + pw / 2, y + ph / 2, pw - 4, ph - 4);
    g.restore();
  }

  function fitLine(s: string, x: number, y: number, maxW: number, size: number, color: string, align: CanvasTextAlign = 'center') {
    let sz = size;
    for (; sz > 6; sz--) { g.font = `700 ${sz}px 'Alegreya Sans', system-ui, sans-serif`; if (g.measureText(s).width <= maxW) break; }
    text(g, s, x, y, sz, color, align);
  }

  function fitLabel(s: string, cx: number, cy: number, maxW: number, maxH: number) {
    const words = s.split(' ');
    for (let size = 11; size >= 6; size--) {
      g.font = `700 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
      const lines: string[] = [];
      let cur = '';
      for (const wd of words) {
        const t = cur ? `${cur} ${wd}` : wd;
        if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = wd; }
      }
      if (cur) lines.push(cur);
      const lh = size + 1;
      const fits = lines.every((l) => g.measureText(l).width <= maxW) && lines.length * lh <= maxH;
      if (fits || size === 6) {
        const shown = lines.slice(0, Math.max(1, Math.floor(maxH / lh)));
        shown.forEach((l, k) => text(g, l, cx, cy - ((shown.length - 1) * lh) / 2 + k * lh, size, PAL.ink));
        return;
      }
    }
  }
}

export default { meta, create } satisfies GameModule;
