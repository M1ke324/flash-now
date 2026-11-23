// Libreria "Sul dispositivo": cartelle e mazzi salvati in locale (localStorage),
// indipendenti dal repository e utilizzabili senza connessione.
//
// Gli identificativi iniziano con "~":
//   cartella radice  "~"
//   sottocartelle    "~/fisica", "~/fisica/meccanica"
//   mazzi            "~/fisica/leggi-di-newton.md"

import { parseDeck } from './parser.js';

const KEY = 'sq.libreria';
export const ROOT = '~';

export const isLocal = (p) => p === ROOT || p.startsWith(ROOT + '/');
export const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.cartelle) && d.mazzi) { d.nomi ||= {}; return d; }
  } catch { /* dati assenti o corrotti */ }
  return { cartelle: [], mazzi: {}, nomi: {} };
}

function store(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    throw new Error('Memoria del dispositivo piena: elimina qualche mazzo e riprova.');
  }
}

export function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'senza-nome';
}

// Indice nello stesso formato di decks.json.
export function manifest() {
  const d = load();
  const mazzi = Object.entries(d.mazzi).map(([path, text]) => {
    const deck = parseDeck(text);
    const name = path.split('/').pop().replace(/\.md$/, '');
    return {
      path,
      cartella: parentOf(path),
      titolo: deck.title || name.replace(/[-_]/g, ' '),
      descrizione: deck.description,
      tipo: deck.type,
      n: deck.items.length,
    };
  }).sort((a, b) => a.titolo.localeCompare(b.titolo, 'it'));
  return { cartelle: [ROOT, ...d.cartelle].sort((a, b) => a.localeCompare(b, 'it')), mazzi };
}

// Nome visualizzato di una cartella (quello scritto dall'utente, con maiuscole e spazi).
export function folderTitle(id) {
  const n = load().nomi[id];
  if (n) return n;
  const last = id.split('/').pop().replace(/[-_]/g, ' ');
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export function renameFolder(id, name) {
  const d = load();
  d.nomi[id] = name.trim();
  store(d);
}

// Sposta una cartella (con tutto il contenuto) dentro un'altra.
// Ritorna { id: nuovo id, decks: [[vecchio percorso, nuovo percorso], ...] }.
export function moveFolder(id, parent) {
  if (parent === id || parent.startsWith(id + '/')) throw new Error('Non puoi spostare una cartella dentro sé stessa.');
  const d = load();
  if (parentOf(id) === parent) return { id, decks: [] };
  const base = id.split('/').pop();
  let to = `${parent}/${base}`;
  for (let i = 2; d.cartelle.includes(to); i++) to = `${parent}/${base}-${i}`;
  const remap = (p) => (p === id ? to : p.startsWith(id + '/') ? to + p.slice(id.length) : p);
  d.cartelle = d.cartelle.map(remap);
  const decks = [];
  const mazzi = {};
  for (const [p, text] of Object.entries(d.mazzi)) {
    const np = remap(p);
    if (np !== p) decks.push([p, np]);
    mazzi[np] = text;
  }
  d.mazzi = mazzi;
  const nomi = {};
  for (const [k, v] of Object.entries(d.nomi)) nomi[remap(k)] = v;
  d.nomi = nomi;
  store(d);
  return { id: to, decks };
}

// Rinomina un mazzo: cambia il titolo nell'intestazione del file (il percorso resta uguale).
export function renameDeck(path, title) {
  const d = load();
  const text = d.mazzi[path];
  if (text === undefined) throw new Error('Mazzo non trovato.');
  const t = title.trim().replace(/\n/g, ' ');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) d.mazzi[path] = `---\ntitolo: ${t}\n---\n\n${text}`;
  else if (/^\s*(titolo|title)\s*:/m.test(fm[1])) d.mazzi[path] = text.replace(/^(\s*(?:titolo|title)\s*:).*$/m, `$1 ${t}`);
  else d.mazzi[path] = text.replace(/^---\n/, `---\ntitolo: ${t}\n`);
  store(d);
}

export const readDeck = (path) => load().mazzi[path] ?? null;

export function addFolder(parent, name) {
  const d = load();
  const id = `${parent}/${slug(name)}`;
  if (d.cartelle.includes(id)) throw new Error('Esiste già una cartella con questo nome.');
  d.cartelle.push(id);
  d.nomi[id] = name.trim();
  store(d);
  return id;
}

// Crea la cartella e quelle che la contengono, se mancano.
export function ensureFolder(id) {
  const d = load();
  const parts = id.split('/');
  for (let i = 2; i <= parts.length; i++) {
    const f = parts.slice(0, i).join('/');
    if (!d.cartelle.includes(f)) d.cartelle.push(f);
  }
  store(d);
}

// Salva un mazzo. Senza path ne crea uno nuovo nella cartella, con il nome ricavato
// dal titolo (o dal nome del file, se fileName è dato).
export function saveDeck(text, { path = null, folder = ROOT, name = '', fileName = '' } = {}) {
  const d = load();
  if (!path) {
    const base = slug(fileName || parseDeck(text).title || name || 'mazzo');
    path = `${folder}/${base}.md`;
    for (let i = 2; d.mazzi[path] !== undefined; i++) path = `${folder}/${base}-${i}.md`;
  }
  d.mazzi[path] = text;
  store(d);
  return path;
}

// Sposta un mazzo in un'altra cartella mantenendo il nome del file. Ritorna il nuovo percorso.
export function moveDeck(path, folder) {
  const d = load();
  if (d.mazzi[path] === undefined) throw new Error('Mazzo non trovato.');
  if (parentOf(path) === folder) return path;
  const base = path.split('/').pop().replace(/\.md$/, '');
  let to = `${folder}/${base}.md`;
  for (let i = 2; d.mazzi[to] !== undefined; i++) to = `${folder}/${base}-${i}.md`;
  d.mazzi[to] = d.mazzi[path];
  delete d.mazzi[path];
  store(d);
  return to;
}

export function deleteDeck(path) {
  const d = load();
  delete d.mazzi[path];
  store(d);
}

// Elimina la cartella con tutto il contenuto. Ritorna il numero di mazzi eliminati.
export function deleteFolder(id) {
  const d = load();
  const inside = (p) => p === id || p.startsWith(id + '/');
  const decks = Object.keys(d.mazzi).filter(inside);
  for (const p of decks) delete d.mazzi[p];
  d.cartelle = d.cartelle.filter((c) => !inside(c));
  for (const k of Object.keys(d.nomi)) if (inside(k)) delete d.nomi[k];
  store(d);
  return decks.length;
}

// Mazzi contenuti in una cartella (anche nelle sottocartelle), con il percorso relativo.
export function tree(folder) {
  const d = load();
  const prefix = folder + '/';
  return Object.entries(d.mazzi)
    .filter(([p]) => p.startsWith(prefix))
    .map(([p, text]) => ({ rel: p.slice(prefix.length), text }));
}
