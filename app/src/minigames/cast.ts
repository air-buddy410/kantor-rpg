// Characters for the 2D games, drawn from the same palette as the Blender
// models (design/characters.json), so Bruno in Tarung Kantor wears the same
// colours and hair as Bruno walking around the office.
import charactersJson from '@design/characters.json';
import worldJson from '@design/world.json';
import type { CastMember } from './types';

type CharSpec = { displayName: string; role: string; actor: string; skin: string; hair: { style: string; color: string }; outfit: { colors: Record<string, string> } };

export function buildCast(): CastMember[] {
  const chars = (charactersJson as unknown as { characters: Record<string, CharSpec> }).characters;
  const actors = (worldJson as unknown as { actors: { id: string; role: string; avatarAsset: string }[] }).actors;
  return Object.entries(chars).map(([id, c]) => {
    const actor = actors.find((a) => a.avatarAsset === id);
    const o = c.outfit.colors;
    return {
      id, name: c.displayName, role: actor?.role ?? c.role, skin: c.skin, hair: c.hair.color, hairStyle: c.hair.style,
      main: o.outfit_main, inner: o.outfit_inner, bottom: o.outfit_bottom, accent: o.outfit_accent, shoes: o.shoes,
    };
  });
}

export type Pose = 'idle' | 'walk' | 'run' | 'jump' | 'punch' | 'kick' | 'special' | 'block' | 'hurt' | 'ko' | 'win' | 'crouch';

/**
 * Side-view chibi character. (x, y) is the point between the feet; h is the
 * full height in canvas units; face is 1 (right) or -1 (left); t is seconds,
 * used for walk cycles.
 */
