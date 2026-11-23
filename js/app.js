import { parseDeck, normalizeAnswer } from './parser.js';
import * as scores from './scores.js';
import * as library from './library.js';
import { makeZip, readZip, saveFile, readClipboard } from './files.js';
import { IN_APP, onlineEnabled, setOnlineEnabled, getRemoteText, advanced, setAdvanced, hiddenList, hide, unhideAll } from './env.js';
import { hasNative, nativeRequest } from './bridge.js';

const $app = document.getElementById('app');
let manifest = null;
let session = null; // sessione di gioco in corso

// ---------- utilità ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<span class="icon ${cls}" aria-hidden="true">${name}</span>`;

// Mini-markdown inline: **grassetto**, *corsivo*, `codice`, ![alt](immagine), a capo.
function md(text, deckPath = '') {
  const base = new URL(deckPath || '.', document.baseURI);
  return esc(text)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
      const u = new URL(src.replace(/&amp;/g, '&'), base);
      if (!/^https?:$/.test(u.protocol)) return '';
      return `<img src="${esc(u.href)}" alt="${alt}">`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
}

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------- statistiche per domanda e ripasso mirato ----------
// Sistema a scatole (Leitner): risposta giusta -> scatola +1, sbagliata -> scatola 1.
// Più la scatola è alta, più a lungo la domanda può aspettare prima del prossimo ripasso.
const BOX_DAYS = [0, 1, 2, 4, 8, 16];

function itemStats(results) {
  const stats = new Map();
  for (const r of results.slice().sort((a, b) => a.data.localeCompare(b.data))) {
    for (const a of r.risposte || []) {
      const s = stats.get(a.d) || { tentativi: 0, errori: 0, box: 0, ultima: null };
      s.tentativi++;
      if (a.ok) s.box = Math.min(5, s.box + 1);
      else { s.errori++; s.box = 1; }
      s.ultima = r.data;
      stats.set(a.d, s);
    }
  }
  return stats;
}

// Priorità di ripasso: quanto la sbagli (con correzione per pochi tentativi)
// + bonus se è "scaduta" secondo la scatola + un po' di casualità per variare.
function priority(s) {
  if (!s) return 0.5 + 0.3 + Math.random() * 0.1; // mai vista: media
  const weakness = (s.errori + 1) / (s.tentativi + 2);
  const days = (Date.now() - new Date(s.ultima)) / 864e5;
  const due = days >= BOX_DAYS[s.box] ? 0.3 : 0;
  return weakness + due + Math.random() * 0.1;
}

