// "Main pakai HP" panel on the PC (REQ-HP-01/02/07): guest WiFi QR, join QR,
// connected phones with path and latency. Lazy chunk; opening it starts the
// room, closing it leaves the phones connected.
import './phone.css';
import { t } from '../i18n';
import { el, openDialog } from '../ui/dom';
import { PLAYER_COLORS } from '../minigames/local-players';
import { qrSvg, wifiQrText } from './qr';
import { startPhoneLink, type PhoneLink } from './virtual-pads';
import type { PadProfileId } from '../ui/settings';

export const WIFI_KEY = 'kantor-rpg.guest-wifi.v1';
export interface GuestWifi { ssid: string; password: string }
export interface PhonePanelOpts {
  opener?: HTMLElement | null;
  /** Test or staging relay, e.g. ws://127.0.0.1:8791/pad-relay?role=screen. */
  relayUrl?: string;
  onClose?: () => void;
  /** Accepted for the callers' convenience; phones always report the standard mapping, the profile applies in host.ts. */
  padProfile?: () => PadProfileId;
}
export interface PhonePanel { root: HTMLElement; link: PhoneLink; close(): void }

/** Saved guest WiFi of this PC, or null. Never leaves the browser (REQ-HP-02). */
export function loadGuestWifi(): GuestWifi | null {
  try {
    const w = JSON.parse(localStorage.getItem(WIFI_KEY) ?? 'null') as Partial<GuestWifi> | null;
    return w && typeof w.ssid === 'string' && typeof w.password === 'string' && w.ssid && w.password ? { ssid: w.ssid, password: w.password } : null;
  } catch { return null; }
}

export function saveGuestWifi(w: GuestWifi | null): void {
  try { if (w) localStorage.setItem(WIFI_KEY, JSON.stringify(w)); else localStorage.removeItem(WIFI_KEY); } catch { /* storage blocked: QR WiFi just stays hidden */ }
}

const colour = (seat: number) => PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, seat - 1))];
let uid = 0;