export function drawChar(g: CanvasRenderingContext2D, c: CastMember, x: number, y: number, h: number, face: 1 | -1, pose: Pose = 'idle', t = 0) {
  const u = h / 100;
  g.save();
  g.translate(x, y);
  if (pose === 'ko') { g.rotate(-face * Math.PI / 2); g.translate(0, -10 * u); }
  g.scale(face, 1);
  const walk = pose === 'walk' || pose === 'run' ? Math.sin(t * (pose === 'run' ? 18 : 11)) : 0;
  const bob = pose === 'walk' || pose === 'run' ? Math.abs(walk) * 2 * u : pose === 'idle' ? Math.sin(t * 3) * u : 0;
  const crouch = pose === 'crouch' || pose === 'block' ? 10 * u : 0;
  // legs
  const leg = (dx: number, swing: number) => {
    g.fillStyle = c.bottom;
    g.save();
    g.translate(dx * u, -34 * u + crouch);
    g.rotate(swing);
    g.fillRect(-5 * u, 0, 10 * u, 28 * u - crouch * 0.6);
    g.fillStyle = c.shoes;
    g.fillRect(-6 * u, 26 * u - crouch * 0.6, 14 * u, 6 * u);
    g.restore();
  };
  let ls = walk * 0.5, rs = -walk * 0.5;
  if (pose === 'kick') { rs = -1.3; ls = 0.15; }
  if (pose === 'jump') { ls = -0.5; rs = 0.4; }
  leg(-5, ls);
  leg(6, rs);
  g.translate(0, -bob + crouch);
  // body
  g.fillStyle = c.main;
  roundRect(g, -14 * u, -64 * u, 28 * u, 32 * u, 6 * u);
  g.fillStyle = c.inner;
  g.fillRect(-4 * u, -62 * u, 8 * u, 16 * u);
  g.fillStyle = c.accent;
  g.fillRect(-14 * u, -36 * u, 28 * u, 4 * u);
  // arms
  const arm = (dx: number, ang: number, ext = 0) => {
    g.save();
    g.translate(dx * u, -60 * u);
    g.rotate(ang);
    g.fillStyle = c.main;
    g.fillRect(-4 * u, 0, 8 * u, (20 + ext) * u);
    g.fillStyle = c.skin;
    g.beginPath();
    g.arc(0, (22 + ext) * u, 4.5 * u, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  let back = -walk * 0.6 + 0.1, front = walk * 0.6 - 0.1;
  let ext = 0;
  if (pose === 'punch') { front = -Math.PI / 2; ext = 10; back = 0.4; }
  if (pose === 'special') { front = -Math.PI / 2 - 0.3; back = -Math.PI / 2 + 0.3; ext = 8; }
  if (pose === 'block') { front = -2.4; back = -2.2; }
  if (pose === 'win') { front = -2.9; back = 2.9; }
  if (pose === 'hurt') { front = -0.8; back = 0.9; }
  if (pose === 'jump') { front = -2.2; back = 1.2; }
  arm(-11, back);
  // head
  const hy = -84 * u;
  g.fillStyle = c.skin;
  g.beginPath();
  g.ellipse(2 * u, hy, 20 * u, 21 * u, 0, 0, Math.PI * 2);
  g.fill();
  drawHair(g, c, u, hy);
  // face
  g.fillStyle = '#2b211c';
  if (pose === 'hurt' || pose === 'ko') {
    g.lineWidth = 2 * u;
    g.strokeStyle = '#2b211c';
    g.beginPath();
    g.moveTo(8 * u, hy - 3 * u); g.lineTo(14 * u, hy + 3 * u);
    g.moveTo(14 * u, hy - 3 * u); g.lineTo(8 * u, hy + 3 * u);
    g.stroke();
  } else {
    g.beginPath();
    g.ellipse(11 * u, hy, 2.6 * u, 4 * u, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#b5523b';
  g.fillRect(9 * u, hy + 9 * u, (pose === 'win' || pose === 'special' ? 8 : 5) * u, 2 * u);
  arm(9, front, ext);
  if (pose === 'special') {
    g.fillStyle = c.accent;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(18 * u, -60 * u, 9 * u, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }
  g.restore();
}

function drawHair(g: CanvasRenderingContext2D, c: CastMember, u: number, hy: number) {
  g.fillStyle = c.hair;
  const s = c.hairStyle;
  g.beginPath();
  g.ellipse(0, hy - 7 * u, 21 * u, 16 * u, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillRect(-21 * u, hy - 8 * u, 10 * u, 12 * u);
  if (/long|bob|ponytail|bun/.test(s)) g.fillRect(-21 * u, hy - 4 * u, 12 * u, (/long/.test(s) ? 30 : 18) * u);
  if (/ponytail/.test(s)) { g.beginPath(); g.ellipse(-24 * u, hy + 4 * u, 6 * u, 14 * u, 0.3, 0, Math.PI * 2); g.fill(); }
  if (/bun/.test(s)) { g.beginPath(); g.arc(-6 * u, hy - 24 * u, 8 * u, 0, Math.PI * 2); g.fill(); }
  if (/tuft|spike|messy/.test(s)) { g.beginPath(); g.moveTo(-2 * u, hy - 20 * u); g.lineTo(6 * u, hy - 32 * u); g.lineTo(10 * u, hy - 18 * u); g.fill(); }
}

/** Top-down head-and-shoulders token (race driver, bomb arena). */
export function drawToken(g: CanvasRenderingContext2D, c: CastMember, x: number, y: number, r: number, t = 0, moving = false) {
  g.save();
  g.translate(x, y + (moving ? Math.sin(t * 16) * r * 0.06 : 0));
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath(); g.ellipse(0, r * 0.95, r * 0.9, r * 0.3, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = c.main;
  roundRect(g, -r * 0.8, -r * 0.1, r * 1.6, r * 1.0, r * 0.3);
  g.fillStyle = c.accent;
  g.fillRect(-r * 0.8, r * 0.55, r * 1.6, r * 0.14);
  g.fillStyle = c.skin;
  g.beginPath(); g.arc(0, -r * 0.45, r * 0.62, 0, Math.PI * 2); g.fill();
  g.fillStyle = c.hair;
  g.beginPath(); g.arc(0, -r * 0.6, r * 0.62, Math.PI * 1.05, Math.PI * 1.95); g.fill();
  g.fillStyle = '#2b211c';
  g.fillRect(-r * 0.25, -r * 0.45, r * 0.1, r * 0.18);
  g.fillRect(r * 0.15, -r * 0.45, r * 0.1, r * 0.18);
  g.restore();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}

/** Shared palette for game backgrounds; matches the office theme (styles.css). */
export const PAL = {
  bg: '#f4ecdc', surface: '#fffaf0', ink: '#1d2a23', ink2: '#4b5a51', green: '#1f4d3a', accent: '#a34a27',
  sand: '#efe3cc', sky: '#bfe0e6', grass: '#6f9a58', road: '#4d4a46', gold: '#d9a441', red: '#b8452e', blue: '#3c6e91',
};

export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = PAL.ink, align: CanvasTextAlign = 'center', weight = 700) {
  g.font = `${weight} ${size}px 'Alegreya Sans', system-ui, sans-serif`;
  // Alegreya draws old-style figures: a score of 0 read as the letter o
  if ('fontVariantNumeric' in g) (g as unknown as { fontVariantNumeric: string }).fontVariantNumeric = 'lining-nums tabular-nums';
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}