function pickWeak(items, stats, n) {
  return shuffle(items
    .map((it) => ({ it, p: priority(stats.get(it.id)) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, n)
    .map((x) => x.it));
}

function fmtDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `oggi, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `ieri, ${time}`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
// La home mostra insieme la radice online ("") e la radice sul dispositivo ("~").
const isHomeId = (f) => f === '' || f === library.ROOT;
const prettySlug = (s) => s.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
const folderName = (f) => (isHomeId(f) ? 'Flash Now' : library.isLocal(f) ? library.folderTitle(f) : prettySlug(f.split('/').pop()));
const folderLabel = (f) => {
  if (isHomeId(f)) return 'Home';
  if (!library.isLocal(f)) return f.split('/').map(prettySlug).join('/');
  const parts = f.split('/');
  return parts.slice(1).map((_, i) => library.folderTitle(parts.slice(0, i + 2).join('/'))).join('/');
};
const folderHref = (f) => (isHomeId(f) ? '#/' : `#/cartella/${encPath(f)}`);
const pctClass = (p) => (p >= 80 ? 'good' : p >= 50 ? 'mid' : 'bad');
const typeIcon = (t) => (t === 'quiz' ? 'quiz' : 'style');
const unit = (t, n) => (t === 'quiz' ? (n === 1 ? 'domanda' : 'domande') : (n === 1 ? 'carta' : 'carte'));
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const go = (hash) => { location.hash = hash; };

function render(html) {
  $app.innerHTML = html;
  window.scrollTo(0, 0);
  onScroll();
}

// top app bar: cambia colore quando il contenuto scorre sotto
function onScroll() {
  document.querySelector('.appbar')?.classList.toggle('scrolled', window.scrollY > 4);
}
window.addEventListener('scroll', onScroll, { passive: true });

function appbar(title, back) {
  return `<header class="appbar">
    ${back
    ? `<a class="icon-btn state" href="${back}" aria-label="Indietro">${icon('arrow_back')}</a><h1 class="title-l">${esc(title)}</h1>`
    : `<div class="brand"><img src="icon.svg" alt="" width="32" height="32"></div><h1 class="title-l brand-name">Flash Now</h1>`}
    <a class="icon-btn state" href="#/guida" aria-label="Guida">${icon('help')}</a>
    <a class="icon-btn state" href="#/impostazioni" aria-label="Impostazioni">${icon('settings')}</a>
  </header>`;
}

let snackTimer;
function snackbar(text) {
  let el = document.querySelector('.snackbar');
  if (!el) {
    el = document.createElement('div');
    el.className = 'snackbar';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = text;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), 4500);
}

// Indice = mazzi online (decks.json del sito, facoltativo) + mazzi sul dispositivo.
// Le cartelle e i mazzi online nascosti dall'utente vengono tolti qui.
let remote = null;
let remoteState = 'off'; // 'ok' | 'error' | 'off'
async function loadManifest(retry = false) {
  if (!onlineEnabled()) {
    remote = { cartelle: [''], mazzi: [] };
    remoteState = 'off';
  } else if (remote === null || remoteState === 'off' || (retry && remoteState === 'error')) {
    try {
      const t = await getRemoteText('decks.json');
      remote = t ? JSON.parse(t) : { cartelle: [''], mazzi: [] };
      remoteState = t ? 'ok' : 'error';
    } catch {
      remote = { cartelle: [''], mazzi: [] };
      remoteState = 'error';
    }
  }
  const hidden = hiddenList();
  const isHidden = (p) => hidden.some((h) => p === h || p.startsWith(h + '/'));
  const local = library.manifest();
  manifest = {
    cartelle: [...remote.cartelle.filter((f) => !f || !isHidden(f)), ...local.cartelle],
    mazzi: [...remote.mazzi.filter((d) => !isHidden(d.path) && !(d.cartella && isHidden(d.cartella))), ...local.mazzi],
  };
  return manifest;
}

async function loadDeck(path) {
  const text = library.isLocal(path) ? library.readDeck(path) : await getRemoteText(path).catch(() => null);
  if (text === null) throw new Error('Mazzo non disponibile. Se è un mazzo online, serve la connessione per scaricarlo la prima volta.');
  return parseDeck(text);
}

// ---------- finestre di dialogo e menu (M3) ----------
function dialog({ title, text = '', input = null, value = '', choices = null, confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'm3-dialog';
    dlg.innerHTML = `<form method="dialog">
      <h2 class="headline-s">${esc(title)}</h2>
      ${text ? `<p class="body-m variant">${esc(text)}</p>` : ''}
      ${input !== null ? `<div class="field"><label for="dlg-in">${esc(input)}</label><input id="dlg-in" autocomplete="off" required value="${esc(value)}"></div>` : ''}
      ${choices ? `<div class="choice-list">${choices.map((c, i) => `<label class="choice-row" style="padding-left:${16 + c.depth * 20}px">
        <input type="radio" name="dlg-choice" value="${esc(c.value)}" ${i === 0 ? 'checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</div>` : ''}
      <div class="dialog-actions">
        <button class="btn text" value="cancel" formnovalidate>Annulla</button>
        <button class="btn ${danger ? 'text danger' : 'text'}" value="ok">${esc(confirm)}</button>
      </div>
    </form>`;
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const val = input !== null ? dlg.querySelector('#dlg-in').value.trim()
        : choices ? dlg.querySelector('[name=dlg-choice]:checked')?.value ?? null : true;
      dlg.remove();
      resolve(ok ? val : null);
    });
    dlg.showModal();
    const $in = dlg.querySelector('#dlg-in');
    if ($in) { $in.focus(); $in.select(); }
  });
}

// Menu dal basso (bottom sheet). actions: [chiave, icona, etichetta, pericolosa?]
function actionSheet(title, subtitle, actions) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.innerHTML = `<div class="sheet-handle"></div>
      <div class="sheet-head"><span class="title-m">${esc(title)}</span>${subtitle ? `<span class="body-m variant">${esc(subtitle)}</span>` : ''}</div>
      <div class="sheet-list">${actions.map(([k, ic, label, danger]) => `<button class="sheet-item state${danger ? ' danger' : ''}" data-k="${k}">${icon(ic)}<span>${esc(label)}</span></button>`).join('')}</div>`;
    let choice = null;
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (b) { choice = b.dataset.k; dlg.close(); } else if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(choice); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// Chiede una cartella di destinazione sul dispositivo. skip(f) esclude le cartelle non valide.
function pickFolder(skip = () => false) {
  const folders = manifest.cartelle.filter((f) => library.isLocal(f) && !skip(f));
  if (!folders.length) {
    snackbar('Non ci sono altre cartelle: creane una con "Nuova cartella".');
    return Promise.resolve(null);
  }
  return dialog({
    title: 'Sposta in',
    choices: folders.map((f) => ({ value: f, label: f === library.ROOT ? 'Home' : folderName(f), depth: f.split('/').length - 1 })),
    confirm: 'Sposta',
  });
}

function moveDecks(paths, folder) {
  for (const p of paths) scores.renameDeck(p, library.moveDeck(p, folder), folder);
}

async function exportFolder(f) {
  const root = f === library.ROOT;
  const name = root ? 'flash-now-mazzi' : library.slug(folderName(f));
  const prefix = root ? '' : `${name}/`;
  const zip = makeZip(library.tree(f).map((e) => ({ name: prefix + e.rel, text: e.text })));
  if (await saveFile(`${name}.zip`, 'application/zip', zip)) snackbar(`Esportato ${name}.zip. Puoi reimportarlo con "Importa file".`);
}

async function deleteFolderFlow(f) {
  const n = manifest.mazzi.filter((d) => d.cartella === f || d.cartella.startsWith(f + '/')).length;
  const yes = await dialog({
    title: `Eliminare “${folderName(f)}”?`,
    text: n ? `Verranno eliminati anche ${n === 1 ? 'il mazzo' : `i ${n} mazzi`} che contiene. I punteggi restano nello storico.` : 'La cartella è vuota.',
    confirm: 'Elimina', danger: true,
  });
  if (!yes) return false;
  library.deleteFolder(f);
  return true;
}

// Copia un mazzo o una cartella online sul dispositivo, dove si può modificare.
async function copyToDevice(kind, id) {
  const decks = kind === 'deck' ? manifest.mazzi.filter((d) => d.path === id)
    : manifest.mazzi.filter((d) => d.cartella === id || d.cartella.startsWith(id + '/'));
  let base = library.ROOT;
  if (kind === 'folder') {
    base = `${library.ROOT}/${library.slug(id.split('/').pop())}`;
    for (let i = 2; manifest.cartelle.includes(base); i++) base = `${library.ROOT}/${library.slug(id.split('/').pop())}-${i}`;
    library.ensureFolder(base);
    library.renameFolder(base, folderName(id));
  }
  let n = 0;
  for (const d of decks) {
    const text = await getRemoteText(d.path).catch(() => null);
    if (text === null) continue;
    const target = kind === 'folder' ? base + d.cartella.slice(id.length) : base;
    library.ensureFolder(target);
    library.saveDeck(text, { folder: target, fileName: d.path.split('/').pop().replace(/\.md$/, '') });
    n++;
  }
  return n;
}

// Pressione prolungata (o tasto destro) su mazzi e cartelle: apre il menu delle azioni.
function enableLongPress() {
  document.querySelectorAll('.item[data-id]').forEach((el) => {
    let timer = null;
    let fired = false;
    let sx = 0;
    let sy = 0;
    const open = () => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      navigator.vibrate?.(12);
      itemMenu(el.dataset.kind, el.dataset.id);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      fired = false;
      sx = e.clientX;
      sy = e.clientY;
      timer = setTimeout(open, 500);
    });
    el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, cancel));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); open(); });
    el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); } });
  });
}

async function itemMenu(kind, id) {
  const local = library.isLocal(id);
  const deck = kind === 'deck' ? manifest.mazzi.find((d) => d.path === id) : null;
  const name = deck ? deck.titolo : folderName(id);
  const where = deck ? folderLabel(deck.cartella) : folderLabel(library.parentOf(id) || '');
  const actions = !local
    ? [['copy', 'content_copy', 'Copia sul dispositivo'], ['hide', 'visibility_off', 'Nascondi']]
    : kind === 'folder'
      ? [['rename', 'edit', 'Rinomina'], ['move', 'drive_file_move', 'Sposta'], ['export', 'download', 'Esporta (.zip)'], ['delete', 'delete', 'Elimina', true]]
      : [['rename', 'edit', 'Rinomina'], ['move', 'drive_file_move', 'Sposta'], ['edit', 'edit_note', 'Modifica il contenuto'], ['export', 'download', 'Esporta (.md)'], ['delete', 'delete', 'Elimina', true]];
  const a = await actionSheet(name, `${local ? '' : 'Online · '}${where}`, actions);
  if (!a) return;
  try {
    if (a === 'rename') {
      const n = await dialog({ title: kind === 'folder' ? 'Rinomina cartella' : 'Rinomina mazzo', input: 'Nuovo nome', value: name, confirm: 'Rinomina' });
      if (!n || n === name) return;
      if (kind === 'folder') library.renameFolder(id, n); else library.renameDeck(id, n);
      await route();
      snackbar(`Rinominato in “${n}”`);
    } else if (a === 'move') {
      const parent = library.parentOf(id);
      const to = await pickFolder((f) => f === parent || (kind === 'folder' && (f === id || f.startsWith(id + '/'))));
      if (!to) return;
      if (kind === 'folder') {
        const r = library.moveFolder(id, to);
        for (const [from, dest] of r.decks) scores.renameDeck(from, dest, library.parentOf(dest));
      } else {
        moveDecks([id], to);
      }
      await route();
      snackbar(`Spostato in ${to === library.ROOT ? 'Home' : folderName(to)}`);
    } else if (a === 'edit') {
      go(`#/modifica/${encPath(id)}`);
    } else if (a === 'export') {
      if (kind === 'folder') await exportFolder(id);
      else if (await saveFile(id.split('/').pop(), 'text/markdown', library.readDeck(id))) snackbar(`Esportato ${id.split('/').pop()}`);
    } else if (a === 'delete') {
      if (kind === 'folder') {
        if (!(await deleteFolderFlow(id))) return;
      } else {
        if (!(await dialog({ title: `Eliminare “${name}”?`, text: 'Il mazzo verrà eliminato da questo dispositivo. I punteggi restano nello storico.', confirm: 'Elimina', danger: true }))) return;
        library.deleteDeck(id);
      }
      if (location.hash.includes(encPath(id))) location.replace(folderHref(library.parentOf(id)));
      else await route();
      snackbar(kind === 'folder' ? 'Cartella eliminata' : 'Mazzo eliminato');
    } else if (a === 'copy') {
      const n = await copyToDevice(kind, id);
      await route();
      snackbar(n ? `Copiato sul dispositivo: ora puoi rinominarlo, spostarlo e modificarlo` : 'Copia non riuscita: serve la connessione');
    } else if (a === 'hide') {
      hide(id);
      await route();
      snackbar('Nascosto. Puoi mostrarlo di nuovo dalle Impostazioni.');
    }
  } catch (e) { snackbar(e.message); }
}

// ---------- router ----------
let selecting = null; // cartella in cui è attiva la selezione multipla dei mazzi

async function route() {
  const h = decodeURIComponent(location.hash.slice(1) || '/');
  selecting = null;
  if (session && !h.startsWith('/gioca/')) stopSession();
  try {
    await loadManifest(h === '/');
    if (h.startsWith('/cartella/')) return viewFolder(h.slice('/cartella/'.length));
    if (h.startsWith('/mazzo/')) return viewDeck(h.slice('/mazzo/'.length));
    if (h.startsWith('/gioca/')) return session ? null : go(`#/mazzo/${encPath(h.slice('/gioca/'.length))}`);
    if (h.startsWith('/nuovo/')) return viewEditor({ folder: h.slice('/nuovo/'.length) });
    if (h.startsWith('/modifica/')) return viewEditor({ path: h.slice('/modifica/'.length) });
    if (h === '/impostazioni') return viewSettings();
    if (h === '/guida') return viewGuide();
    return viewFolder('');
  } catch (e) {
    render(`${appbar('Errore', '#/')}<main><div class="card error">${esc(e.message)}</div></main>`);
  }
}
window.addEventListener('hashchange', route);

// ---------- vista cartella (e home) ----------
async function viewFolder(folder) {
  if (folder === library.ROOT) folder = '';
  const m = manifest;
  if (folder && !m.cartelle.includes(folder)) return go('#/');
  const home = folder === '';
  const local = home || library.isLocal(folder); // qui si possono creare e importare mazzi
  const target = home ? library.ROOT : folder; // dove finiscono i nuovi mazzi e cartelle
  const levels = home ? ['', library.ROOT] : [folder];
  const byName = (a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' });
  const subs = m.cartelle.filter((f) => f && f !== library.ROOT && levels.includes(library.parentOf(f)))
    .sort((a, b) => byName(folderName(a), folderName(b)));
  const decks = m.mazzi.filter((d) => levels.includes(d.cartella)).sort((a, b) => byName(a.titolo, b.titolo));
  const countIn = (f) => m.mazzi.filter((d) => d.cartella === f || d.cartella.startsWith(f + '/')).length;

  const results = (await Promise.all(levels.map((l) => scores.folderResults(l)))).flat()
    .sort((a, b) => b.data.localeCompare(a.data));
  const lastOf = (d) => results.find((r) => r.mazzo === d.path);
  const back = home ? null : folderHref(library.parentOf(folder));
  const pending = scores.canSync() ? scores.unsynced().length : 0;
  const sel = selecting === folder;
  const localDecks = decks.filter((d) => library.isLocal(d.path));

  render(`${appbar(folderName(folder), back)}
  <main>
    ${home ? `<h2 class="home-title">Cosa ripassi oggi?</h2>
    <label class="searchbar">${icon('search')}<input type="search" id="search" placeholder="Cerca un mazzo" autocomplete="off" aria-label="Cerca un mazzo"></label>
    <div id="search-results" class="list"></div>` : ''}
    <div id="browse">
    ${home ? '<div id="update-slot"></div>' : ''}
    ${home && !localStorage.getItem(GUIDE_SEEN) ? `<section class="card hint">
      <button class="icon-btn state hint-close" id="hint-close" aria-label="Chiudi">${icon('close')}</button>
      <h2 class="title-l">${icon('auto_awesome', 'fill')}Prima volta qui?</h2>
      <p class="body-m variant">Trasforma i tuoi appunti in flashcard con l'AI in quattro passaggi.</p>
      <a class="btn filled" href="#/guida">Apri la guida</a>
    </section>` : ''}
    ${home && pending ? `<a class="sync-banner state" href="#/impostazioni">${icon('sync')}<span>${pending} ${pending === 1 ? 'sessione da sincronizzare' : 'sessioni da sincronizzare'} con GitHub</span>${icon('chevron_right')}</a>` : ''}
    ${!home && !local ? `<p class="online-note body-m">${icon('cloud', 'fill')}Cartella online: tieni premuto un mazzo per copiarlo sul dispositivo e modificarlo.</p>` : ''}
    ${local && !sel ? `<div class="local-actions">
      <a class="btn filled" href="#/nuovo/${encPath(target)}">${icon('add')}Nuovo mazzo</a>
      <button class="btn tonal" id="import">${icon('upload_file')}Importa</button>
      <button class="btn tonal" id="new-folder">${icon('create_new_folder')}Nuova cartella</button>
      <button class="btn tonal" id="export-folder" ${countIn(target) ? '' : 'disabled'}>${icon('download')}${home ? 'Esporta tutto' : 'Esporta'}</button>
      <input type="file" id="file" accept=".md,.txt,.zip,text/markdown,text/plain,application/zip" multiple hidden>
    </div>` : ''}
    ${subs.length && !sel ? `<div class="subhead title-s">Cartelle</div><div class="list">${subs.map((f) => folderItem(f, countIn(f))).join('')}</div>` : ''}
    ${home && remoteState === 'error' ? `<p class="offline-note body-m">${icon('cloud_off')}Mazzi online non disponibili senza connessione. Quelli sul dispositivo funzionano lo stesso.</p>` : ''}
    ${decks.length ? `<div class="subhead-row"><span class="subhead title-s">Mazzi</span>
      ${localDecks.length && !sel ? `<button class="btn text" id="sel-start">${icon('check_box_outline_blank')}Seleziona</button>` : ''}</div>
      <div class="list">${sel ? localDecks.map(selectItem).join('') : decks.map((d) => deckItem(d, lastOf(d))).join('')}</div>` : ''}
    ${!subs.length && !decks.length ? `<div class="empty">${icon(local ? 'style' : 'folder')}<p>${local
    ? 'Ancora nessun mazzo. Creane uno, incolla quello generato da un\'AI oppure importa un file .md.'
    : 'Questa cartella online è vuota.'}</p></div>` : ''}
    ${(subs.length || decks.length) && !sel && home ? `<p class="tip body-m">${icon('touch_app')}Tieni premuto un mazzo o una cartella per rinominarlo, spostarlo o eliminarlo.</p>` : ''}
    ${results.length && !sel ? `<div class="subhead title-s">Attività recente</div>${resultList(results.slice(0, 6), true)}` : ''}
    </div>
    ${sel ? `<div class="select-bar">
      <button class="icon-btn state" id="sel-cancel" aria-label="Annulla selezione">${icon('close')}</button>
      <span id="sel-count" class="label-l">Scegli i mazzi</span>
      <button class="btn tonal" id="sel-move" disabled>Sposta</button>
      <button class="btn negative" id="sel-del" disabled>Elimina</button>
    </div>` : ''}
  </main>`);

  enableLongPress();
  if (home) showUpdateBanner();

  document.getElementById('hint-close')?.addEventListener('click', (e) => {
    localStorage.setItem(GUIDE_SEEN, '1');
    e.currentTarget.closest('.hint').remove();
  });

  const $s = document.getElementById('search');
  if ($s) {
    $s.addEventListener('input', () => {
      const q = normalizeAnswer($s.value);
      const $r = document.getElementById('search-results');
      document.getElementById('browse').hidden = !!q;
      $r.innerHTML = q
        ? m.mazzi.filter((d) => normalizeAnswer(`${d.titolo} ${d.descrizione} ${folderLabel(d.cartella)}`).includes(q)).map((d) => deckItem(d, null, true)).join('')
          || `<div class="empty">${icon('search')}<p>Nessun mazzo contiene “${esc($s.value)}”.</p></div>`
        : '';
      enableLongPress();
    });
  }
  if (!local) return;

  document.getElementById('sel-start')?.addEventListener('click', () => { selecting = folder; viewFolder(folder); });
  if (sel) {
    const chosen = () => [...document.querySelectorAll('.sel:checked')].map((c) => c.value);
    const update = () => {
      const n = chosen().length;
      document.getElementById('sel-count').textContent = n ? `${n} ${n === 1 ? 'scelto' : 'scelti'}` : 'Scegli i mazzi';
      document.getElementById('sel-move').disabled = !n;
      document.getElementById('sel-del').disabled = !n;
    };
    document.querySelectorAll('.sel').forEach((c) => c.addEventListener('change', update));
    document.getElementById('sel-cancel').addEventListener('click', () => { selecting = null; viewFolder(folder); });
    document.getElementById('sel-move').addEventListener('click', async () => {
      const paths = chosen();
      const to = await pickFolder((f) => f === target);
      if (!to) return;
      moveDecks(paths, to);
      selecting = null;
      await route();
      snackbar(`${paths.length === 1 ? 'Mazzo spostato' : `${paths.length} mazzi spostati`} in ${to === library.ROOT ? 'Home' : folderName(to)}`);
    });
    document.getElementById('sel-del').addEventListener('click', async () => {
      const paths = chosen();
      const yes = await dialog({
        title: paths.length === 1 ? 'Eliminare il mazzo?' : `Eliminare ${paths.length} mazzi?`,
        text: 'Verranno eliminati da questo dispositivo. I punteggi restano nello storico.',
        confirm: 'Elimina', danger: true,
      });
      if (!yes) return;
      for (const p of paths) library.deleteDeck(p);
      selecting = null;
      await route();
      snackbar(paths.length === 1 ? 'Mazzo eliminato' : `${paths.length} mazzi eliminati`);
    });
    return;
  }

  document.getElementById('new-folder').addEventListener('click', async () => {
    const name = await dialog({ title: 'Nuova cartella', input: 'Nome della cartella', confirm: 'Crea' });
    if (!name) return;
    try {
      const id = library.addFolder(target, name);
      go(`#/cartella/${encPath(id)}`);
    } catch (e) { snackbar(e.message); }
  });
  const $file = document.getElementById('file');
  document.getElementById('import').addEventListener('click', () => $file.click());
  $file.addEventListener('change', async () => {
    let ok = 0;
    const skipped = [];
    const add = (text, name, dest) => {
      if (!parseDeck(text).items.length) { skipped.push(name.split('/').pop()); return; }
      library.ensureFolder(dest);
      library.saveDeck(text, { folder: dest, fileName: name.split('/').pop().replace(/\.(md|txt|markdown)$/i, '') });
      ok++;
    };
    try {
      for (const f of $file.files) {
        if (/\.zip$/i.test(f.name)) {
          // Archivio (es. un backup esportato): ricrea le sottocartelle.
          for (const e of await readZip(await f.arrayBuffer())) {
            if (!/\.(md|txt|markdown)$/i.test(e.name) || e.name.startsWith('__MACOSX')) continue;
            const dirs = e.name.split('/').slice(0, -1).map(library.slug);
            add(e.text, e.name, [target, ...dirs].join('/'));
          }
        } else {
          add(await f.text(), f.name, target);
        }
      }
    } catch (e) { snackbar(e.message); }
    await route();
    snackbar(`${ok === 1 ? 'Importato 1 mazzo' : `Importati ${ok} mazzi`}${skipped.length ? `. Saltati perché non nel formato dei mazzi: ${skipped.join(', ')}` : ''}`);
  });
  document.getElementById('export-folder').addEventListener('click', () => exportFolder(target));
}

const onlineBadge = () => `<span class="online-badge" title="Online" aria-label="Online">${icon('cloud', 'fill')}</span>`;

function folderItem(f, n) {
  const online = !library.isLocal(f);
  return `<a class="item state" href="${folderHref(f)}" data-kind="folder" data-id="${esc(f)}">
    <span class="avatar folder">${icon('folder', 'fill')}${online ? onlineBadge() : ''}</span>
    <span class="item-main"><span class="headline">${esc(folderName(f))}</span><span class="support">${n} ${n === 1 ? 'mazzo' : 'mazzi'}${online ? ', online' : ''}</span></span>
    ${icon('chevron_right', 'trail')}
  </a>`;
}

function deckItem(d, last, showFolder = false) {
  const online = !library.isLocal(d.path);
  return `<a class="item state" href="#/mazzo/${encPath(d.path)}" data-kind="deck" data-id="${esc(d.path)}">
    <span class="avatar ${d.tipo}">${icon(typeIcon(d.tipo))}${online ? onlineBadge() : ''}</span>
    <span class="item-main"><span class="headline">${esc(d.titolo)}</span>
      <span class="support">${d.n} ${unit(d.tipo, d.n)}${showFolder && !isHomeId(d.cartella) ? ` in ${esc(folderLabel(d.cartella))}` : ''}</span></span>
    ${last ? `<span class="score-chip ${pctClass(last.percentuale)}">${last.percentuale}%</span>` : icon('chevron_right', 'trail')}
  </a>`;
}

function selectItem(d) {
  return `<label class="item state select-item">
    <input type="checkbox" class="sel" value="${esc(d.path)}" aria-label="Seleziona ${esc(d.titolo)}">
    <span class="avatar ${d.tipo}">${icon(typeIcon(d.tipo))}</span>
    <span class="item-main"><span class="headline">${esc(d.titolo)}</span><span class="support">${d.n} ${unit(d.tipo, d.n)}</span></span>
  </label>`;
}

function resultList(list, withDeck) {
  const title = (p) => manifest.mazzi.find((d) => d.path === p)?.titolo || p.split('/').pop();
  return `<div class="list">${list.map((r) => `
    <div class="item">
      <span class="score-chip ${pctClass(r.percentuale)}">${r.percentuale}%</span>
      <span class="item-main">
        <span class="headline">${withDeck ? esc(title(r.mazzo)) : `${r.punti} su ${r.totale}`}</span>
        <span class="support">${withDeck ? `${r.punti} su ${r.totale}, ` : ''}${fmtDur(r.durata || 0)}${r.modo === 'deboli' ? ', punti deboli' : ''}</span>
      </span>
      <span class="trail-text">${fmtDate(r.data)}</span>
    </div>`).join('')}</div>`;
}

// ---------- editor (mazzi sul dispositivo) ----------
const TEMPLATES = {
  flashcard: `---
titolo: Nuovo mazzo
tipo: flashcard
---

D: Domanda (fronte della carta)
R: Risposta (retro della carta)

D: Seconda domanda
R: Seconda risposta
`,
  quiz: `---
titolo: Nuovo quiz
tipo: quiz
---

D: Domanda a scelta singola?
- [ ] Opzione sbagliata
- [x] Opzione corretta
- [ ] Opzione sbagliata
S: Spiegazione facoltativa.

D: Domanda con risposta da scrivere?
R: risposta | variante accettata
`,
};

const AI_PROMPT = `Trasforma gli appunti che ti incollo in un mazzo di studio nel formato seguente. Rispondi solo con il contenuto del file, senza commenti.

Intestazione:
---
titolo: <titolo breve>
tipo: flashcard   (oppure: quiz)
---

Flashcard: ogni carta è
D: <domanda, una sola idea>
R: <risposta breve>

Quiz: ogni domanda è
D: <domanda>
- [ ] <opzione sbagliata ma plausibile>
- [x] <opzione corretta>   (più [x] = scelta multipla)
S: <spiegazione breve>
oppure, per una risposta da scrivere:
D: <domanda>
R: <risposta> | <variante accettata>

Regole: D:, R:, S: e le opzioni stanno a inizio riga; una riga senza marcatore continua quella precedente; usa solo informazioni presenti negli appunti.

Appunti:
`;

function viewEditor({ folder = null, path = null }) {
  const isNew = !path;
  if (isNew && !(library.isLocal(folder) && manifest.cartelle.includes(folder))) return go('#/');
  if (!isNew && (!library.isLocal(path) || library.readDeck(path) === null)) return go('#/');
  const back = isNew ? folderHref(folder) : `#/mazzo/${encPath(path)}`;
  const initial = isNew ? TEMPLATES.flashcard : library.readDeck(path);

  render(`${appbar(isNew ? 'Nuovo mazzo' : 'Modifica mazzo', back)}
  <main class="editor-page">
    ${isNew ? `<div class="segmented" role="radiogroup" aria-label="Tipo di mazzo">
      <label><input type="radio" name="tpl" value="flashcard" checked><span>${icon('check')}Flashcard</span></label>
      <label><input type="radio" name="tpl" value="quiz"><span>${icon('check')}Quiz</span></label>
    </div>` : ''}
    <p class="body-m variant">Scrivi il mazzo qui sotto, oppure: copia le <strong>istruzioni per l'AI</strong>, incollale in una chat con i tuoi appunti, copia la risposta e tocca <strong>Incolla</strong>.</p>
    <div class="btn-row editor-tools">
      <button class="btn outlined" id="copy-prompt">${icon('auto_awesome')}Istruzioni per l'AI</button>
      <button class="btn tonal" id="paste">${icon('content_paste')}Incolla</button>
    </div>
    <textarea id="src" class="editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Testo del mazzo">${esc(initial)}</textarea>
    <p id="check" class="check body-m" role="status"></p>
    <div class="btn-row">
      <a class="btn outlined" href="${back}">Annulla</a>
      <button class="btn filled" id="save">${icon('save')}Salva</button>
    </div>
  </main>`);

  const $src = document.getElementById('src');
  const $check = document.getElementById('check');
  let touched = false;
  const validate = () => {
    const deck = parseDeck($src.value);
    const n = deck.items.length;
    const $tpl = document.querySelector(`[name=tpl][value=${deck.type}]`);
    if ($tpl) $tpl.checked = true; // il selettore segue il tipo scritto nel testo
    $check.className = `check body-m ${deck.errors.length ? 'bad' : 'good'}`;
    $check.innerHTML = deck.errors.length
      ? `${icon('cancel', 'fill')}<span>${deck.errors.map(esc).join('<br>')}</span>`
      : `${icon('check_circle', 'fill')}<span>${n} ${unit(deck.type, n)}, nessun errore</span>`;
    return deck;
  };
  $src.addEventListener('input', () => { touched = true; validate(); });
  validate();

  document.querySelectorAll('[name=tpl]').forEach((r) => r.addEventListener('change', async () => {
    if (touched && !(await dialog({ title: 'Sostituire il testo?', text: 'Il testo scritto finora verrà sostituito dal modello.', confirm: 'Sostituisci' }))) {
      document.querySelector(`[name=tpl][value=${r.value === 'quiz' ? 'flashcard' : 'quiz'}]`).checked = true;
      return;
    }
    $src.value = TEMPLATES[r.value];
    touched = false;
    validate();
  }));

  // Incolla: sostituisce tutto il testo (anche il modello di esempio) con il contenuto degli appunti.
  document.getElementById('paste').addEventListener('click', async () => {
    let text;
    try {
      text = (await readClipboard()).trim();
    } catch {
      return snackbar('Non riesco a leggere gli appunti: tieni premuto nell\'editor e scegli Incolla.');
    }
    if (!text) return snackbar('Gli appunti sono vuoti: copia prima la risposta dell\'AI.');
    if (touched && $src.value.trim() && !(await dialog({ title: 'Sostituire il testo?', text: 'Il testo scritto finora verrà sostituito da quello copiato.', confirm: 'Sostituisci' }))) return;
    $src.value = text.replace(/^```[a-z]*\n([\s\S]*?)\n```$/, '$1') + '\n';
    touched = true;
    const deck = validate();
    snackbar(deck.errors.length ? 'Testo incollato: controlla gli errori segnalati' : `Testo incollato: ${deck.items.length} ${unit(deck.type, deck.items.length)}`);
  });

  document.getElementById('copy-prompt').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      snackbar('Istruzioni copiate: incollale nella chat dell\'AI insieme ai tuoi appunti');
    } catch {
      snackbar('Copia non riuscita su questo dispositivo');
    }
  });

  document.getElementById('save').addEventListener('click', () => {
    const deck = validate();
    if (!deck.items.length) return snackbar('Il mazzo non contiene domande: ogni domanda inizia con "D:"');
    try {
      const saved = library.saveDeck($src.value, isNew ? { folder } : { path });
      location.replace(`#/mazzo/${encPath(saved)}`);
      snackbar(deck.errors.length ? 'Mazzo salvato, ma contiene errori da correggere' : 'Mazzo salvato');
    } catch (e) { snackbar(e.message); }
  });
}

