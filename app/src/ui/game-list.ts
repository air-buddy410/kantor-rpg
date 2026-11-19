// Daftar game (HUD, key G): every mini game in the office, split into
// Multiplayer and Single player, with players and the room it stands in
// (Budi 2026-11-19). Main walks the CEO to that room and opens the game.
import { t } from '../i18n';
import { el, openDialog } from './dom';
import { CATALOG, gameSpots, type CatalogGame, type GameSpot } from '../minigames/catalog';
import type { World } from '../world/types';

export interface GameListHost {
  world: Pick<World, 'fixtures' | 'rooms' | 'floors'>;
  /** Walk to the spot and open the game; false when it could not start (seat taken, unreachable). */
  play(spot: GameSpot): boolean;
  /** Optional: the phone controller panel (v2.6). */
  phones?(): void;
}

type Tab = 'multi' | 'single';

function playersText(g: CatalogGame): string {
  if (g.players <= 1) return t('1 pemain');
  if (g.coop) return t('1 sampai {n} pemain, kerja sama', { n: g.players });
  return t('1 sampai {n} pemain', { n: g.players });
}

export function openGameList(host: GameListHost, opener?: HTMLElement | null, tab: Tab = 'multi'): HTMLDialogElement {
  document.getElementById('dlg-games')?.remove();
  const spots = gameSpots(host.world);
  const floorName = (id: string) => {
    const level = host.world.floors.find((f) => f.id === id)?.level;
    return level ? t('Lantai {n}', { n: level }) : id;
  };
  const dlg = el('dialog', { class: 'dialog wide game-list', id: 'dlg-games', 'aria-labelledby': 'dlg-games-title' });
  const head = el('div', { class: 'game-list-head' });
  head.append(el('h2', { id: 'dlg-games-title' }, t('Daftar game')));
  if (host.phones) {
    const phone = el('button', { type: 'button', class: 'btn', id: 'games-phone' }, t('Main pakai HP'));
    phone.addEventListener('click', () => host.phones?.());
    head.append(phone);
  }
  const tabs = el('div', { class: 'seg', role: 'tablist', 'aria-label': t('Jenis game') });
  const panels: Record<Tab, HTMLElement> = { multi: el('ul', { class: 'game-rows', role: 'tabpanel', id: 'games-multi' }), single: el('ul', { class: 'game-rows', role: 'tabpanel', id: 'games-single' }) };
  const tabBtns: Record<Tab, HTMLButtonElement> = {} as Record<Tab, HTMLButtonElement>;
  const multi = CATALOG.filter((g) => g.players > 1);
  const single = CATALOG.filter((g) => g.players <= 1);
  for (const [k, label, n] of [['multi', 'Multiplayer', multi.length], ['single', 'Single player', single.length]] as const) {
    const b = el('button', { type: 'button', role: 'tab', id: `games-tab-${k}`, 'aria-controls': `games-${k}`, 'data-tab': k }, `${t(label)} (${n})`);
    panels[k].setAttribute('aria-labelledby', b.id);
    b.addEventListener('click', () => select(k, true));
    tabBtns[k] = b;
    tabs.append(b);
  }
  const row = (g: CatalogGame) => {
    const li = el('li', { class: 'game-row', 'data-game': g.id });
    const where = spots.get(g.id) ?? [];
    const main = where[0];
    const text = el('div', { class: 'game-row-text' });
    text.append(el('strong', {}, t(g.title)), el('span', { class: 'muted small' }, t(g.blurb)));
    const meta = el('div', { class: 'game-row-meta' });
    meta.append(el('span', { class: 'chip' }, playersText(g)));
    if (main) {
      const more = where.length > 1 ? ` · ${t('+{n} ruang lain', { n: where.length - 1 })}` : '';
      meta.append(el('span', { class: 'game-room' }, `${main.room.name} · ${floorName(main.room.floor)}${more}`));
    }
    const play = el('button', { type: 'button', class: 'btn primary', 'aria-label': t('Main {game}', { game: t(g.title) }) }, t('Main'));
    if (!main) play.disabled = true;
    play.addEventListener('click', () => { if (main && host.play(main)) dlg.close(); });
    li.append(text, meta, play);
    return li;
  };
  for (const g of multi) panels.multi.append(row(g));
  for (const g of single) panels.single.append(row(g));
  const select = (k: Tab, focus: boolean) => {
    for (const x of ['multi', 'single'] as Tab[]) {
      tabBtns[x].setAttribute('aria-selected', String(x === k));
      tabBtns[x].tabIndex = x === k ? 0 : -1;
      panels[x].hidden = x !== k;
    }
    if (focus) tabBtns[k].focus();
  };
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    select(tabBtns.multi.getAttribute('aria-selected') === 'true' ? 'single' : 'multi', true);
  });
  const note = el('p', { class: 'muted small' }, t('Main membawa avatarmu ke ruang game itu. Game multiplayer: sambungkan stik atau HP lalu tekan tombol aksi di kartu pembuka.'));
  const foot = el('form', { method: 'dialog', class: 'dialog-foot' });
  foot.append(el('button', { class: 'btn', value: 'close' }, t('Tutup')));
  dlg.append(head, tabs, panels.multi, panels.single, note, foot);
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  document.body.append(dlg);
  select(tab, false);
  openDialog(dlg, opener);
  tabBtns[tab].focus();
  return dlg;
}
