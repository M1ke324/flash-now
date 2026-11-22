// Parser del formato "mazzo" (vedi FORMATO.md).
// Usato sia dal browser (app.js) sia da Node (scripts/build-manifest.mjs).

const RE_Q = /^(?:D|Q):[ \t]?(.*)$/;
const RE_A = /^(?:R|A):[ \t]?(.*)$/;
const RE_E = /^(?:S|E):[ \t]?(.*)$/;
const RE_OPT = /^[-*][ \t]*\[([ xX])\][ \t]?(.*)$/;

export function parseDeck(text) {
  text = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const meta = {};
  let body = text;
  let lineOffset = 0;

  const fm = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (fm) {
    body = text.slice(fm[0].length);
    lineOffset = fm[0].split('\n').length - 1;
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
      if (m) meta[m[1].toLowerCase()] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
    }
  }

  const rawType = (meta.tipo || meta.type || 'flashcard').toLowerCase();
  const type = rawType.startsWith('quiz') ? 'quiz' : 'flashcard';
  const shuffleVal = (meta.mescola || meta.shuffle || 'si').toLowerCase();
  const deck = {
    title: meta.titolo || meta.title || '',
    description: meta.descrizione || meta.description || '',
    type,
    shuffle: !['no', 'false', '0'].includes(shuffleVal),
    meta,
    items: [],
    errors: [],
  };

  let cur = null;
  let field = null; // 'q' | 'a' | 'e' | numero (indice opzione)
  const lines = body.split('\n');

  const append = (line) => {
    if (typeof field === 'number') cur.options[field].text += '\n' + line;
    else cur[field] += '\n' + line;
  };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = line.match(RE_Q))) {
      cur = { q: m[1], a: '', e: '', options: [], line: i + 1 + lineOffset };
      deck.items.push(cur);
      field = 'q';
      return;
    }
    if (!cur) return; // tutto ciò che precede la prima domanda è ignorato
    if (/^#/.test(line)) return; // titoli markdown: solo per organizzare il file
    if ((m = line.match(RE_A))) { cur.a = m[1]; field = 'a'; return; }
    if ((m = line.match(RE_E))) { cur.e = m[1]; field = 'e'; return; }
    if ((m = line.match(RE_OPT))) {
      cur.options.push({ text: m[2], correct: m[1] !== ' ' });
      field = cur.options.length - 1;
      return;
    }
    append(line.replace(/^ /, '')); // uno spazio iniziale serve come "escape"
  });

  for (const it of deck.items) {
    it.q = it.q.trim();
    it.id = hash(normalizeAnswer(it.q));
    it.a = it.a.trim();
    it.e = it.e.trim();
    for (const o of it.options) o.text = o.text.trim();
    const where = `riga ${it.line}`;
    if (!it.q) deck.errors.push(`${where}: domanda vuota`);
    if (type === 'flashcard') {
      if (!it.a) deck.errors.push(`${where}: flashcard senza risposta (R:)`);
    } else if (it.options.length) {
      if (it.options.length < 2) deck.errors.push(`${where}: servono almeno 2 opzioni`);
      if (!it.options.some((o) => o.correct)) deck.errors.push(`${where}: nessuna opzione corretta [x]`);
      it.kind = it.options.filter((o) => o.correct).length > 1 ? 'multi' : 'single';
    } else if (it.a) {
      it.kind = 'open';
      it.accepted = it.a.split('|').map((s) => s.trim()).filter(Boolean);
    } else {
      deck.errors.push(`${where}: domanda di quiz senza opzioni né risposta (R:)`);
    }
  }
  if (!deck.items.length) deck.errors.push('nessuna domanda trovata (le domande iniziano con "D:")');
  return deck;
}

// Identificativo di una domanda: hash FNV-1a del testo normalizzato.
// Serve a collegare le risposte salvate alla domanda; se il testo cambia, la domanda riparte da zero.
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Normalizza una risposta aperta per il confronto: minuscole, senza accenti e spazi superflui.
export function normalizeAnswer(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:!?"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