// ---------- vista mazzo ----------
async function viewDeck(path) {
  const d = manifest.mazzi.find((x) => x.path === path);
  if (!d) return go('#/');
  const [deck, results] = await Promise.all([loadDeck(path), scores.deckResults(d)]);
  const best = results.reduce((b, r) => Math.max(b, r.percentuale), -1);
  const isQuiz = deck.type === 'quiz';
  const n = deck.items.length;
  const counts = [5, 10, 20, 30, 50].filter((c) => c < n);
  const chartData = results.slice(0, 20).reverse();
  const stats = itemStats(results);
  const playable = deck.items.filter((it) => (isQuiz ? it.kind : it.q && it.a));
  const hardest = playable
    .map((it) => ({ it, s: stats.get(it.id) }))
    .filter((x) => x.s?.errori)
    .sort((a, b) => b.s.errori / b.s.tentativi - a.s.errori / a.s.tentativi || b.s.errori - a.s.errori)
    .slice(0, 5);
  const weakReady = stats.size > 0;
  const plain = (t) => t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[*`]/g, '').replace(/\n/g, ' ');

  render(`${appbar(folderName(d.cartella), folderHref(d.cartella))}
  <main>
    <section class="card deck-hero">
      <div class="deck-type label-l">${icon(typeIcon(deck.type))}${isQuiz ? 'Quiz' : 'Flashcard'}</div>
      <h2 class="headline-m">${esc(d.titolo)}</h2>
      ${deck.description ? `<p class="body-m">${md(deck.description, path)}</p>` : ''}
      <div class="chips">
        <span class="chip">${icon(isQuiz ? 'help' : 'style')}${n} ${unit(deck.type, n)}</span>
        ${results.length ? `<span class="chip">${icon('history')}${results.length} ${results.length === 1 ? 'tentativo' : 'tentativi'}</span>
        <span class="chip">${icon('check')}migliore ${best}%</span>` : ''}
      </div>
      ${deck.errors.length ? `<div class="warn body-m"><strong>Il file contiene errori:</strong><br>${deck.errors.map(esc).join('<br>')}</div>` : ''}
      <form id="start" class="settings-form">
        <div class="segmented" role="radiogroup" aria-label="Modalità">
          <label><input type="radio" name="mode" value="all" checked><span>${icon('check')}Tutte</span></label>
          <label><input type="radio" name="mode" value="weak" ${weakReady ? '' : 'disabled'}><span>${icon('check')}Punti deboli</span></label>
        </div>
        <p class="mode-help body-m variant" id="mode-help"></p>
        <div class="field">
          <label for="count">${isQuiz ? 'Domande' : 'Carte'} per sessione</label>
          <select id="count" name="count">${counts.map((c) => `<option value="${c}">${c}</option>`).join('')}<option value="${n}" selected>Tutte (${n})</option></select>
          ${icon('arrow_drop_down')}
        </div>
        <label class="setting-row" id="shuffle-row"><span>Ordine casuale</span><input class="switch" type="checkbox" name="shuffle" ${deck.shuffle ? 'checked' : ''}></label>
        ${!isQuiz ? '<label class="setting-row"><span>Mostra prima la risposta</span><input class="switch" type="checkbox" name="reverse"></label>' : ''}
        <button class="btn filled large" type="submit">${icon('play_arrow', 'fill')}Inizia</button>
      </form>
      ${library.isLocal(path) ? `<div class="btn-grid">
        <button class="btn outlined" id="rename-deck">${icon('edit')}Rinomina</button>
        <a class="btn outlined" href="#/modifica/${encPath(path)}">${icon('edit_note')}Modifica</a>
        <button class="btn outlined" id="move-deck">${icon('drive_file_move')}Sposta</button>
        <button class="btn outlined" id="export-deck">${icon('download')}Esporta</button>
      </div>
      <div class="btn-col"><button class="btn text danger" id="del-deck">${icon('delete')}Elimina mazzo</button></div>`
    : `<div class="btn-grid">
        <button class="btn outlined" id="copy-deck">${icon('content_copy')}Copia sul dispositivo</button>
        <button class="btn outlined" id="hide-deck">${icon('visibility_off')}Nascondi</button>
      </div>`}
    </section>
    ${hardest.length ? `<div class="subhead title-s">${isQuiz ? 'Domande' : 'Carte'} che sbagli più spesso</div>
      <div class="list">${hardest.map(({ it, s }) => `
        <div class="item">
          <span class="score-chip ${pctClass(100 - Math.round((s.errori / s.tentativi) * 100))}">${s.errori}/${s.tentativi}</span>
          <span class="item-main"><span class="headline">${esc(plain(it.q))}</span>
          <span class="support">sbagliata ${s.errori} ${s.errori === 1 ? 'volta' : 'volte'} su ${s.tentativi}</span></span>
        </div>`).join('')}</div>` : ''}
    ${results.length ? `<div class="subhead title-s">Andamento</div>
      <div class="chart" aria-label="Percentuali degli ultimi ${chartData.length} tentativi">${chartData.map((r) => `<span class="${pctClass(r.percentuale)}" style="height:${Math.max(4, r.percentuale)}%" title="${r.percentuale}%"></span>`).join('')}</div>
      ${resultList(results.slice(0, 10), false)}` : ''}
  </main>`);

  document.getElementById('move-deck')?.addEventListener('click', async () => {
    const to = await pickFolder((f) => f === d.cartella);
    if (!to) return;
    const newPath = library.moveDeck(path, to);
    scores.renameDeck(path, newPath, to);
    location.replace(`#/mazzo/${encPath(newPath)}`);
    snackbar(`Spostato in ${to === library.ROOT ? 'Home' : folderName(to)}`);
  });
  document.getElementById('rename-deck')?.addEventListener('click', async () => {
    const n = await dialog({ title: 'Rinomina mazzo', input: 'Nuovo nome', value: d.titolo, confirm: 'Rinomina' });
    if (!n || n === d.titolo) return;
    library.renameDeck(path, n);
    await route();
    snackbar(`Rinominato in “${n}”`);
  });
  document.getElementById('copy-deck')?.addEventListener('click', async () => {
    const n = await copyToDevice('deck', path);
    if (!n) return snackbar('Copia non riuscita: serve la connessione');
    go('#/');
    snackbar('Copiato sul dispositivo: lo trovi in Home');
  });
  document.getElementById('hide-deck')?.addEventListener('click', async () => {
    hide(path);
    location.replace(folderHref(d.cartella));
    snackbar('Nascosto. Puoi mostrarlo di nuovo dalle Impostazioni.');
  });
  document.getElementById('export-deck')?.addEventListener('click', async () => {
    const name = path.split('/').pop();
    if (await saveFile(name, 'text/markdown', library.readDeck(path))) snackbar(`Esportato ${name}`);
  });
  document.getElementById('del-deck')?.addEventListener('click', async () => {
    if (!(await dialog({ title: `Eliminare “${d.titolo}”?`, text: 'Il mazzo verrà eliminato da questo dispositivo. I punteggi restano nello storico.', confirm: 'Elimina', danger: true }))) return;
    library.deleteDeck(path);
    location.replace(folderHref(d.cartella));
    snackbar('Mazzo eliminato');
  });

  const $form = document.getElementById('start');
  const $count = document.getElementById('count');
  const updateMode = () => {
    const weak = $form.mode.value === 'weak';
    document.getElementById('shuffle-row').hidden = weak;
    document.getElementById('mode-help').textContent = !weakReady
      ? `Completa una sessione per sbloccare "Punti deboli": sceglie ${isQuiz ? 'le domande' : 'le carte'} che sbagli più spesso.`
      : weak
        ? `Prima ${isQuiz ? 'le domande' : 'le carte'} che sbagli più spesso, poi quelle che non ripassi da tempo e quelle mai viste.`
        : `Tutte ${isQuiz ? 'le domande' : 'le carte'} del mazzo.`;
    if (weak && $count.value === String(n) && counts.includes(10)) $count.value = '10';
  };
  $form.querySelectorAll('[name=mode]').forEach((r) => r.addEventListener('change', updateMode));
  updateMode();

  $form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const count = Number(f.get('count')) || n;
    const weak = f.get('mode') === 'weak';
    let items = playable;
    if (weak) items = pickWeak(items, stats, count);
    else items = (f.get('shuffle') ? shuffle(items) : items).slice(0, count);
    startSession(d, deck, items, { reverse: !!f.get('reverse'), shuffle: weak || !!f.get('shuffle'), record: true, mode: weak ? 'deboli' : 'tutte' });
  });
}