export function openPhonePanel(host: HTMLElement | null, opts: PhonePanelOpts = {}): PhonePanel {
  const id = `pp-title-${++uid}`;
  const link = startPhoneLink({ relayUrl: opts.relayUrl });
  const root = host ? el('section', { class: 'pp', 'aria-labelledby': id }) : el('dialog', { class: 'dialog wide pp', 'aria-labelledby': id });

  const head = el('div', { class: 'pp-head' });
  head.append(el('h2', { id }, t('Main pakai HP')));
  const intro = el('p', { class: 'muted small' }, t('HP jadi stik untuk Pemain 2 sampai 5. Maksimal 4 HP.'));
  const qrs = el('ol', { class: 'pp-qrs' });
  const status = el('div', { class: 'pp-status', role: 'status' });
  const list = el('ul', { class: 'pp-phones', 'aria-label': t('HP tersambung') });

  // Guest WiFi form. The password is shown only on request and stays in localStorage.
  const wifi = el('details', { class: 'pp-wifi' });
  wifi.append(el('summary', {}, t('Atur WiFi tamu')));
  const form = el('form', { class: 'pp-form', novalidate: '' });
  const ssid = el('input', { type: 'text', name: 'ssid', autocomplete: 'off', spellcheck: 'false', maxlength: '32', placeholder: 'PerumNet Gaming' });
  const pass = el('input', { type: 'password', name: 'password', autocomplete: 'off', spellcheck: 'false', maxlength: '63' });
  const show = el('button', { type: 'button', class: 'btn', 'aria-pressed': 'false' }, t('Tampilkan'));
  const err = el('p', { class: 'pp-err small', role: 'alert' });
  const ssidLbl = el('label', { class: 'pp-field' }); ssidLbl.append(el('span', {}, t('Nama WiFi (SSID)')), ssid);
  const passRow = el('span', { class: 'pp-pass' }); passRow.append(pass, show);
  const passLbl = el('label', { class: 'pp-field' }); passLbl.append(el('span', {}, t('Sandi')), passRow);
  const row = el('div', { class: 'row' });
  const del = el('button', { type: 'button', class: 'btn' }, t('Hapus'));
  row.append(del, el('button', { type: 'submit', class: 'btn primary' }, t('Simpan')));
  form.append(ssidLbl, passLbl, err, row, el('p', { class: 'muted small' }, t('Sandi hanya disimpan di browser PC ini, tidak dikirim ke server.')));
  wifi.append(form);
  const fill = () => { const w = loadGuestWifi(); ssid.value = w?.ssid ?? 'PerumNet Gaming'; pass.value = w?.password ?? ''; };
  fill();
  show.addEventListener('click', () => {
    const on = pass.type === 'password';
    pass.type = on ? 'text' : 'password';
    show.setAttribute('aria-pressed', String(on));
    show.textContent = on ? t('Sembunyikan') : t('Tampilkan');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = ssid.value.trim();
    // WPA2/3 personal: 8..63 characters; SSID at most 32 bytes.
    if (!s || new TextEncoder().encode(s).length > 32) { err.textContent = t('Isi nama WiFi, maksimal 32 huruf.'); ssid.focus(); return; }
    if (pass.value.length < 8 || pass.value.length > 63) { err.textContent = t('Sandi WiFi 8 sampai 63 karakter.'); pass.focus(); return; }
    err.textContent = '';
    saveGuestWifi({ ssid: s, password: pass.value });
    lastWifi = '';
    render();
  });
  del.addEventListener('click', () => { saveGuestWifi(null); fill(); err.textContent = ''; lastWifi = ''; render(); });

  const body: HTMLElement[] = [head, intro, qrs, status, list, wifi];
  if (!host) {
    const foot = el('form', { method: 'dialog', class: 'row' });
    foot.append(el('button', { class: 'btn primary', value: 'close' }, t('Tutup')));
    body.push(foot);
  }
  root.append(...body);

  let lastWifi = '-';
  let lastCode = '-';
  const wifiItem = el('li');
  const joinItem = el('li');
  const stepItem = el('li', { class: 'pp-step3' });

  function render() {
    const w = loadGuestWifi();
    const wKey = w ? `${w.ssid}\n${w.password}` : '';
    if (wKey !== lastWifi || link.code !== lastCode) {
      lastWifi = wKey; lastCode = link.code;
      let n = 0;
      qrs.replaceChildren();
      if (w) {
        wifiItem.replaceChildren(el('b', {}, `${++n}. ${t('Sambung WiFi')}`), qrBox(wifiQrText(w.ssid, w.password), t('QR WiFi tamu {ssid}', { ssid: w.ssid })), el('span', { class: 'small' }, w.ssid));
        qrs.append(wifiItem);
      }
      joinItem.replaceChildren(el('b', {}, `${++n}. ${t('Buka kontroler')}`));
      if (link.code) {
        joinItem.append(qrBox(link.joinUrl, t('QR kontroler HP, kode {kode}', { kode: link.code })),
          el('p', { class: 'pp-code', 'aria-label': t('Kode {kode}', { kode: link.code.split('').join(' ') }) }, link.code),
          el('a', { class: 'pp-url muted small', href: link.joinUrl, target: '_blank', rel: 'noopener' }, link.joinUrl.replace(/^https?:\/\//, '')));
      } else joinItem.append(el('div', { class: 'pp-qr pp-wait' }, t('Menunggu kode...')));
      stepItem.replaceChildren(el('b', {}, `${++n}. ${t('Ikut main')}`), el('span', { class: 'small' }, t('Tekan ✕ di HP saat kartu game terbuka.')));
      qrs.append(joinItem, stepItem);
    }

    status.replaceChildren();
    if (link.status === 'connecting') status.append(el('span', { class: 'muted small' }, t('Menyambung ke server kontroler...')));
    else if (link.status === 'down') {
      const retry = el('button', { type: 'button', class: 'btn' }, t('Coba lagi'));
      retry.addEventListener('click', () => link.retry());
      status.append(el('span', { class: 'pp-err small' }, t('Server kontroler tidak terjangkau. Coba lagi.')), retry);
    } else if (!link.phones.length) status.append(el('span', { class: 'muted small' }, t('Belum ada HP tersambung.')));

    list.replaceChildren(...link.phones.map((p) => {
      const li = el('li');
      const dot = el('span', { class: 'pp-dot', 'aria-hidden': 'true' });
      dot.style.background = p.seat ? colour(p.seat) : '#66716b';
      const path = p.transport === 'langsung' ? t('langsung') : t('relay');
      const hp = t('HP {n}', { n: p.index - 3 });
      const assignment = p.seat ? t('Pemain {n}', { n: p.seat }) : t('Belum ikut main');
      const txt = `${hp} · ${assignment} · ${!p.connected ? t('Terputus') : path}${p.connected && p.latency !== null ? ` · ${p.latency} ms` : ''}`;
      li.append(dot, el('span', {}, txt));
      return li;
    }));
  }

  const off = link.onChange(render);
  render();

  const close = () => {
    off();
    root.remove();
    opts.onClose?.();
  };
  if (root instanceof HTMLDialogElement) {
    document.body.append(root);
    root.addEventListener('close', close, { once: true });
    openDialog(root, opts.opener);
    return { root, link, close: () => root.close() };
  }
  host!.append(root);
  return { root, link, close };
}

function qrBox(text: string, label: string): HTMLElement {
  const box = el('div', { class: 'pp-qr' });
  // qrSvg output is built from numbers plus an XML-escaped label, so innerHTML is safe here.
  box.innerHTML = qrSvg(text, { label });
  return box;
}
