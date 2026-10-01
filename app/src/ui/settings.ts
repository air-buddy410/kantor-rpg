// Per-viewer preferences. Storage can throw (private mode, blocked site data),
// so every access is guarded and defaults keep the app usable.
export type Theme = 'system' | 'light' | 'dark';
export type Quality = 'auto' | 'low' | 'high';
export interface Settings { theme: Theme; quality: Quality; reducedMotion: boolean; visitor: boolean }

const KEY = 'kantor-rpg.settings.v1';

export function systemReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function loadSettings(): Settings {
  const base: Settings = { theme: 'system', quality: 'auto', reducedMotion: systemReducedMotion(), visitor: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system',
      quality: v.quality === 'low' || v.quality === 'high' ? v.quality : 'auto',
      reducedMotion: typeof v.reducedMotion === 'boolean' ? v.reducedMotion : base.reducedMotion,
      visitor: v.visitor === true,
    };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: keep in memory */ }
}

export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  if (s.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  root.setAttribute('data-reduced-motion', String(s.reducedMotion));
}
