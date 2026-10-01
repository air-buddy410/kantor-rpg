export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

let toastTimer = 0;
export function toast(message: string, ms = 2600): void {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.hidden = true; }, ms);
}

/** Open a native modal dialog and give focus back to the opener on close. */
export function openDialog(dlg: HTMLDialogElement, opener?: HTMLElement | null): void {
  const back = opener ?? (document.activeElement as HTMLElement | null);
  dlg.addEventListener('close', () => { if (back && document.contains(back)) back.focus(); }, { once: true });
  if (!dlg.open) dlg.showModal();
}

export function anyDialogOpen(): boolean {
  return !!document.querySelector('dialog[open]');
}
