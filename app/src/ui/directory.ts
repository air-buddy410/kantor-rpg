// DOM directory: every room, persona and document is reachable without the
// 3D view (REQ-ACCESS-01). In 3D mode the "Pergi" buttons move the CEO; in
// fallback mode they open the room card instead.
import type { Room, World } from '../world/types';
import { $, el } from './dom';

export interface DirectoryHooks {
  canGo: (room: Room) => { ok: boolean; reason?: string };
  go: (room: Room) => void;
  showRoom: (room: Room) => void;
  showPersona: (actorId: string) => void;
  meet?: (actorId: string) => void;
  mode3d: boolean;
}

export interface DocEntry { href: string; label: string; bytes: number }

/** Document list comes from public/docs/manifest.json written at build time,
 * so the directory never links to a PDF that was not generated. */
export async function loadDocs(): Promise<DocEntry[]> {
  const res = await fetch('docs/manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
  const data = (await res.json()) as { docs: DocEntry[] };
  return data.docs;
}

export function renderDirectory(world: World, hooks: DirectoryHooks): void {
  const body = $('directory-body');
  body.replaceChildren();
  if (!world.rooms.length) {
    body.append(el('p', { class: 'muted' }, 'Dataset tidak memuat ruang.'));
    return;
  }
  for (const floor of world.floors) {
    body.append(el('h3', {}, floor.name));
    const list = el('ul', { class: 'dir-list' });
    for (const room of world.rooms.filter((r) => r.floor === floor.id && r.category !== 'shaft')) {
      const li = el('li', { class: 'dir-item' });
      const name = el('span', {}, room.name);
      const gate = hooks.canGo(room);
      if (!gate.ok) name.append(el('span', { class: 'tag locked' }, 'terkunci'));
      li.append(name, el('span', { class: 'meta' }, `${room.id} · ${room.function}`));
      const btn = el('button', { type: 'button', class: 'btn', 'data-room': room.id }, hooks.mode3d ? 'Pergi' : 'Info');
      if (hooks.mode3d && !gate.ok) {
        btn.setAttribute('aria-disabled', 'true');
        btn.title = gate.reason ?? 'Tidak dapat dicapai';
        btn.addEventListener('click', () => hooks.showRoom(room));
        btn.textContent = 'Info';
      } else {
        btn.addEventListener('click', () => (hooks.mode3d ? hooks.go(room) : hooks.showRoom(room)));
      }
      btn.setAttribute('aria-label', `${btn.textContent} ${room.name}`);
      li.append(btn);
      list.append(li);
    }
    body.append(list);
  }
  body.append(el('h3', {}, 'Persona (simulasi)'));
  const people = el('ul', { class: 'dir-list' });
  for (const a of world.actors) {
    const li = el('li', { class: 'dir-item' });
    li.append(el('span', {}, a.displayName), el('span', { class: 'meta' }, a.kind === 'player' ? `${a.role} · kamu` : `${a.role} · persona simulasi`));
    const btn = el('button', { type: 'button', class: 'btn', 'aria-label': `Profil ${a.displayName}` }, 'Profil');
    btn.addEventListener('click', () => hooks.showPersona(a.id));
    const actions = el('span', { class: 'dir-actions' });
    actions.append(btn);
    if (hooks.mode3d && hooks.meet && a.kind === 'npc') {
      const meet = el('button', { type: 'button', class: 'btn', 'aria-label': `Temui ${a.displayName}` }, 'Temui');
      meet.addEventListener('click', () => hooks.meet!(a.id));
      actions.append(meet);
    }
    li.append(actions);
    people.append(li);
  }
  body.append(people);
  body.append(el('h3', {}, 'Dokumen'));
  const docs = el('ul', { class: 'dir-list doc-list', 'aria-busy': 'true' });
  const state = el('p', { class: 'muted', role: 'status' }, 'Memuat daftar dokumen...');
  body.append(state, docs);
  loadDocs()
    .then((list) => {
      docs.removeAttribute('aria-busy');
      if (!list.length) { state.textContent = 'Belum ada dokumen yang dihasilkan pada build ini.'; return; }
      state.remove();
      for (const d of list) {
        const li = el('li', {});
        li.append(el('a', { href: d.href, target: '_blank', rel: 'noopener' }, `${d.label} (${Math.round(d.bytes / 1024)} KB)`));
        docs.append(li);
      }
    })
    .catch((err: Error) => {
      docs.removeAttribute('aria-busy');
      state.textContent = `Daftar dokumen gagal dimuat: ${err.message}.`;
    });
}
