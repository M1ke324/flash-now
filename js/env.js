// Ambiente di esecuzione e accesso alla rete.
//
// Il sito gira in due modi:
// - sul web (GitHub Pages o in locale): i mazzi online sono quelli dello stesso sito;
// - nell'app Android: il sito è incluso nell'APK (servito da appassets.androidplatform.net)
//   e i mazzi online, facoltativi, vengono scaricati da SITE.

export const SITE = 'https://m1ke324.github.io/studio-quiz/';
export const REPO = { owner: 'M1ke324', repo: 'studio-quiz' };
export const IN_APP = location.hostname === 'appassets.androidplatform.net';
const BASE = IN_APP ? SITE : '';

const ONLINE_KEY = 'sq.online';

// Mazzi online attivi? Sul web sempre; nell'app si può spegnere dalle impostazioni.
export const onlineEnabled = () => !IN_APP || localStorage.getItem(ONLINE_KEY) !== 'no';
export const setOnlineEnabled = (on) => localStorage.setItem(ONLINE_KEY, on ? 'si' : 'no');

export const remoteUrl = (path) => new URL(path, BASE || document.baseURI).href;

// Scarica un file dei mazzi online. Ogni risposta viene conservata in cache,
// così senza connessione si usano le ultime versioni scaricate.
// Ritorna il testo, oppure null se il file non esiste.
export async function getRemoteText(path, { timeout = 8000 } = {}) {
  const url = remoteUrl(path);
  const key = `sq.cache:${url}`;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const r = await fetch(url, { cache: 'no-cache', signal: ctl.signal });
    clearTimeout(timer);
    if (r.status === 404) {
      localStorage.removeItem(key);
      return null;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    try { localStorage.setItem(key, text); } catch { /* memoria piena: si va avanti senza cache */ }
    return text;
  } catch (e) {
    const cached = localStorage.getItem(key);
    if (cached !== null) return cached;
    throw e;
  }
}