// ---------- sessioni ----------
function startSession(d, deck, items, opts) {
  session = { d, deck, items, original: items, opts, start: Date.now(), onKey: null };
  location.hash = `#/gioca/${encPath(d.path)}`;
  if (deck.type === 'quiz') runQuiz();
  else runFlashcards();
}

function stopSession() {
  if (session?.onKey) document.removeEventListener('keydown', session.onKey);
  session = null;
}

function setKeys(fn) {
  if (session.onKey) document.removeEventListener('keydown', session.onKey);
  session.onKey = fn;
  if (fn) document.addEventListener('keydown', fn);
}

function progress(done, total) {
  const pct = total ? (done / total) * 100 : 0;
  return `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}">
    ${pct > 0 ? `<div class="bar" style="width:${pct}%"></div>` : ''}${pct < 100 ? '<div class="track"></div>' : ''}</div>`;
}

// ----- flashcard -----
function runFlashcards() {
  const s = session;
  s.queue = s.items.map((it, i) => ({ it, i }));
  s.firstTry = new Map(); // indice -> sapevo al primo colpo?
  s.total = s.items.length;
  showCard();
}

function showCard() {
  const s = session;
  if (!s.queue.length) return finish();
  const { it } = s.queue[0];
  const [front, back] = s.opts.reverse ? [it.a, it.q] : [it.q, it.a];
  const known = [...s.firstTry.values()].filter(Boolean).length;
  const done = s.total - new Set(s.queue.map((x) => x.i)).size;

  render(`${appbar(s.d.titolo, `#/mazzo/${encPath(s.d.path)}`)}
  <main class="play">
    ${progress(done, s.total)}
    <div class="status body-m"><span>${done} di ${s.total} completate</span><span>${known} sapute</span></div>
    <div class="flip" id="flip" tabindex="0" role="button" aria-label="Gira la carta">
      <div class="flip-inner">
        <div class="face front"><div class="face-content">${md(front, s.d.path)}</div><span class="side">${icon('touch_app')}Tocca per girare</span></div>
        <div class="face back"><div class="face-content">${md(back, s.d.path)}</div><span class="side">${icon('visibility')}Risposta</span></div>
      </div>
    </div>
    <div class="answer-bar" id="actions" hidden>
      <button class="btn negative large" id="no">${icon('replay')}Da ripassare</button>
      <button class="btn filled large" id="yes">${icon('check')}La sapevo</button>
    </div>
    <div class="answer-bar" id="reveal-wrap"><button class="btn tonal large" id="reveal">${icon('visibility')}Mostra risposta</button></div>
  </main>`);

  const $flip = document.getElementById('flip');
  const flip = () => {
    $flip.classList.toggle('flipped');
    document.getElementById('actions').hidden = false;
    document.getElementById('reveal-wrap').hidden = true;
  };
  const answer = (ok) => {
    if (!$flip.classList.contains('flipped')) return;
    const cur = s.queue.shift();
    if (!s.firstTry.has(cur.i)) s.firstTry.set(cur.i, ok);
    if (!ok) s.queue.splice(Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3)), 0, cur); // ritorna fra poco
    showCard();
  };
  $flip.addEventListener('click', flip);
  document.getElementById('reveal').addEventListener('click', flip);
  document.getElementById('no').addEventListener('click', () => answer(false));
  document.getElementById('yes').addEventListener('click', () => answer(true));
  setKeys((e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    else if (e.key === '1' || e.key === 'ArrowLeft') answer(false);
    else if (e.key === '2' || e.key === 'ArrowRight') answer(true);
  });
}

// ----- quiz -----
function runQuiz() {
  const s = session;
  s.idx = 0;
  s.answers = []; // { it, ok, given }
  s.items = s.items.map((it) => ({ ...it, shown: it.options.length && s.opts.shuffle ? shuffle(it.options) : it.options }));
  showQuestion();
}

function showQuestion() {
  const s = session;
  if (s.idx >= s.items.length) return finish();
  const it = s.items[s.idx];
  const correctSoFar = s.answers.filter((a) => a.ok).length;
  const hint = it.kind === 'multi' ? 'Seleziona tutte le risposte corrette' : it.kind === 'open' ? 'Scrivi la risposta' : 'Scegli una risposta';
  const off = it.kind === 'multi' ? 'check_box_outline_blank' : 'radio_button_unchecked';
  const on = it.kind === 'multi' ? 'check_box' : 'radio_button_checked';

  render(`${appbar(s.d.titolo, `#/mazzo/${encPath(s.d.path)}`)}
  <main class="play">
    ${progress(s.idx, s.items.length)}
    <div class="status body-m"><span>${it.retry ? 'Di nuovo: l\'avevi sbagliata' : `Domanda ${s.idx + 1} di ${s.original.length}`}</span><span>${correctSoFar} corrette</span></div>
    <section class="question">
      <div class="q-text">${md(it.q, s.d.path)}</div>
      <p class="hint body-m">${hint}</p>
      ${it.kind === 'open'
    ? `<form id="open" class="field"><label for="answer">La tua risposta</label><input id="answer" class="answer" name="a" autocomplete="off" autocapitalize="off" enterkeyhint="done"></form>`
    : `<div class="choices">${it.shown.map((o, i) => `<button class="choice state" data-i="${i}">${icon(off)}<span>${md(o.text, s.d.path)}</span></button>`).join('')}</div>`}
      <div id="feedback"></div>
    </section>
    <div class="footer-actions">
      ${it.kind !== 'single' ? `<button class="btn filled large" id="check">${icon('check')}Verifica</button>` : ''}
      <button class="btn filled large trailing" id="next" hidden>${s.idx + 1 < s.items.length ? 'Prossima domanda' : 'Vedi il risultato'}${icon('arrow_forward')}</button>
    </div>
  </main>`);

  const $choices = [...document.querySelectorAll('.choice')];
  const $check = document.getElementById('check');
  const $next = document.getElementById('next');
  const setIcon = (c, name) => { c.querySelector('.icon').textContent = name; };
  let checked = false;

  const check = () => {
    if (checked) return;
    let ok;
    let given;
    if (it.kind === 'open') {
      const $a = document.querySelector('.answer');
      if (!$a.value.trim()) return;
      given = $a.value;
      ok = it.accepted.some((a) => normalizeAnswer(a) === normalizeAnswer($a.value));
      $a.readOnly = true;
    } else {
      const sel = $choices.filter((c) => c.classList.contains('selected')).map((c) => Number(c.dataset.i));
      if (!sel.length) return;
      given = sel.map((i) => it.shown[i].text).join(', ');
      ok = it.shown.every((o, i) => o.correct === sel.includes(i));
      $choices.forEach((c, i) => {
        c.disabled = true;
        c.classList.remove('selected');
        if (it.shown[i].correct) { c.classList.add('right'); setIcon(c, 'check_circle'); }
        else if (sel.includes(i)) { c.classList.add('wrong'); setIcon(c, 'cancel'); }
      });
    }
    checked = true;
    if (!it.retry) s.answers.push({ it, ok, given });
    // In "Punti deboli" una domanda sbagliata torna alla fine della sessione (non conta nel punteggio).
    if (!ok && s.opts.mode === 'deboli' && !it.retry) {
      s.items.push({ ...it, retry: true, shown: shuffle(it.options) });
      $next.innerHTML = `Prossima domanda${icon('arrow_forward')}`;
    }
    document.getElementById('feedback').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}" role="status">
      ${icon(ok ? 'check_circle' : 'cancel', 'fill')}
      <div>
        <strong>${ok ? 'Corretto' : 'Sbagliato'}</strong>
        ${!ok && it.kind === 'open' ? `<span>Risposta giusta: ${md(it.accepted[0], s.d.path)}</span>` : ''}
        ${it.e ? `<span class="expl body-m">${md(it.e, s.d.path)}</span>` : ''}
      </div>
    </div>`;
    if ($check) $check.hidden = true;
    $next.hidden = false;
    $next.focus({ preventScroll: true });
    document.getElementById('feedback').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const next = () => { if (checked) { s.idx++; showQuestion(); } };

  $choices.forEach((c) => c.addEventListener('click', () => {
    if (checked) return;
    if (it.kind === 'single') { c.classList.add('selected'); check(); return; }
    c.classList.toggle('selected');
    setIcon(c, c.classList.contains('selected') ? on : off);
  }));
  $check?.addEventListener('click', check);
  $next.addEventListener('click', next);
  document.getElementById('open')?.addEventListener('submit', (e) => { e.preventDefault(); checked ? next() : check(); });
  document.querySelector('.answer')?.focus();

  setKeys((e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toUpperCase();
    const i = k.charCodeAt(0) - 65;
    if (k.length === 1 && i >= 0 && i < $choices.length) $choices[i].click();
    else if (e.key === 'Enter') { e.preventDefault(); checked ? next() : check(); }
  });
}

// ----- fine sessione -----
// Forma "cookie" a 9 lobi della libreria di forme M3 Expressive.
function cookiePath(lobes = 9, depth = 0.07) {
  const pts = [];
  for (let k = 0; k <= 180; k++) {
    const t = (k / 180) * Math.PI * 2;
    const r = 50 * (1 - depth + depth * Math.cos(lobes * t));
    pts.push(`${(50 + r * Math.cos(t)).toFixed(2)},${(50 + r * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

async function finish() {
  const s = session;
  setKeys(null);
  const isQuiz = s.deck.type === 'quiz';
  const durata = Math.round((Date.now() - s.start) / 1000);
  const punti = isQuiz ? s.answers.filter((a) => a.ok).length : [...s.firstTry.values()].filter(Boolean).length;
  const totale = isQuiz ? s.answers.length : s.total;
  const pct = totale ? Math.round((punti / totale) * 100) : 0;
  const wrongAnswers = isQuiz ? s.answers.filter((a) => !a.ok) : [];
  const wrongItems = isQuiz ? wrongAnswers.map((a) => a.it) : s.items.filter((_, i) => !s.firstTry.get(i));
  const hasToken = scores.canSync();

  const risposte = isQuiz
    ? s.answers.map((a) => ({ d: a.it.id, ok: a.ok }))
    : [...s.firstTry].map(([i, ok]) => ({ d: s.items[i].id, ok }));
  if (s.opts.record) scores.addResult(s.d, { punti, totale, durata, modo: s.opts.mode, risposte });
  const original = s.original;

  const d = s.d;
  const deck = s.deck;
  const opts = s.opts;
  const msg = pct === 100 ? 'Tutto giusto.' : pct >= 80 ? 'Ci sei quasi.' : pct >= 50 ? 'Buona base, ripassa gli errori.' : 'Da ripassare con calma.';
  render(`${appbar(d.titolo, `#/mazzo/${encPath(d.path)}`)}
  <main>
    <section class="result">
      <div class="cookie ${pctClass(pct)}"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="${cookiePath()}"/></svg><span class="pct">${pct}%</span></div>
      <h2 class="headline-m">${msg}</h2>
      <p class="variant">${punti} su ${totale} ${isQuiz ? 'risposte corrette' : 'carte sapute al primo colpo'}, in ${fmtDur(durata)}</p>
      ${!opts.record ? '<p class="variant body-m">Il ripasso degli errori non viene registrato nello storico.</p>' : ''}
      <div class="btn-col">
        ${wrongItems.length ? `<button class="btn filled large" id="retry-wrong">${icon('replay')}Ripassa ${wrongItems.length === 1 ? "l'errore" : `i ${wrongItems.length} errori`}</button>` : ''}
        <button class="btn tonal large" id="retry">${icon('refresh')}Ricomincia</button>
        <a class="btn text" href="#/mazzo/${encPath(d.path)}">Torna al mazzo</a>
      </div>
    </section>
    ${wrongAnswers.length ? `<div class="subhead title-s">Da rivedere</div>${wrongAnswers.map((a) => `
      <div class="card review">
        <div class="q-text">${md(a.it.q, d.path)}</div>
        <p class="body-m"><span class="tag-bad">Hai risposto:</span> ${md(a.given, d.path)}</p>
        <p class="body-m"><span class="tag-good">Corretta:</span> ${md(a.it.kind === 'open' ? a.it.accepted[0] : a.it.options.filter((o) => o.correct).map((o) => o.text).join(', '), d.path)}</p>
        ${a.it.e ? `<p class="body-m variant">${md(a.it.e, d.path)}</p>` : ''}
      </div>`).join('')}` : ''}
  </main>`);
  stopSession();

  document.getElementById('retry-wrong')?.addEventListener('click', () => startSession(d, deck, shuffle(wrongItems), { ...opts, record: false }));
  document.getElementById('retry').addEventListener('click', () => {
    if (opts.mode === 'deboli') return startSession(d, deck, shuffle(original), { ...opts, record: true });
    const items = deck.items.filter((it) => (deck.type === 'quiz' ? it.kind : it.q && it.a));
    startSession(d, deck, (opts.shuffle ? shuffle(items) : items).slice(0, totale), { ...opts, record: true });
  });

  if (!opts.record) return;
  if (!hasToken || !scores.getSettings().autoSync) {
    snackbar('Punteggio salvato sul dispositivo');
    return;
  }
  const r = await scores.syncAll();
  snackbar(r.ok ? 'Punteggio salvato e sincronizzato con GitHub' : `Punteggio salvato sul dispositivo. Sincronizzazione non riuscita: ${r.errore}`);
}

// ---------- guida ----------
const GUIDE_SEEN = 'sq.guida-vista';

function viewGuide() {
  localStorage.setItem(GUIDE_SEEN, '1');
  render(`${appbar('Guida', '#/')}
  <main class="guide">
    <section class="card">
      <h2 class="title-l">${icon('auto_awesome', 'fill')}Crea flashcard con l'AI</h2>
      <ol class="steps">
        <li>Nella home tocca <strong>Nuovo mazzo</strong> e scegli <em>Flashcard</em> o <em>Quiz</em>.</li>
        <li>Tocca <strong>Istruzioni per l'AI</strong>: vengono copiate.</li>
        <li>In ChatGPT, Claude o Gemini incolla le istruzioni, aggiungi sotto i tuoi appunti e invia.</li>
        <li>Copia la risposta, torna all'editor, tocca <strong>Incolla</strong> e poi <strong>Salva</strong>.</li>
      </ol>
      <p class="body-m variant">Il riquadro sotto l'editor diventa verde quando il formato è giusto; se è rosso indica la riga da correggere. Puoi chiedere all'AI quante carte vuoi, per esempio "fammene 20".</p>
      <a class="btn filled" href="#/nuovo/${encPath(library.ROOT)}">${icon('add')}Crea il primo mazzo</a>
    </section>
    <section class="card">
      <h2 class="title-l">Studia</h2>
      <ul class="bullets body-m">
        <li><strong>Flashcard</strong>: tocca la carta per girarla, poi scegli <em>La sapevo</em> o <em>Da ripassare</em>.</li>
        <li><strong>Quiz</strong>: tocca la risposta e leggi la spiegazione.</li>
        <li><strong>Punti deboli</strong> ti ripropone prima quello che sbagli più spesso.</li>
      </ul>
    </section>
    <section class="card">
      <h2 class="title-l">Organizza e conserva</h2>
      <ul class="bullets body-m">
        <li><strong>Tieni premuto</strong> un mazzo o una cartella per rinominarlo, spostarlo, esportarlo o eliminarlo.</li>
        <li>Quelli con la ${icon('cloud', 'fill inline')} sono online: tenendoli premuti puoi copiarli sul dispositivo o nasconderli.</li>
        <li><strong>Esporta</strong> salva un mazzo (.md) o una cartella intera (.zip); <strong>Importa file</strong> li ricarica.</li>
        <li>Esporta ogni tanto come backup (<strong>Esporta tutto</strong> nella home): se disinstalli l'app, i tuoi mazzi si perdono.</li>
      </ul>
    </section>
  </main>`);
}

// ---------- aggiornamenti dell'app (solo Android) ----------
const RELEASES_API = 'https://api.github.com/repos/M1ke324/flash-now/releases/latest';
const UPDATE_KEY = 'sq.aggiornamento';

const newer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
};

let appVersion = null;
async function getAppVersion() {
  if (!hasNative()) return null;
  if (!appVersion) appVersion = (await nativeRequest({ type: 'version' })).version || null;
  return appVersion;
}

// Controlla l'ultima Release su GitHub (al massimo ogni 6 ore, a meno di force).
// Ritorna { version, url } se c'è una versione più nuova di quella installata.
async function checkUpdate(force = false) {
  const current = await getAppVersion();
  if (!current || !onlineEnabled()) return null;
  let info = null;
  try { info = JSON.parse(localStorage.getItem(UPDATE_KEY)); } catch { /* niente in cache */ }
  if (force || !info || Date.now() - info.checked > 6 * 3600e3) {
    const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const apk = (j.assets || []).find((a) => a.name.endsWith('.apk'));
    info = { checked: Date.now(), version: String(j.tag_name || '').replace(/^v/, ''), url: apk?.browser_download_url || null };
    localStorage.setItem(UPDATE_KEY, JSON.stringify(info));
  }
  return info.url && newer(info.version, current) ? info : null;
}

async function showUpdateBanner() {
  const slot = document.getElementById('update-slot');
  if (!slot || !hasNative()) return;
  const info = await checkUpdate().catch(() => null);
  if (!info || !document.body.contains(slot)) return;
  slot.innerHTML = `<section class="update-banner">
    ${icon('system_update', 'fill')}
    <span class="body-m"><strong>Flash Now ${esc(info.version)}</strong> è disponibile</span>
    <button class="btn filled" id="do-update">Aggiorna</button>
  </section>`;
  document.getElementById('do-update').addEventListener('click', (e) => runUpdate(info, e.currentTarget));
}

// Scarica l'APK (nel codice nativo) e apre l'installazione di Android.
async function runUpdate(info, button) {
  if (button) button.disabled = true;
  snackbar('Download dell\'aggiornamento…');
  const r = await nativeRequest({ type: 'update', url: info.url }, (p) => {
    if (button) button.textContent = `${p}%`;
  });
  if (button) { button.disabled = false; button.textContent = 'Aggiorna'; }
  if (!r.ok) return snackbar(`Aggiornamento non riuscito: ${r.error || 'errore di rete'}`);
  snackbar(r.permission
    ? 'Consenti a Flash Now di installare app, poi torna qui: l\'installazione parte da sola'
    : 'Conferma l\'installazione per aggiornare Flash Now');
}

// ---------- impostazioni ----------
async function viewSettings() {
  const s = scores.getSettings();
  const total = scores.localCount();
  const pending = scores.unsynced().length;
  const adv = advanced();
  const hiddenCount = hiddenList().length;
  const version = await getAppVersion().catch(() => null);
  const field = (name, label, value, extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" value="${esc(value)}" autocapitalize="off" autocomplete="off" spellcheck="false" ${extra}></div>`;
  render(`${appbar('Impostazioni', '#/')}
  <main>
    <section class="card">
      <h2 class="title-l">Mazzi online</h2>
      <p class="body-m variant">I mazzi online sono quelli con la nuvola. Vengono scaricati quando c'è connessione e restano disponibili offline.</p>
      ${IN_APP ? `<label class="setting-row"><span>Mostra i mazzi online<br><span class="body-m variant">Spento, l'app non usa internet e mostra solo i tuoi mazzi</span></span><input class="switch" type="checkbox" id="online" ${onlineEnabled() ? 'checked' : ''}></label>` : ''}
      <div class="setting-row static"><span>${hiddenCount ? `${hiddenCount} ${hiddenCount === 1 ? 'elemento nascosto' : 'elementi nascosti'}` : 'Nessun elemento nascosto'}<br><span class="body-m variant">Per nascondere una cartella o un mazzo online tienilo premuto</span></span>
        <button class="btn text" id="unhide" ${hiddenCount ? '' : 'disabled'}>Mostra tutti</button></div>
    </section>
    ${version ? `<section class="card">
      <h2 class="title-l">App</h2>
      <div class="setting-row static"><span>Versione ${esc(version)}<br><span class="body-m variant" id="update-status">L'app controlla da sola se ci sono aggiornamenti</span></span>
        <button class="btn tonal" id="check-update">Controlla</button></div>
    </section>` : ''}
    <section class="card">
      <h2 class="title-l">Modalità avanzata</h2>
      <label class="setting-row"><span>Attiva la modalità avanzata<br><span class="body-m variant">Sincronizzazione dei punteggi con un repository GitHub tramite token</span></span><input class="switch" type="checkbox" id="advanced" ${adv ? 'checked' : ''}></label>
    </section>
    ${adv ? `<section class="card">
      <h2 class="title-l">Sincronizzazione con GitHub</h2>
      <p class="body-m variant">Copia i punteggi dei mazzi online nel file <code>punteggi.json</code> della loro cartella nel repository. I punteggi dei tuoi mazzi restano sul dispositivo.</p>
      <p class="body-m variant">Serve un <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a> limitato al repository, con il permesso <strong>Contents: Read and write</strong>. Il token resta salvato solo su questo dispositivo.</p>
      <div class="list">
        <div class="item"><span class="avatar folder">${icon('history')}</span>
          <span class="item-main"><span class="headline">${total} ${total === 1 ? 'sessione salvata' : 'sessioni salvate'}</span>
          <span class="support">${!s.token ? 'Token non configurato' : pending ? `${pending} da sincronizzare` : 'Tutto sincronizzato'}</span></span>
        </div>
      </div>
      <form id="gh" class="settings-form">
        ${field('owner', 'Utente o organizzazione', s.owner, 'required')}
        ${field('repo', 'Repository', s.repo, 'required')}
        ${field('branch', 'Branch', s.branch, 'required')}
        ${field('token', 'Token', s.token, 'type="password" placeholder="github_pat_…"')}
        <label class="setting-row"><span>Sincronizza dopo ogni sessione<br><span class="body-m variant">Se è disattivato, sincronizzi tu con il pulsante qui sotto</span></span><input class="switch" type="checkbox" name="autoSync" ${s.autoSync ? 'checked' : ''}></label>
        <div class="btn-row">
          <button class="btn outlined" type="button" id="test">Prova connessione</button>
          <button class="btn filled" type="submit">Salva</button>
        </div>
      </form>
      <div class="btn-col">
        <button class="btn tonal" id="sync-now" ${pending && s.token ? '' : 'disabled'}>${icon('sync')}${pending ? `Sincronizza ora (${pending})` : 'Sincronizza ora'}</button>
      </div>
    </section>` : ''}
  </main>`);

  document.getElementById('online')?.addEventListener('change', (e) => {
    setOnlineEnabled(e.target.checked);
    remote = null;
    snackbar(e.target.checked ? 'Mazzi online attivati' : 'Mazzi online disattivati: l\'app funziona senza connessione');
  });
  document.getElementById('unhide').addEventListener('click', () => {
    unhideAll();
    snackbar('Tutti gli elementi online sono di nuovo visibili');
    viewSettings();
  });
  document.getElementById('advanced').addEventListener('change', (e) => {
    setAdvanced(e.target.checked);
    viewSettings();
  });
  let found = null;
  document.getElementById('check-update')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const $st = document.getElementById('update-status');
    if (found) return runUpdate(found, btn);
    btn.disabled = true;
    try {
      found = await checkUpdate(true);
      $st.textContent = found ? `Disponibile la versione ${found.version}` : 'Hai già l\'ultima versione';
      if (found) btn.textContent = 'Aggiorna';
    } catch {
      $st.textContent = 'Controllo non riuscito: serve la connessione';
    }
    btn.disabled = false;
  });
  if (!adv) return;

  const read = () => {
    const f = new FormData(document.getElementById('gh'));
    return { ...Object.fromEntries(f), autoSync: f.get('autoSync') === 'on' };
  };
  document.getElementById('gh').addEventListener('submit', (e) => {
    e.preventDefault();
    scores.saveSettings(read());
    snackbar('Impostazioni salvate');
    viewSettings();
  });
  document.getElementById('test').addEventListener('click', async () => {
    try { snackbar(`Connesso a ${await scores.testConnection(read())}`); } catch (e) { snackbar(`Connessione non riuscita: ${e.message}. Controlla utente, repository e token.`); }
  });
  document.getElementById('sync-now').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const r = await scores.syncAll();
    snackbar(r.ok ? `${r.inviati} ${r.inviati === 1 ? 'sessione sincronizzata' : 'sessioni sincronizzate'} con GitHub` : `Sincronizzazione non riuscita: ${r.errore}`);
    viewSettings();
  });
}

route();
