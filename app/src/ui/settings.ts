// Per-viewer preferences. Storage can throw (private mode, blocked site data),
// so every access is guarded and defaults keep the app usable.
export type Theme = 'system' | 'light' | 'dark';
export type Quality = 'auto' | 'low' | 'high';
export type PadProfileId = 'standar' | 'kidal' | 'santai' | 'terbalik';
export interface Settings {
  theme: Theme; quality: Quality; reducedMotion: boolean; visitor: boolean; padProfile: PadProfileId;
  /** Stick aim speed in mini games, percent (25..200), on top of the profile (Budi 2026-11-19). */
  aimSpeed: number;
}

const KEY = 'kantor-rpg.settings.v1';

export function systemReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function loadSettings(): Settings {
  const base: Settings = { theme: 'system', quality: 'auto', reducedMotion: systemReducedMotion(), visitor: false, padProfile: 'standar', aimSpeed: 100 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : 'system',
      quality: v.quality === 'low' || v.quality === 'high' ? v.quality : 'auto',
      reducedMotion: typeof v.reducedMotion === 'boolean' ? v.reducedMotion : base.reducedMotion,
      visitor: v.visitor === true,
      padProfile: v.padProfile === 'kidal' || v.padProfile === 'santai' || v.padProfile === 'terbalik' ? v.padProfile : 'standar',
      aimSpeed: typeof v.aimSpeed === 'number' && Number.isFinite(v.aimSpeed) ? Math.min(200, Math.max(25, Math.round(v.aimSpeed))) : 100,
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
