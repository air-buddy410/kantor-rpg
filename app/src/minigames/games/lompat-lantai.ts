// Lompat Lantai (Game Station slot 3). Side-scrolling platformer through six
// office floors. Levels are tile strings below so they can be read, edited and
// validated by tests without a level editor.
//
// Tiles (20 px): '#' wall/floor, 'B' crate (solid), '-' one-way shelf,
// '^' tangled cable (hurts), 'D' document, 'P' walking printer (patrols),
// 'C' checkpoint, 'S' start, 'E' exit door.
import type { GameCtx, GameInstance, GameModule } from '../types';
import { PAL, drawChar, text, roundRect } from '../cast';

export const TILE = 20;
export interface LevelDef { name: string; theme: Theme; par: number; rows: string[] }
type Theme = 'lobby' | 'work' | 'pantry' | 'server' | 'library' | 'roof';

export const LEVELS: LevelDef[] = [
  { name: 'Lobi', theme: 'lobby', par: 45, rows: [
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#...................................................................................................',
    '#..................................................D.D..............................................',
    '#.......................D.........D...............------......................D.....................',
    '#...............................................................D..^.D....................D.........',
    '#...............D.............................................#########.............................',
    '#.S...D..D....####...............^^.........P............C....#########..............P....B.....E...',
    '#######################...##################################################...#####################',
    '#######################...##################################################...#####################',
  ] },
  { name: 'Ruang Kerja', theme: 'work', par: 50, rows: [
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#......................D.D...........................................................D........................',
    '#.........D...........-----............D..................D.................D.D...............................',
    '#..............................P..............D...........................#######.............................',
    '#.........B.................######..............B.........................#######.............................',
    '#.S..D....B.......P.........######..........B...B...C....^^.....P.....P...#######...........^.....D.D....E....',
    '######################################...##########################################...########################',
    '######################################...##########################################...########################',
  ] },
  { name: 'Pantry', theme: 'pantry', par: 50, rows: [
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#.............................................................................................................',
    '#....................D........................................................................................',
    '#..................................D.D...............................D........................................',
    '#........D..................D.....-----.......D........D.................................D....................',
    '#....................^.......................................P................................................',
    '#.............##########...................................######.............................................',
    '#.S...........##########......P..............^^...C........######...........P.....^^............D.......E.....',
    '########...################...########################...###########...#################...###################',
    '########...################...########################...###########...#################...###################',
  ] },
  { name: 'Ruang Server', theme: 'server', par: 55, rows: [
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..........................D.......................................................................................',
    '#....................................D.D...............D...........................................................',
    '#.........D.....D..^................-----..................................D.......................................',
    '#.............########............................................................D.^^..D..........................',
    '#.............########...........................####....####...................###########........................',
    '#.S......^^...########.........P..........^^..C..####^^^^####.....P.............###########.......^^....D.....E....',
    '##########################...#############################################...######################################',
    '##########################...#############################################...######################################',
  ] },
  { name: 'Perpustakaan', theme: 'library', par: 55, rows: [
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#..................................................................................................................',
    '#.......................................................D..........................................................',
    '#..................................................................................................................',
    '#..........................D....D.D.............D.P................................................................',
    '#.......D......................-----...........######................D.....D............D..........................',
    '#.......##.....................................######.....................###.......................D..............',
    '#.......##...................................########.....................###......................................',
    '#.S.....##.....P.................^^.....C....########..........P....^^^...###....P.............^....B.........E....',
    '#########################...###########################...############################...##########################',
    '#########################...###########################...############################...##########################',
  ] },
  { name: 'Atap', theme: 'roof', par: 60, rows: [
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#.......................................................................................................................',
    '#..........................................D............................................................................',
    '#..........................D.D...............................................D..........................................',
    '#........D...........D....-----................................D....D.^.....................D...........................',
    '#..................................................................######...............................................',
    '#....................................####..........................######.........................##....................',
    '#.S...........P.................^^...####.........P......C.........######.........P...............##..B...P....D...E....',
    '#######...##########...##################...#################...###########...#############...##########################',
    '#######...##########...##################...#################...###########...#############...##########################',
  ] },
];

