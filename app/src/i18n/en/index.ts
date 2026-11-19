// English dictionary: Indonesian source string -> English. One file per area so
// parallel edits do not collide; keys must match the t('...') text exactly.
import type { WorldText } from '..';
import { EN_CONTENT } from './content';
import { EN_HTML } from './html';
import { EN_GAME } from './game';
import { EN_PRIVATE } from './private';
import { EN_STUDIO } from './studio';
import { EN_UI } from './ui';
import { EN_WORLD } from './world';
import { EN_MG } from './mg';
import { EN_PAD } from './pad';

export const EN: Record<string, string> = { ...EN_CONTENT, ...EN_WORLD, ...EN_HTML, ...EN_GAME, ...EN_PRIVATE, ...EN_STUDIO, ...EN_UI, ...EN_MG, ...EN_PAD };

const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];

/** Translate static markup (index.html): text nodes and a few attributes whose whole value is a known string. */
export function translateDom(root: Element | null, dict: Record<string, string>) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const n of nodes) {
    const raw = n.nodeValue ?? '';
    const key = raw.trim();
    if (!key || !(key in dict)) continue;
    n.nodeValue = raw.replace(key, dict[key]);
  }
  for (const a of ATTRS) {
    root.querySelectorAll(`[${a}]`).forEach((e) => {
      const v = e.getAttribute(a)!;
      if (v in dict) e.setAttribute(a, dict[v]);
    });
  }
}

/** Translate the display strings of the world dataset in place (English only). */
export function translateWorld(w: WorldText, t: (s: string) => string) {
  for (const f of w.floors) f.name = t(f.name);
  for (const r of w.rooms) { r.name = t(r.name); if (r.function) r.function = t(r.function); }
  for (const a of w.actors ?? []) if (a.role) a.role = t(a.role);
  for (const v of w.verticalLinks ?? []) if (v.prompt) v.prompt = t(v.prompt);
  for (const c of Object.values(w.catalog ?? {})) if (c.label) c.label = t(c.label);
}

