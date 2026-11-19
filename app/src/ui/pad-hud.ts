// Office HUD while a gamepad is the active device (Budi 2026-11-19): a legend
// strip with the DualSense (or Xbox) buttons, glyphs on the HUD buttons that
// have a pad shortcut, the button list in the Kontrol dialog, and no touch
// overlay. Everything here is tiny DOM work; the pad loop itself stays lazy.
import { t } from '../i18n';
import { $, el } from './dom';
import { currentDevice, currentPadKind, trackDevices } from '../input/mode';
import { fillPadHints, partName } from '../input/glyphs';
import { OFFICE_PAD_LEGEND, keyChips, renderLegend } from '../input/legend';
import { PAD_PROFILES } from '../input/pad-profiles';
import type { LegendEntry } from '../minigames/types';
import type { Settings } from './settings';

// Menu rows on top of the walking controls, for the Kontrol dialog.
const MENU_ROWS: LegendEntry[] = [['dpad', 'Pindah tombol di menu dan HUD'], ['a', 'Pilih di menu'], ['b', 'Tutup dialog']];

export function initPadHud(settings: Settings): () => void {
  trackDevices();
  const strip = el('ul', { class: 'pad-legend', id: 'pad-legend', 'aria-label': t('Tombol stik') });
  strip.hidden = true;
  $('app').append(strip);
  const help = document.getElementById('help-pad');
  const render = () => {
    const pad = currentDevice() === 'pad';
    const prof = PAD_PROFILES[settings.padProfile] ?? PAD_PROFILES.standar;
    const kind = currentPadKind();
    strip.hidden = !pad;
    if (pad) renderLegend(strip, OFFICE_PAD_LEGEND, 'pad', prof, kind);
    fillPadHints(document, kind, prof.swapFace);
    if (help) {
      help.replaceChildren();
      for (const [keys, label] of [...OFFICE_PAD_LEGEND, ...MENU_ROWS]) {
        const dt = el('dt');
        for (const k of Array.isArray(keys) ? keys : [keys]) dt.append(...keyChips(k, 'pad', prof, kind));
        help.append(dt, el('dd', {}, t(label)));
      }
      const title = document.getElementById('help-pad-title');
      if (title) title.textContent = kind === 'ps' ? t('Stik PlayStation (DualSense)') : t('Stik Xbox atau Bluetooth');
    }
  };
  window.addEventListener('kantor:device', render);
  render();
  return render;
}

/** "Stik terhubung" toast text with the real name of the Options button. */
export function connectedText(): string {
  return t('Stik terhubung. Petunjuk tombol di layar kini memakai tombol stik. {o}: Pengaturan.', { o: partName('options', currentPadKind()) });
}