export const PHYS = {
  accel: 1500, airAccel: 1000, friction: 1700, maxRun: 165,
  gravity: 1500, cutGravity: 3600, fallGravity: 1900, maxFall: 540,
  jumpV: 470, stompV: 330, coyote: 0.1, buffer: 0.15,
  /** Near the top of a held jump gravity eases off for a moment of hang time. */
  apexV: 40, apexGravity: 0.8,
  /** Head bumps that clip a ceiling corner by this much slide around it. */
  cornerNudge: 6,
  pw: 12, ph: 30, ew: 18, eh: 16, enemySpeed: 42,
};
const LIVES = 3;

const meta: GameModule['meta'] = {
  id: 'lompat-lantai', title: 'Lompat Lantai', place: 'arcade', music: 'platform',
  blurb: 'Platformer 2D: kumpulkan dokumen, hindari kabel kusut.',
  view: { w: 640, h: 360 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'right', 'down', 'a'],
  tutorial: [
    'Jalan dengan {lr}, lompat dengan {a}. Tahan {a} untuk lompat lebih tinggi.',
    'Kumpulkan dokumen, hindari kabel kusut. Injak printer dari atas.',
    'Tekan {down} untuk turun dari rak. Pintu keluar ada di ujung kanan.',
  ],
  legend: [['lr', 'Jalan'], ['a', 'Lompat'], ['down', 'Turun rak']],
  actions: {
    left: 'Jalan ke kiri',
    right: 'Jalan ke kanan',
    up: 'Lompat',
    down: 'Turun dari rak',
    a: 'Lompat (tahan untuk lebih tinggi)',
  },
  pointerHint: 'Ketuk layar untuk lompat, tahan jari untuk lompat lebih tinggi',
};

function levelName(ctx: GameCtx, n: string) {
  switch (n) {
    case 'Lobi': return ctx.t('Lobi');
    case 'Ruang Kerja': return ctx.t('Ruang Kerja');
    case 'Pantry': return ctx.t('Pantry');
    case 'Ruang Server': return ctx.t('Ruang Server');
    case 'Perpustakaan': return ctx.t('Perpustakaan');
    case 'Atap': return ctx.t('Atap');
    default: return n;
  }
}

interface Enemy { x: number; y: number; vx: number; alive: boolean; squash: number }
interface Puff { x: number; y: number; vx: number; vy: number; life: number; c: string }

export interface Options { levels?: LevelDef[]; startLevel?: number; lives?: number }

/** Find the start and exit in a level; used by the game and by tests. */
export function findTile(rows: string[], ch: string): { x: number; y: number } | null {
  for (let y = 0; y < rows.length; y++) {
    const x = rows[y].indexOf(ch);
    if (x >= 0) return { x, y };
  }
  return null;
}

