// Device validation hooks (R2). Physical tests stay BLOCKED until someone runs
// them on the real device; these hooks make that run reproducible without
// Playwright: ?perf=route&seconds=60&report=1 shows the benchmark result with
// the device description and lets the tester copy or download the JSON, and
// ?a11ylog=1 shows every live-region announcement so a screen-reader tester
// can compare what the reader said with what the app announced.
import { el } from '../ui/dom';

export function deviceInfo(canvas: HTMLCanvasElement | null): Record<string, unknown> {
  let gpu: string | null = null;
  try {
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  } catch { gpu = null; }
  return {
    userAgent: navigator.userAgent, platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? null,
    screen: [screen.width, screen.height], viewport: [innerWidth, innerHeight], devicePixelRatio: devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null, deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    gpuRenderer: gpu,
  };
}

export function showPerfReport(result: Record<string, unknown>): HTMLElement {
  const json = JSON.stringify(result, null, 1);
  const panel = el('section', { class: 'perf-report', id: 'perf-report', role: 'region', 'aria-label': 'Hasil benchmark perangkat' });
  const pre = el('pre', { id: 'perf-report-json', tabindex: '0' }, json);
  const copy = el('button', { type: 'button', class: 'btn primary', id: 'perf-report-copy' }, 'Salin hasil');
  const status = el('p', { class: 'small', role: 'status', 'aria-live': 'polite' }, '');
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(json).then(() => { status.textContent = 'Disalin ke clipboard.'; }, () => { status.textContent = 'Clipboard tidak tersedia; pakai Unduh JSON.'; });
  });
  const blob = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const dl = el('a', { class: 'btn', id: 'perf-report-download', href: blob, download: 'kantor-rpg-perf.json' }, 'Unduh JSON');
  const close = el('button', { type: 'button', class: 'btn', id: 'perf-report-close' }, 'Tutup');
  close.addEventListener('click', () => panel.remove());
  panel.append(el('h2', {}, 'Hasil benchmark rute tetap'),
    el('p', { class: 'small' }, 'Angka ini hanya untuk perangkat dan browser ini. Kirim JSON ke Max untuk dicatat di docs/DEVICE-VALIDATION.md.'),
    pre, (() => { const g = el('div', { class: 'tool-grid' }); g.append(copy, dl, close); return g; })(), status);
  document.body.append(panel);
  copy.focus();
  return panel;
}

/** Mirror every polite/assertive live-region change into a visible, ordered log. */
export function startA11yLog(): HTMLElement {
  const log = el('ol', { class: 'a11y-log', id: 'a11y-log', 'aria-label': 'Log pengumuman live region' });
  const wrap = el('section', { class: 'perf-report a11y-log-panel', id: 'a11y-log-panel', role: 'region', 'aria-label': 'Log pengumuman untuk uji screen reader' });
  wrap.append(el('h2', {}, 'Log pengumuman (uji screen reader)'), log);
  document.body.append(wrap);
  const seen = new WeakMap<Element, string>();
  const record = (node: Element) => {
    const text = (node.textContent ?? '').trim();
    if (!text || seen.get(node) === text || (node as HTMLElement).hidden) return;
    seen.set(node, text);
    log.append(el('li', {}, `${new Date().toLocaleTimeString()} ${node.id || node.getAttribute('role') || node.tagName}: ${text}`));
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      const t = (m.target.nodeType === 1 ? m.target : m.target.parentElement) as Element | null;
      const live = t?.closest('[aria-live], [role="status"], [role="alert"]');
      if (live && !wrap.contains(live)) record(live);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  return wrap;
}
