// Game Station launcher (L2-GAME arcade cabinets and TV): ten cabinets,
// multiplayer first, each showing its player count and best local score.
// Picking one hands over to the mini game host; closing the game returns here.
import { t } from '../i18n';
import { sound } from '../audio';
import { ARCADE_SLOTS, catalogGame } from './catalog';
import { loadScores, openMiniGame, type HostOpts } from './host';
import { PAD_PROFILES, faceButtons } from '../input/pad-profiles';
import { PressEdges, isFreshKey, padButtons } from '../input/press-edges';
import { PadActivity, currentDevice, currentPadKind, setDevice, trackDevices } from '../input/mode';
import { richLine } from '../input/legend';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

export function openArcade(opts: HostOpts): HTMLElement {
  document.getElementById('arcade')?.remove();
  sound.music('arcade');
  const root = el('section', { class: 'mg-host', id: 'arcade', 'aria-labelledby': 'arcade-title' });
  document.documentElement.setAttribute('data-minigame', 'arcade');
  const bar = el('div', { class: 'mg-bar' });
  const title = el('h2', { class: 'mg-title', id: 'arcade-title' }, t('Game Station'));
  const close = el('button', { type: 'button', class: 'btn mg-close' }, t('Keluar'));
  const phone = el('button', { type: 'button', class: 'btn', id: 'arcade-phone' }, t('Main pakai HP'));
  // ?relay= points the panel at a test relay (E2E), like pad.html does
  const relayUrl = new URLSearchParams(location.search).get('relay') ?? undefined;
  phone.addEventListener('click', () => { void import('../pad/panel').then((m) => m.openPhonePanel(null, { padProfile: opts.padProfile, relayUrl: relayUrl ? `${relayUrl}?role=screen` : undefined, opener: phone })); });
  bar.append(title, el('span', { class: 'mg-hud' }, t('{n} mesin', { n: ARCADE_SLOTS.length })), phone, close);
  const body = el('div', { class: 'mg-stage arcade-body' });
  const wrap = el('div', { class: 'mg-card arcade-card' });
  wrap.style.position = 'static';
  wrap.style.transform = 'none';
  wrap.style.width = 'min(860px, calc(100vw - 24px))';
  const scores = loadScores();
  const groups = el('div', { class: 'arcade-groups' });
  const grid = groups;
  let n = 0;
  for (const [label, multi] of [['Multiplayer', true], ['Single player', false]] as const) {
    const ids = ARCADE_SLOTS.filter((id) => ((catalogGame(id)?.players ?? 1) > 1) === multi);
    if (!ids.length) continue;
    const head = el('h3', { class: 'arcade-group' }, t(label));
    const list = el('div', { class: 'arcade-grid', role: 'list', 'aria-label': t(label) });
    for (const id of ids) {
      const info = catalogGame(id)!;
      const item = el('div', { role: 'listitem' });
      const b = el('button', { type: 'button', class: 'arcade-slot', 'data-game': id });
      b.append(el('span', { class: 'num' }, String(++n).padStart(2, '0')));
      b.append(el('strong', {}, t(info.title)), el('small', {}, t(info.blurb)));
      b.append(el('span', { class: 'chip' }, info.players > 1 ? t('1 sampai {n} pemain', { n: info.players }) : t('1 pemain')));
      const best = scores[id]?.[0];
      b.append(el('small', {}, best ? t('Rekor: {name}', { name: best.name }) : t('Belum ada rekor')));
      b.addEventListener('click', () => {
        sound.sfx('confirm');
        teardown(false);
        openMiniGame(id, { ...opts, onClose: () => openArcade(opts) });
      });
      item.append(b);
      list.append(item);
    }
    groups.append(head, list);
  }
  const help = el('p', { class: 'arcade-help' });
  const helpLine = () => {
    const d = currentDevice();
    const prof = PAD_PROFILES[opts.padProfile()] ?? PAD_PROFILES.standar;
    help.replaceChildren(...richLine(d === 'pad' ? t('Pilih mesin dengan {arah}, tekan {a} untuk main, {b} untuk keluar.') : d === 'touch' ? t('Ketuk mesin untuk main.') : t('Pilih mesin dengan panah, Enter untuk main, Esc untuk keluar.'), d, prof, currentPadKind()));
  };
  helpLine();
  window.addEventListener('kantor:device', helpLine);
  wrap.append(help, groups);
  body.append(wrap);
  root.append(bar, body);
  document.body.append(root);

  const buttons = () => [...grid.querySelectorAll<HTMLButtonElement>('button.arcade-slot')];
  // Up/down go to the cabinet straight above or below (the two groups have
  // different row lengths, so a fixed column count jumped sideways).
  const vertical = (d: 1 | -1) => {
    const bs = buttons();
    const cur = document.activeElement as HTMLButtonElement;
    const i = bs.indexOf(cur);
    if (i < 0) { bs[0]?.focus(); return; }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    let best: HTMLButtonElement | null = null;
    let bd = Infinity;
    for (const b of bs) {
      const q = b.getBoundingClientRect();
      const dy = (q.top - r.top) * d;
      if (dy < 4) continue;
      const score = dy * 4 + Math.abs(q.left + q.width / 2 - cx);
      if (score < bd) { bd = score; best = b; }
    }
    best?.focus();
    best?.scrollIntoView({ block: 'nearest' });
    sound.sfx('ui');
  };
  const move = (d: number) => {
    const bs = buttons();
    const i = Math.max(0, bs.indexOf(document.activeElement as HTMLButtonElement));
    bs[Math.min(bs.length - 1, Math.max(0, i + d))]?.focus();
    sound.sfx('ui');
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    e.stopPropagation();
    // Enter still held from the office (E/Enter opened the station) auto-repeats
    // and would click the focused slot: one press fell through into game 01.
    // A held Esc that just closed a game must not close the station as well.
    if (!isFreshKey(e) && (k === 'Enter' || k === ' ' || k === 'Escape')) { e.preventDefault(); return; }
    if (k === 'Escape') { e.preventDefault(); teardown(true); return; }
    if (k === 'ArrowRight') { e.preventDefault(); move(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(-1); }
    else if (k === 'ArrowDown') { e.preventDefault(); vertical(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); vertical(-1); }
    else if (k.toLowerCase() === 'm') sound.with((en) => en.toggleMute());
  };
  // Gamepad: D-pad moves, A plays, B leaves. Polled here because the office pad
  // layer is muted while data-minigame is set.
  // Buttons already held when the station opens (A that opened it, A on a
  // game's Keluar that returned here) must be released first, otherwise they
  // launch slot 01 at once. A/B follow the chosen profile (Japanese layout).
  const edges = new PressEdges(padButtons(navigator.getGamepads?.()));
  const seen = new PadActivity();
  trackDevices();
  let raf = 0;
  const poll = () => {
    raf = requestAnimationFrame(poll);
    const raw = padButtons(navigator.getGamepads?.());
    if (!raw.length) return;
    const first = [...(navigator.getGamepads?.() ?? [])].find((q) => q && q.connected);
    if (first && seen.seen(first)) setDevice('pad', first);
    const hit = edges.next(raw);
    const face = faceButtons(PAD_PROFILES[opts.padProfile()] ?? PAD_PROFILES.standar);
    if (hit(15)) move(1);
    if (hit(14)) move(-1);
    if (hit(13)) vertical(1);
    if (hit(12)) vertical(-1);
    if (hit(face.A)) (document.activeElement as HTMLElement | null)?.click();
    if (hit(face.B) || hit(8)) teardown(true);
  };
  raf = requestAnimationFrame(poll);
  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', () => teardown(true));
  function teardown(done: boolean) {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('kantor:device', helpLine);
    root.remove();
    if (done) {
      document.documentElement.removeAttribute('data-minigame');
      sound.sfx('back');
      opts.onClose(null);
    }
  }
  buttons()[0]?.focus();
  return root;
}