export function makeGame(ctx: GameCtx, opts: Options = {}): GameInstance {
  const { g, w, h } = ctx;
  const levels = opts.levels ?? LEVELS;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];

  let li = opts.startLevel ?? 0;
  let lives = opts.lives ?? LIVES;
  let grid: string[][] = [];
  let lw = 0, lh = 0;
  let enemies: Enemy[] = [];
  let px = 0, py = 0, vx = 0, vy = 0, face: 1 | -1 = 1;
  let onGround = false, coyote = 0, buffer = 0, jumpHeld = false;
  let squash = 0, jumps = 0, nudges = 0, ptrWas = false;
  let spawnX = 0, spawnY = 0, checkpointX = -1;
  let docs = 0, stomps = 0, bonus = 0, levelDocs = 0, levelTime = 0;
  let phase: 'play' | 'dead' | 'clear' | 'over' = 'play';
  let timer = 0, banner = 0, time = 0, shake = 0, cam = 0;
  let deaths = 0, finished = false;
  let lastHurt: 'spike' | 'enemy' | 'fall' | '' = '';
  const puffs: Puff[] = [];

  const score = () => docs * 100 + stomps * 200 + bonus;
  const hud = () => ctx.setHud(ctx.t('Lantai {n}/6 · Nyawa {l}', { n: li + 1, l: lives }));

  function load(i: number) {
    const L = levels[i];
    grid = L.rows.map((r) => r.split(''));
    lh = grid.length; lw = grid[0].length;
    enemies = [];
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const c = grid[y][x];
      if (c === 'P') { enemies.push({ x: x * TILE + TILE / 2, y: (y + 1) * TILE, vx: -PHYS.enemySpeed, alive: true, squash: 0 }); grid[y][x] = '.'; }
      if (c === 'S') { spawnX = x * TILE + TILE / 2; spawnY = (y + 1) * TILE; grid[y][x] = '.'; }
    }
    checkpointX = -1;
    levelDocs = 0; levelTime = 0;
    banner = 1.8;
    respawn();
    cam = camTarget();
    hud();
  }

  function respawn() {
    px = spawnX; py = spawnY; vx = 0; vy = 0; face = 1;
    onGround = true; coyote = 0; buffer = 0; jumpHeld = false; squash = 0;
    phase = 'play';
  }

  function camTarget() {
    const worldW = lw * TILE;
    return Math.max(0, Math.min(Math.max(0, worldW - w), px - w * 0.4 + face * 30));
  }

  const tileAt = (tx: number, ty: number) => (tx < 0 || tx >= lw ? '#' : ty < 0 || ty >= lh ? '.' : grid[ty][tx]);
  const solid = (c: string) => c === '#' || c === 'B';

  function hurt(kind: 'spike' | 'enemy' | 'fall') {
    if (phase !== 'play') return;
    lastHurt = kind;
    lives--; deaths++;
    phase = 'dead'; timer = 1.0;
    vy = -320; vx = 0;
    if (!ctx.reducedMotion) shake = 0.3;
    ctx.sfx('hurt');
    hud();
  }

  function finish(won: boolean) {
    if (finished) return;
    finished = true; phase = 'over';
    ctx.sfx(won ? 'win' : 'lose');
    ctx.end({
      score: score(), won,
      summary: ctx.t('Lantai {n}/6 · {d} dokumen · {e} printer · bonus waktu {b}', { n: won ? levels.length : li + 1, d: docs, e: stomps, b: bonus }),
    });
  }

  function burst(x: number, y: number, c: string, n: number) {
    if (ctx.reducedMotion) n = Math.min(n, 3);
    for (let i = 0; i < n; i++) puffs.push({ x, y, vx: (ctx.rand() - 0.5) * 160, vy: -ctx.rand() * 160 - 40, life: 0.5 + ctx.rand() * 0.3, c });
  }

  /** dirX is -1..1; analog sticks give a walk below full run speed. */
  function movePlayer(dt: number, dirX: number, wantDown: boolean) {
    // horizontal: accelerate toward a target speed; turning around brakes hard so it feels instant
    const acc = onGround ? PHYS.accel : PHYS.airAccel;
    const target = dirX * PHYS.maxRun;
    if (dirX !== 0) {
      const turning = vx !== 0 && Math.sign(vx) !== Math.sign(dirX);
      const a = (acc + (turning ? PHYS.friction : 0)) * dt;
      vx = Math.abs(target - vx) <= a ? target : vx + Math.sign(target - vx) * a;
      face = dirX > 0 ? 1 : -1;
    } else if (onGround) {
      const f = PHYS.friction * dt;
      vx = Math.abs(vx) <= f ? 0 : vx - Math.sign(vx) * f;
    } else vx *= 1 - Math.min(1, dt * 1.5);
    vx = Math.max(-PHYS.maxRun, Math.min(PHYS.maxRun, vx));

    // vertical: variable height by cutting the rise when A is released, a little hang at the apex
    let gr = vy < 0 ? (jumpHeld ? PHYS.gravity : PHYS.cutGravity) : PHYS.fallGravity;
    if (jumpHeld && Math.abs(vy) < PHYS.apexV) gr *= PHYS.apexGravity;
    vy = Math.min(PHYS.maxFall, vy + gr * dt);

    const hw = PHYS.pw / 2;
    px += vx * dt;
    if (px - hw < 0) { px = hw; vx = 0; }
    if (px + hw > lw * TILE) { px = lw * TILE - hw; vx = 0; }
    {
      const top = Math.floor((py - PHYS.ph + 0.01) / TILE), bot = Math.floor((py - 0.01) / TILE);
      if (vx > 0) {
        const tx = Math.floor((px + hw) / TILE);
        for (let ty = top; ty <= bot; ty++) if (solid(tileAt(tx, ty))) { px = tx * TILE - hw - 0.001; vx = 0; break; }
      } else if (vx < 0) {
        const tx = Math.floor((px - hw) / TILE);
        for (let ty = top; ty <= bot; ty++) if (solid(tileAt(tx, ty))) { px = (tx + 1) * TILE + hw + 0.001; vx = 0; break; }
      }
    }
    const prevFeet = py;
    const prevVy = vy;
    py += vy * dt;
    const l = Math.floor((px - hw + 0.01) / TILE), r = Math.floor((px + hw - 0.01) / TILE);
    const wasGround = onGround;
    onGround = false;
    if (vy >= 0) {
      const ty = Math.floor(py / TILE);
      for (let tx = l; tx <= r; tx++) {
        const c = tileAt(tx, ty);
        const oneWay = c === '-' && !wantDown && prevFeet <= ty * TILE + 0.5;
        if (solid(c) || oneWay) { py = ty * TILE; vy = 0; onGround = true; break; }
      }
    } else {
      const ty = Math.floor((py - PHYS.ph) / TILE);
      const hitL = solid(tileAt(l, ty)), hitR = solid(tileAt(r, ty));
      if (hitL || hitR) {
        // clipped only a corner: slide around it instead of killing the jump
        const nudgeR = (l + 1) * TILE - (px - hw);
        const nudgeL = (px + hw) - r * TILE;
        if (hitL && !hitR && l !== r && nudgeR <= PHYS.cornerNudge && !solidCol(px + nudgeR + 0.01, py)) { px += nudgeR + 0.01; nudges++; }
        else if (hitR && !hitL && l !== r && nudgeL <= PHYS.cornerNudge && !solidCol(px - nudgeL - 0.01, py)) { px -= nudgeL + 0.01; nudges++; }
        else { py = (ty + 1) * TILE + PHYS.ph; vy = 0; ctx.sfx('thud', { gain: 0.4, rate: 1.4 }); }
      }
    }
    if (onGround && !wasGround) {
      squash = Math.min(1, 0.4 + prevVy / PHYS.maxFall);
      if (!ctx.reducedMotion) burst(px, py, 'rgba(120,110,95,0.6)', 3);
      if (prevVy > 300) ctx.sfx('step', { gain: 0.6 });
    }
  }

  /** True when the player's body column at x overlaps a solid tile. */
  function solidCol(x: number, feet: number) {
    const hw = PHYS.pw / 2;
    const l = Math.floor((x - hw) / TILE), r = Math.floor((x + hw - 0.01) / TILE);
    const t = Math.floor((feet - PHYS.ph) / TILE), b = Math.floor((feet - 0.01) / TILE);
    for (let ty = t; ty <= b; ty++) for (let tx = l; tx <= r; tx++) if (solid(tileAt(tx, ty))) return true;
    return false;
  }

  function overlapTiles(fn: (c: string, tx: number, ty: number) => void) {
    const hw = PHYS.pw / 2;
    const l = Math.floor((px - hw) / TILE), r = Math.floor((px + hw) / TILE);
    const t = Math.floor((py - PHYS.ph) / TILE), b = Math.floor((py - 0.5) / TILE);
    for (let ty = t; ty <= b; ty++) for (let tx = l; tx <= r; tx++) fn(tileAt(tx, ty), tx, ty);
  }

  load(li);

  return {
    update(dt, inp) {
      time += dt;
      banner = Math.max(0, banner - dt);
      shake = Math.max(0, shake - dt);
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt;
        if (p.life <= 0) puffs.splice(i, 1);
      }
      for (const e of enemies) if (!e.alive) e.squash = Math.max(0, e.squash - dt);
      cam += (camTarget() - cam) * (1 - Math.exp(-9 * dt));
      if (phase === 'over') return;
      if (phase === 'dead') {
        timer -= dt;
        vy += PHYS.fallGravity * dt; py += vy * dt;
        if (timer <= 0) { if (lives <= 0) finish(false); else respawn(); }
        return;
      }
      if (phase === 'clear') {
        timer -= dt;
        if (timer <= 0) {
          if (li + 1 >= levels.length) finish(true);
          else { li++; load(li); }
        }
        return;
      }
      levelTime += dt;
      squash += (0 - squash) * Math.min(1, dt * 12);

      // enemies patrol: turn at walls and ledges
      for (const e of enemies) {
        if (!e.alive) continue;
        const nx = e.x + e.vx * dt;
        const front = nx + Math.sign(e.vx) * PHYS.ew / 2;
        const tx = Math.floor(front / TILE), ty = Math.floor((e.y - 1) / TILE);
        if (solid(tileAt(tx, ty)) || !solid(tileAt(tx, ty + 1)) || tileAt(tx, ty) === '^') e.vx = -e.vx;
        else e.x = nx;
      }

      const dirX = inp.down.left !== inp.down.right ? (inp.down.right ? 1 : -1)
        : Math.abs(inp.ax) < 0.2 ? 0 : Math.sign(inp.ax) * Math.min(1, 0.45 + (Math.abs(inp.ax) - 0.2) * 1.1);
      // tap on the play area = A, holding the finger = holding A
      const ptrDown = !!inp.ptr?.down;
      const ptrPress = (ptrDown && !ptrWas) || !!inp.tap;
      ptrWas = ptrDown;
      if (inp.hit.a || inp.hit.up || ptrPress) buffer = PHYS.buffer; else buffer = Math.max(0, buffer - dt);
      jumpHeld = inp.down.a || inp.down.up || ptrDown;
      coyote = onGround ? PHYS.coyote : Math.max(0, coyote - dt);
      if (buffer > 0 && coyote > 0) {
        vy = -PHYS.jumpV; onGround = false; coyote = 0; buffer = 0; jumps++;
        squash = -0.8;
        ctx.sfx('jump');
        if (!ctx.reducedMotion) burst(px, py, 'rgba(120,110,95,0.5)', 2);
      }
      const prevFeet = py;
      movePlayer(dt, dirX, inp.down.down);
      if (onGround) coyote = PHYS.coyote;

      if (py > lh * TILE + 40) { hurt('fall'); return; }

      overlapTiles((c, tx, ty) => {
        if (phase !== 'play') return;
        if (c === 'D') {
          grid[ty][tx] = '.'; docs++; levelDocs++;
          ctx.sfx('coin', { rate: 1 + (levelDocs % 5) * 0.05 });
          burst(tx * TILE + 10, ty * TILE + 10, PAL.gold, 5);
          hud();
        } else if (c === '^') {
          // cables only fill the lower half of the tile
          if (py > ty * TILE + 9) hurt('spike');
        } else if (c === 'C' && checkpointX !== tx) {
          checkpointX = tx; spawnX = tx * TILE + TILE / 2; spawnY = (ty + 1) * TILE;
          ctx.sfx('confirm');
        } else if (c === 'E') {
          phase = 'clear'; timer = 1.4;
          const b = Math.max(0, Math.round((levels[li].par - levelTime) * 10));
          bonus += b;
          ctx.sfx('right');
          hud();
        }
      });
      if (phase !== 'play') return;

      for (const e of enemies) {
        if (!e.alive) continue;
        const ex0 = e.x - PHYS.ew / 2, ex1 = e.x + PHYS.ew / 2, ey0 = e.y - PHYS.eh;
        if (px + PHYS.pw / 2 <= ex0 || px - PHYS.pw / 2 >= ex1 || py <= ey0 || py - PHYS.ph >= e.y) continue;
        if (vy > 0 && prevFeet <= ey0 + 6) {
          e.alive = false; e.squash = 0.6; stomps++;
          vy = -(jumpHeld ? PHYS.jumpV * 0.85 : PHYS.stompV);
          ctx.sfx('stamp');
          burst(e.x, ey0, '#ffffff', 6);
          hud();
        } else { hurt('enemy'); return; }
      }
    },

    render() {
      const L = levels[li];
      const worldW = lw * TILE;
      cam = Math.max(0, Math.min(Math.max(0, worldW - w), cam));
      drawBackdrop(g, L.theme, cam, w, h, time);
      g.save();
      const sx = shake > 0 ? (Math.sin(time * 90) * 4 * shake) / 0.3 : 0;
      g.translate(-Math.round(cam) + sx, 0);
      const x0 = Math.max(0, Math.floor(cam / TILE) - 1), x1 = Math.min(lw - 1, Math.ceil((cam + w) / TILE) + 1);
      for (let ty = 0; ty < lh; ty++) for (let tx = x0; tx <= x1; tx++) {
        const c = grid[ty][tx];
        if (c !== '.') drawTile(g, c, tx, ty, L.theme, time, solid(tileAt(tx, ty - 1)), checkpointX === tx);
      }
      for (const e of enemies) drawPrinter(g, e, time);
      const pose = phase === 'dead' ? 'hurt' : !onGround ? 'jump' : Math.abs(vx) > 20 ? 'run' : 'idle';
      // squash on landing, stretch on take-off, anchored at the feet
      const k = ctx.reducedMotion ? 0 : squash;
      const air = !onGround && phase === 'play' ? Math.max(-0.12, Math.min(0.12, -vy / 3000)) : 0;
      const scY = 1 - k * 0.22 + air, scX = 1 + k * 0.18 - air * 0.8;
      g.save();
      g.translate(px, py + 1);
      g.scale(scX, scY);
      drawChar(g, me, 0, 0, 36, face, pose, time);
      g.restore();
      for (const p of puffs) { g.globalAlpha = Math.min(1, p.life * 2); g.fillStyle = p.c; g.fillRect(p.x - 2, p.y - 2, 4, 4); }
      g.globalAlpha = 1;
      g.restore();

      if (banner > 0 && phase !== 'over') {
        g.globalAlpha = Math.min(1, banner * 2);
        g.fillStyle = 'rgba(29,42,35,0.82)';
        roundRect(g, w / 2 - 170, 40, 340, 64, 14);
        text(g, ctx.t('Lantai {n}: {name}', { n: li + 1, name: levelName(ctx, L.name) }), w / 2, 62, 24, PAL.surface);
        text(g, ctx.t('Cari pintu keluar di ujung kanan'), w / 2, 88, 15, '#e9dcc0', 'center', 500);
        g.globalAlpha = 1;
      }
      // compact status line on the canvas too, readable on small phones
      g.fillStyle = 'rgba(255,250,240,0.88)';
      roundRect(g, 8, 8, 208, 26, 8);
      for (let i = 0; i < Math.max(0, lives); i++) drawHeart(g, 22 + i * 18, 21);
      text(g, ctx.t('{d} dok · {s} poin', { d: docs, s: score() }), 84, 21, 14, PAL.ink, 'left');
      if (phase === 'clear') {
        g.fillStyle = 'rgba(31,77,58,0.88)';
        roundRect(g, w / 2 - 150, h / 2 - 34, 300, 68, 14);
        text(g, ctx.t('Lantai selesai!'), w / 2, h / 2 - 12, 24, PAL.surface);
        text(g, ctx.t('Bonus waktu +{b}', { b: Math.max(0, Math.round((L.par - levelTime) * 10)) }), w / 2, h / 2 + 16, 16, '#f3d79b');
      }
      if (phase === 'dead' && lives > 0) text(g, ctx.t('Aduh! Sisa nyawa {l}', { l: lives }), w / 2, h / 2, 22, PAL.red);
    },

    snapshot: () => ({
      level: li, lives, px: Math.round(px * 100) / 100, py: Math.round(py * 100) / 100, vx: Math.round(vx), vy: Math.round(vy), onGround, phase,
      docs, stomps, bonus, score: score(), deaths, lastHurt, checkpointX, levelW: lw, buffer: Math.round(buffer * 1000) / 1000, coyote: Math.round(coyote * 1000) / 1000, jumps, nudges, cam: Math.round(cam),
      enemies: enemies.map((e) => ({ x: Math.round(e.x), y: e.y, alive: e.alive })),
    }),
  };
}

