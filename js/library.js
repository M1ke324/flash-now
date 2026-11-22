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
    if (d && Array.isArray(d.cartelle) && d.mazzi) return d;
  } catch { /* dati assenti o corrotti */ }
  return { cartelle: [], mazzi: {} };
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

export const readDeck = (path) => load().mazzi[path] ?? null;

export function addFolder(parent, name) {
  const d = load();
  const id = `${parent}/${slug(name)}`;
  if (d.cartelle.includes(id)) throw new Error('Esiste già una cartella con questo nome.');
  d.cartelle.push(id);
  store(d);
  return id;
}

// Salva un mazzo. Senza path ne crea uno nuovo nella cartella, con il nome ricavato dal titolo.
export function saveDeck(text, { path = null, folder = ROOT, name = '' } = {}) {
  const d = load();
  if (!path) {
    const base = slug(parseDeck(text).title || name || 'mazzo');
    path = `${folder}/${base}.md`;
    for (let i = 2; d.mazzi[path] !== undefined; i++) path = `${folder}/${base}-${i}.md`;
  }
  d.mazzi[path] = text;
  store(d);
  return path;
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
  store(d);
  return decks.length;
}
