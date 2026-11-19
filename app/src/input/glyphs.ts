// Button glyphs for the pad in use. HUD hints, mini game legends and tutorials
// show what is printed on the controller: PlayStation shapes on a DualSense or
// DualShock, letters on anything else (the Xbox layout the standard mapping
// follows). Entry chunk, no three.js.
import { t } from '../i18n';

export type PadKind = 'ps' | 'xbox';
export type Face = 'a' | 'b' | 'x' | 'y';
/** Physical controls by their place on the pad (standard mapping). */
export type PadPart = 'cross' | 'circle' | 'square' | 'triangle' | 'l1' | 'r1' | 'l2' | 'r2' | 'ls' | 'rs' | 'options' | 'create'
  | 'dpad' | 'dpad-x' | 'dpad-y' | 'dpad-u' | 'dpad-d' | 'dpad-l' | 'dpad-r';

/**
 * Sony pads report vendor 054c: Chrome puts "Vendor: 054c" in Gamepad.id,
 * Firefox "054c-0ce6-...", Safari the product name (DualSense Wireless
 * Controller). Plain "Wireless Controller" is not enough: Xbox pads use it too.
 */
export function padKind(id: string): PadKind {
  return /054c|dualsense|dualshock|playstation/i.test(id) ? 'ps' : 'xbox';
}

/** Physical face button behind a logical A/B/X/Y; the reversed profile swaps them. */
export function facePart(b: Face, swap: boolean): PadPart {
  return (swap ? { a: 'circle', b: 'cross', x: 'triangle', y: 'square' } as const : { a: 'cross', b: 'circle', x: 'square', y: 'triangle' } as const)[b];
}

// Indonesian names go through t(); L1, Options and the Xbox letters are what is
// printed on the pad and stay as they are in every language.
const SAY: Partial<Record<PadPart, string>> = {
  ls: 'Stik kiri', rs: 'Stik kanan', dpad: 'D-pad', 'dpad-x': 'D-pad kiri/kanan', 'dpad-y': 'D-pad atas/bawah',
  'dpad-u': 'D-pad atas', 'dpad-d': 'D-pad bawah', 'dpad-l': 'D-pad kiri', 'dpad-r': 'D-pad kanan',
};
const PS_FACE: Partial<Record<PadPart, string>> = { cross: 'Silang', circle: 'Lingkaran', square: 'Kotak', triangle: 'Segitiga' };
const PRINTED: Record<PadKind, Partial<Record<PadPart, string>>> = {
  ps: { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', options: 'Options', create: 'Create' },
  xbox: { cross: 'A', circle: 'B', square: 'X', triangle: 'Y', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', options: 'Menu', create: 'View' },
};
const PS_MARK: Partial<Record<PadPart, string>> = { cross: '✕', circle: '○', square: '□', triangle: '△' };
/** Every translatable glyph name, for the i18n test (names reach t() through a variable). */
export const GLYPH_NAMES: string[] = [...Object.values(SAY), ...Object.values(PS_FACE)] as string[];

export function partName(part: PadPart, kind: PadKind): string {
  const say = SAY[part] ?? (kind === 'ps' ? PS_FACE[part] : undefined);
  return say ? t(say) : PRINTED[kind][part] ?? part;
}

/** Short mark for canvas text, where no SVG can go: ✕ on a DualSense, A on an Xbox pad. */
export function partSymbol(part: PadPart, kind: PadKind): string {
  if (kind === 'ps' && PS_MARK[part]) return PS_MARK[part]!;
  if (part.startsWith('dpad')) return t('D-pad');
  if (SAY[part]) return partName(part, kind);
  return PRINTED[kind][part] ?? part;
}

const SVG = (body: string) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;
const FACE_SVG: Partial<Record<PadPart, string>> = {
  cross: SVG('<path d="M4.6 4.6l6.8 6.8m0-6.8-6.8 6.8"/>'),
  circle: SVG('<circle cx="8" cy="8" r="4.1"/>'),
  square: SVG('<rect x="4.4" y="4.4" width="7.2" height="7.2"/>'),
  triangle: SVG('<path d="M8 3.4l4.7 8H3.3z"/>'),
};
// D-pad: a plus outline with the arms that act filled in.
const ARMS: Record<string, string> = { u: 'M6.3 1.5h3.4v4.8H6.3z', d: 'M6.3 9.7h3.4v4.8H6.3z', l: 'M1.5 6.3h4.8v3.4H1.5z', r: 'M9.7 6.3h4.8v3.4H9.7z' };
function dpadSvg(part: PadPart): string {
  const on = part === 'dpad' ? 'udlr' : part === 'dpad-x' ? 'lr' : part === 'dpad-y' ? 'ud' : part.slice(5);
  return SVG(`<path d="M6.3 1.5h3.4v4.8h4.8v3.4H9.7v4.8H6.3V9.7H1.5V6.3h4.8z"/>${[...on].map((a) => `<path class="arm" d="${ARMS[a]}"/>`).join('')}`);
}

/** One glyph chip, labelled for screen readers; the visible mark is the printed one. */
export function glyph(part: PadPart, kind: PadKind): HTMLElement {
  const e = document.createElement('span');
  const shape = part.startsWith('dpad') ? 'dpad' : part === 'ls' || part === 'rs' ? 'stick' : /^(cross|circle|square|triangle)$/.test(part) ? 'face' : 'pill';
  e.className = `glyph ${shape} g-${part}`;
  e.setAttribute('role', 'img');
  const name = partName(part, kind);
  e.setAttribute('aria-label', name);
  e.title = name;
  if (shape === 'dpad') e.innerHTML = dpadSvg(part);
  else if (shape === 'face' && kind === 'ps') e.innerHTML = FACE_SVG[part]!;
  else e.textContent = shape === 'stick' ? (part === 'ls' ? 'L' : 'R') : PRINTED[kind][part] ?? part;
  return e;
}

/** Fill every `[data-pad-hint]` placeholder (a, b, x, y or a pad part name) with its glyph. */
export function fillPadHints(root: ParentNode, kind: PadKind, swap: boolean) {
  for (const e of root.querySelectorAll<HTMLElement>('[data-pad-hint]')) {
    const h = e.dataset.padHint!;
    e.replaceChildren(glyph(h === 'a' || h === 'b' || h === 'x' || h === 'y' ? facePart(h, swap) : h as PadPart, kind));
  }
}