function drawHeart(g: CanvasRenderingContext2D, x: number, y: number) {
  g.fillStyle = PAL.red;
  g.beginPath();
  g.moveTo(x, y + 6);
  g.bezierCurveTo(x - 9, y, x - 6, y - 7, x, y - 3);
  g.bezierCurveTo(x + 6, y - 7, x + 9, y, x, y + 6);
  g.fill();
}

const THEME: Record<Theme, { wall: string; far: string; floor: string; floorTop: string; deco: string }> = {
  lobby: { wall: '#efe3cc', far: '#e2d2b2', floor: '#8a6f55', floorTop: '#c9a97c', deco: '#1f4d3a' },
  work: { wall: '#e8eee6', far: '#d3dfd3', floor: '#5d6b62', floorTop: '#9fb3a1', deco: '#3c6e91' },
  pantry: { wall: '#f6e6d2', far: '#ebcfb0', floor: '#7d5a44', floorTop: '#d7a77b', deco: '#a34a27' },
  server: { wall: '#2f3a40', far: '#25303a', floor: '#3d474d', floorTop: '#6c7c84', deco: '#5fd38b' },
  library: { wall: '#efe6d4', far: '#dcc9a6', floor: '#6b4d36', floorTop: '#a77d55', deco: '#7a3b2a' },
  roof: { wall: '#bfe0e6', far: '#a9d2da', floor: '#6d6a64', floorTop: '#a8a49b', deco: '#6f9a58' },
};

