// Keys and legends for the device in use: one source for the mini game
// legend bar, the tutorial steps, canvas hints ("✕: ANGKAT!") and the Game
// Station. A pad shows the glyphs printed on it (input/glyphs.ts), a keyboard
// shows key caps, a touch screen the labels of the on-screen buttons.
import { t } from '../i18n';
import { el } from '../ui/dom';
import type { LegendEntry, LegendKey } from '../minigames/types';
import { facePart, glyph, partSymbol, type PadKind, type PadPart } from './glyphs';
import type { Device } from './mode';
import type { PadProfile } from './pad-profiles';

/** Controls that exist only on a gamepad: left out of keyboard and touch legends. */
export const PAD_ONLY: ReadonlySet<LegendKey> = new Set<LegendKey>(['ls', 'rs', 'l1', 'r1', 'l2', 'r2', 'options', 'create', 'dpad']);

// Short key caps; they mirror KEYMAP in minigames/host.ts (Space/Enter/J = A,
// Shift/K = B, X/L = X, C/I = Y). Only the words go through t().
const KEYS: Partial<Record<LegendKey, string>> = { arah: 'Panah', lr: '← →', ud: '↑ ↓', left: '←', right: '→', up: '↑', down: '↓', a: 'Spasi', b: 'Shift', x: 'X', y: 'C' };
const TOUCH: Partial<Record<LegendKey, string>> = { arah: '◀ ▶ ▲ ▼', lr: '◀ ▶', ud: '▲ ▼', left: '◀', right: '▶', up: '▲', down: '▼', a: 'A', b: 'B', x: 'X', y: 'Y' };
// Full names for the button list in the tutorial: every key that does the job.
const KEYS_LONG: Partial<Record<LegendKey, string>> = {
  arah: 'Panah / WASD', lr: 'Panah kiri/kanan', ud: 'Panah atas/bawah', left: 'Panah kiri / A', right: 'Panah kanan / D', up: 'Panah atas / W', down: 'Panah bawah / S',
  a: 'Spasi / Enter / J', b: 'Shift / K', x: 'X / L', y: 'C / I',
};
const TOUCH_LONG: Partial<Record<LegendKey, string>> = {
  arah: 'Tombol ◀ ▶ ▲ ▼', lr: 'Tombol ◀ ▶', ud: 'Tombol ▲ ▼', left: 'Tombol ◀', right: 'Tombol ▶', up: 'Tombol ▲', down: 'Tombol ▼',
  a: 'Tombol A', b: 'Tombol B', x: 'Tombol X', y: 'Tombol Y',
};
const WORDS = ['Panah', 'Spasi'];
/** Key names that go through t(), for the i18n test. */
export const KEY_WORDS = [...WORDS, ...Object.values(KEYS_LONG), ...Object.values(TOUCH_LONG)] as string[];

/** Office controls for the on-screen pad strip and the Kontrol dialog (labels in Indonesian). */
export const OFFICE_PAD_LEGEND: LegendEntry[] = [
  ['ls', 'Jalan'], ['rs', 'Kamera'], ['a', 'Interaksi'], ['b', 'Kembali'], ['x', 'Lari'], ['y', 'Luruskan kamera'],
  [['l1', 'r1'], 'Zoom'], ['create', 'Peta'], ['options', 'Pengaturan'],
];

/** Physical pad controls behind a legend key, after the profile's stick and face swaps. */
export function padParts(k: LegendKey, p: PadProfile): PadPart[] {
  const walk: PadPart = p.swapSticks ? 'rs' : 'ls';
  switch (k) {
    case 'a': case 'b': case 'x': case 'y': return [facePart(k, p.swapFace)];
    // The walking stick also counts as a direction in every mini game (host.ts).
    case 'arah': return [walk, 'dpad'];
    case 'lr': return [walk, 'dpad-x'];
    case 'ud': return [walk, 'dpad-y'];
    case 'left': return ['dpad-l'];
    case 'right': return ['dpad-r'];
    case 'up': return ['dpad-u'];
    case 'down': return ['dpad-d'];
    case 'ls': return [walk];
    case 'rs': return [p.swapSticks ? 'ls' : 'rs'];
    default: return [k];
  }
}

/** Plain text for a key, for canvas lines: Spasi, ✕, A. Directions on a pad read as the D-pad. */
export function keyText(k: LegendKey, d: Device, p: PadProfile, kind: PadKind): string {
  if (d === 'pad') return k === 'arah' || k === 'lr' || k === 'ud' ? partSymbol('dpad', kind) : padParts(k, p).map((x) => partSymbol(x, kind)).join('/');
  const s = (d === 'touch' ? TOUCH : KEYS)[k];
  return s === undefined ? '' : WORDS.includes(s) ? t(s) : s;
}

/** Key chips for DOM text: glyphs on a pad, key caps elsewhere. `long` lists every key that works. */
export function keyChips(k: LegendKey, d: Device, p: PadProfile, kind: PadKind, long = false): HTMLElement[] {
  if (d === 'pad') return padParts(k, p).map((x) => glyph(x, kind));
  const full = long ? (d === 'touch' ? TOUCH_LONG : KEYS_LONG)[k] : undefined;
  const s = full ? t(full) : keyText(k, d, p, kind);
  return s ? [el('kbd', d === 'touch' ? { class: 'touch-key' } : {}, s)] : [];
}

/** Legend bar items: key chips and a short label per entry. */
export function renderLegend(box: HTMLElement, entries: LegendEntry[], d: Device, p: PadProfile, kind: PadKind) {
  box.replaceChildren();
  for (const [keys, label] of entries) {
    const shown = (Array.isArray(keys) ? keys : [keys]).filter((k) => d === 'pad' || !PAD_ONLY.has(k));
    if (!shown.length) continue;
    const li = el('li');
    for (const k of shown) li.append(...keyChips(k, d, p, kind));
    li.append(el('span', {}, t(label)));
    box.append(li);
  }
}

/** A translated sentence whose {a}, {arah}, {r2}... placeholders become key chips. */
export function richLine(s: string, d: Device, p: PadProfile, kind: PadKind): (Node | string)[] {
  return s.split(/\{(\w+)\}/).map((part, i) => {
    if (i % 2 === 0) return part;
    const chips = keyChips(part as LegendKey, d, p, kind);
    if (!chips.length) return part;
    const g = el('span', { class: 'key-group' });
    g.append(...chips);
    return g;
  });
}
