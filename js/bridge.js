// Canale con il codice nativo dell'app Android ("FlashNowAndroid").
// Ogni richiesta ha un id; il codice nativo risponde con lo stesso id.
// Le risposte intermedie con "progress" (es. download dell'aggiornamento) chiamano onProgress.

const pending = new Map();
let seq = 0;
let ready = false;

export const hasNative = () => !!window.FlashNowAndroid;

export function nativeRequest(msg, onProgress) {
  const b = window.FlashNowAndroid;
  if (!b) return Promise.reject(new Error('non disponibile fuori dall\'app'));
  if (!ready) {
    b.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      const h = pending.get(m.id);
      if (!h) return;
      if ('progress' in m && !('ok' in m)) { h.onProgress?.(m.progress); return; }
      pending.delete(m.id);
      h.resolve(m);
    };
    ready = true;
  }
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, { resolve, onProgress });
    b.postMessage(JSON.stringify({ ...msg, id }));
  });
}