function drawBackdrop(g: CanvasRenderingContext2D, th: Theme, cam: number, w: number, h: number, t: number) {
  const T = THEME[th];
  g.fillStyle = T.wall;
  g.fillRect(0, 0, w, h);
  const off = -(cam * 0.3) % 160;
  for (let i = -1; i < w / 160 + 2; i++) {
    const x = off + i * 160;
    g.fillStyle = T.far;
    if (th === 'roof') {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.beginPath(); g.ellipse(x + 60, 70 + (i % 2) * 30, 40, 13, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9fb6bd';
      g.fillRect(x + 10, 180 - (i % 3) * 30, 50, 140 + (i % 3) * 30);
      g.fillStyle = '#b6cbd0';
      for (let k = 0; k < 4; k++) g.fillRect(x + 18, 192 - (i % 3) * 30 + k * 24, 34, 10);
    } else if (th === 'server') {
      g.fillRect(x + 20, 120, 60, 200);
      for (let k = 0; k < 8; k++) {
        g.fillStyle = (k + i + Math.floor(t * 2)) % 3 === 0 ? '#5fd38b' : '#3a6a8a';
        g.fillRect(x + 28, 132 + k * 22, 6, 4);
        g.fillStyle = '#3a454c';
        g.fillRect(x + 40, 130 + k * 22, 34, 8);
      }
      g.fillStyle = T.far;
    } else if (th === 'library') {
      g.fillRect(x + 10, 110, 120, 210);
      const cols = ['#7a3b2a', '#1f4d3a', '#3c6e91', '#d9a441', '#a34a27'];
      for (let k = 0; k < 4; k++) for (let b = 0; b < 9; b++) {
        g.fillStyle = cols[(b * 3 + k + i) % 5];
        g.fillRect(x + 16 + b * 12, 122 + k * 48, 9, 34 - ((b + k) % 3) * 4);
      }
    } else {
      // windows with sky
      g.fillRect(x + 20, 60, 90, 110);
      g.fillStyle = '#cfe7ec';
      g.fillRect(x + 26, 66, 78, 98);
      g.fillStyle = T.far;
      g.fillRect(x + 63, 66, 4, 98);
      if (th === 'work') { g.fillStyle = '#b7c7b9'; g.fillRect(x + 10, 240, 120, 10); g.fillRect(x + 20, 250, 6, 70); g.fillRect(x + 114, 250, 6, 70); }
      if (th === 'pantry') { g.fillStyle = '#e0bc93'; g.fillRect(x + 0, 220, 150, 100); g.fillStyle = '#c99e72'; g.fillRect(x + 0, 220, 150, 8); }
      if (th === 'lobby') { g.fillStyle = '#6f9a58'; g.beginPath(); g.ellipse(x + 140, 270, 14, 30, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#a34a27'; g.fillRect(x + 132, 290, 16, 30); }
    }
  }
}

function drawTile(g: CanvasRenderingContext2D, c: string, tx: number, ty: number, th: Theme, t: number, covered: boolean, activeCp: boolean) {
  const x = tx * TILE, y = ty * TILE;
  const T = THEME[th];
  if (c === '#') {
    g.fillStyle = T.floor;
    g.fillRect(x, y, TILE, TILE);
    if (!covered) { g.fillStyle = T.floorTop; g.fillRect(x, y, TILE, 5); }
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(x + TILE - 1, y, 1, TILE);
  } else if (c === 'B') {
    g.fillStyle = '#c89a5e'; g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    g.strokeStyle = '#8a6236'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
    g.beginPath(); g.moveTo(x + 3, y + 3); g.lineTo(x + TILE - 3, y + TILE - 3); g.stroke();
  } else if (c === '-') {
    g.fillStyle = T.deco; g.fillRect(x, y, TILE, 5);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 2, y + 5, 2, 5); g.fillRect(x + TILE - 4, y + 5, 2, 5);
  } else if (c === '^') {
    // tangled cable pile
    const cols = ['#1d2a23', '#3c6e91', '#b8452e', '#d9a441'];
    g.lineWidth = 2.2;
    for (let k = 0; k < 4; k++) {
      g.strokeStyle = cols[k];
      g.beginPath();
      for (let s = 0; s <= 8; s++) {
        const sx = x + s * 2.5, sy = y + 14 + Math.sin(s * 1.7 + k * 1.3 + tx) * 5 - (k % 2) * 2;
        if (s === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
      }
      g.stroke();
    }
    g.fillStyle = '#d9a441'; g.fillRect(x + 8, y + 8, 4, 3);
  } else if (c === 'D') {
    const bob = Math.sin(t * 4 + tx) * 2;
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 5, y + 5 + bob, 12, 15);
    g.fillStyle = '#fffaf0'; g.fillRect(x + 4, y + 3 + bob, 12, 15);
    g.strokeStyle = PAL.gold; g.lineWidth = 1.5; g.strokeRect(x + 4, y + 3 + bob, 12, 15);
    g.fillStyle = PAL.ink2;
    for (let k = 0; k < 3; k++) g.fillRect(x + 6, y + 7 + k * 4 + bob, 8, 1.5);
  } else if (c === 'C') {
    g.fillStyle = '#5b5148'; g.fillRect(x + 9, y - 14, 2, 34);
    g.fillStyle = activeCp ? PAL.green : '#b8ac98';
    g.beginPath(); g.moveTo(x + 11, y - 14); g.lineTo(x + 24, y - 9); g.lineTo(x + 11, y - 4); g.fill();
  } else if (c === 'E') {
    g.fillStyle = '#5b3a24'; g.fillRect(x - 4, y - 24, 28, 44);
    g.fillStyle = PAL.green; g.fillRect(x - 1, y - 21, 22, 41);
    g.fillStyle = PAL.gold; g.beginPath(); g.arc(x + 16, y, 2.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f7d4f'; roundRect(g, x - 8, y - 40, 36, 13, 3);
    g.font = "700 9px 'Alegreya Sans', system-ui, sans-serif"; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('EXIT', x + 10, y - 33);
  }
}

function drawPrinter(g: CanvasRenderingContext2D, e: Enemy, t: number) {
  if (!e.alive && e.squash <= 0) return;
  const x = e.x, y = e.y;
  if (!e.alive) {
    g.fillStyle = '#9b9b95'; g.fillRect(x - 11, y - 5, 22, 5);
    return;
  }
  const step = Math.sin(t * 14 + x) * 2;
  g.fillStyle = '#3b3b38';
  g.fillRect(x - 7, y - 3 + Math.max(0, step), 4, 3);
  g.fillRect(x + 3, y - 3 + Math.max(0, -step), 4, 3);
  g.fillStyle = '#d4d3cc'; roundRect(g, x - 10, y - 16, 20, 13, 3);
  g.fillStyle = '#8e8d86'; g.fillRect(x - 8, y - 12, 16, 3);
  g.fillStyle = '#ffffff'; g.fillRect(x - 5, y - 21 + Math.sin(t * 6) * 1.5, 10, 6);
  const dir = Math.sign(e.vx) || 1;
  g.fillStyle = '#b8452e'; g.fillRect(x + dir * 5 - 1.5, y - 8, 3, 3);
}

export default { meta, create: (ctx: GameCtx) => makeGame(ctx) } satisfies GameModule;
