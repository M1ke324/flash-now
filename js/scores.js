// Gestione punteggi.
// - Ogni risultato viene salvato prima di tutto sul dispositivo (localStorage del browser o dell'app).
// - La sincronizzazione con GitHub è facoltativa: con un token configurato i risultati vengono
//   scritti nel file punteggi.json della cartella del mazzo, a mano ("Sincronizza ora")
//   oppure dopo ogni sessione se è attiva la sincronizzazione automatica.
// - Quando si visualizzano i punteggi si uniscono quelli del repo e quelli locali (per id).
// - I mazzi "Sul dispositivo" (cartelle che iniziano con "~") non hanno un file nel repository:
//   i loro punteggi restano solo sul dispositivo e non vengono sincronizzati.

import { IN_APP, REPO, onlineEnabled, getRemoteText } from './env.js';
import { isLocal } from './library.js';

const LS_LOCAL = 'sq.risultati';
const LS_SYNCED = 'sq.sincronizzati';
const LS_SETTINGS = 'sq.impostazioni';

const readLS = (k, def) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; }
};
const writeLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ---------- impostazioni ----------
export function getSettings() {
  const s = readLS(LS_SETTINGS, {});
  const guess = guessRepo();
  return {
    owner: s.owner || guess.owner || '',
    repo: s.repo || guess.repo || '',
    branch: s.branch || 'main',
    token: s.token || '',
    autoSync: s.autoSync === true,
  };
}
export function saveSettings(s) { writeLS(LS_SETTINGS, s); }

// Ricava owner/repo dall'indirizzo GitHub Pages (utente.github.io/repo/).
function guessRepo() {
  if (IN_APP) return REPO;
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return {};
  const first = location.pathname.split('/').filter(Boolean)[0];
  return { owner: m[1], repo: first || `${m[1]}.github.io` };
}

// ---------- percorsi ----------
export const scoresPath = (folder) => (folder ? `decks/${folder}/punteggi.json` : 'decks/punteggi.json');

// ---------- lettura ----------
const remoteCache = new Map();
async function fetchRemote(folder) {
  if (isLocal(folder) || !onlineEnabled()) return [];
  if (!remoteCache.has(folder)) {
    remoteCache.set(folder, getRemoteText(scoresPath(folder))
      .then((t) => (t ? JSON.parse(t) : {}))
      .then((j) => (Array.isArray(j.risultati) ? j.risultati : []))
      .catch(() => []));
  }
  return remoteCache.get(folder);
}

// Tutti i risultati di una cartella, ordinati dal più recente.
export async function folderResults(folder) {
  const remote = await fetchRemote(folder);
  const byId = new Map(remote.map((r) => [r.id, r]));
  for (const r of readLS(LS_LOCAL, [])) if (r.cartella === folder) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => b.data.localeCompare(a.data));
}

export async function deckResults(deck) {
  return (await folderResults(deck.cartella)).filter((r) => r.mazzo === deck.path);
}

// ---------- scrittura ----------
export function addResult(deck, { punti, totale, durata, modo, risposte }) {
  const r = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    mazzo: deck.path,
    cartella: deck.cartella,
    tipo: deck.tipo,
    data: new Date().toISOString(),
    punti,
    totale,
    percentuale: totale ? Math.round((punti / totale) * 100) : 0,
    durata,
    modo,
    risposte, // [{ d: id domanda, ok: true/false }]
  };
  const local = readLS(LS_LOCAL, []);
  local.push(r);
  writeLS(LS_LOCAL, local);
  return r;
}

export const localCount = () => readLS(LS_LOCAL, []).length;
export const canSync = () => { const s = getSettings(); return !!(s.token && s.owner && s.repo); };

// Dopo lo spostamento di un mazzo locale, lo storico segue il nuovo percorso.
export function renameDeck(from, to, folder) {
  const local = readLS(LS_LOCAL, []);
  for (const r of local) if (r.mazzo === from) { r.mazzo = to; r.cartella = folder; }
  writeLS(LS_LOCAL, local);
}

export function unsynced() {
  const synced = new Set(readLS(LS_SYNCED, []));
  return readLS(LS_LOCAL, []).filter((r) => !synced.has(r.id) && !isLocal(r.cartella));
}

// Invia al repository tutti i risultati non ancora sincronizzati.
// Ritorna { ok, inviati, errore }.
export async function syncAll() {
  const s = getSettings();
  if (!s.token || !s.owner || !s.repo) return { ok: false, inviati: 0, errore: 'GitHub non configurato' };
  const pending = unsynced();
  const groups = new Map();
  for (const r of pending) {
    if (!groups.has(r.cartella)) groups.set(r.cartella, []);
    groups.get(r.cartella).push(r);
  }
  let sent = 0;
  try {
    for (const [folder, list] of groups) {
      await ghAppend(s, folder, list);
      const synced = readLS(LS_SYNCED, []);
      writeLS(LS_SYNCED, synced.concat(list.map((r) => r.id)));
      sent += list.length;
    }
    return { ok: true, inviati: sent };
  } catch (e) {
    return { ok: false, inviati: sent, errore: e.message };
  }
}

// ---------- API GitHub ----------
const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

function ghHeaders(s) {
  return {
    Authorization: `Bearer ${s.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghAppend(s, folder, entries) {
  const path = scoresPath(folder).split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let sha;
    let data = { versione: 1, risultati: [] };
    const g = await fetch(`${url}?ref=${encodeURIComponent(s.branch)}`, { headers: ghHeaders(s), cache: 'no-store' });
    if (g.ok) {
      const j = await g.json();
      sha = j.sha;
      try { data = JSON.parse(b64decode(j.content)); } catch { /* file corrotto: lo si riscrive */ }
      if (!Array.isArray(data.risultati)) data.risultati = [];
    } else if (g.status !== 404) {
      throw new Error(`lettura ${scoresPath(folder)}: HTTP ${g.status}`);
    }
    const ids = new Set(data.risultati.map((r) => r.id));
    for (const e of entries) if (!ids.has(e.id)) data.risultati.push(e);
    data.risultati.sort((a, b) => a.data.localeCompare(b.data));

    const p = await fetch(url, {
      method: 'PUT',
      headers: ghHeaders(s),
      body: JSON.stringify({
        message: `Punteggi: ${folder || 'radice'} (+${entries.length})`,
        content: b64encode(JSON.stringify(data, null, 2) + '\n'),
        branch: s.branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (p.ok) return;
    if (p.status === 409 || p.status === 422) continue; // modificato nel frattempo: riprova
    throw new Error(`scrittura ${scoresPath(folder)}: HTTP ${p.status}`);
  }
  throw new Error('conflitto ripetuto durante la scrittura');
}

export async function testConnection(s) {
  const r = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}`, { headers: ghHeaders(s) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).full_name;
}
