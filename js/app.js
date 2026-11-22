import { parseDeck, normalizeAnswer } from './parser.js';
import * as scores from './scores.js';

const $app = document.getElementById('app');
let manifest = null;
let session = null; // sessione di gioco in corso

// ---------- utilità ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

const fmtDate = (iso) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
const folderName = (f) => (f ? f.split('/').pop().replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Home');
const pctClass = (p) => (p >= 80 ? 'good' : p >= 50 ? 'mid' : 'bad');
const typeLabel = (t) => (t === 'quiz' ? 'Quiz' : 'Flashcard');
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const go = (hash) => { location.hash = hash; };

function render(html) {
  $app.innerHTML = html;
  window.scrollTo(0, 0);
}

function header(title, back) {
  return `<header class="top">
    ${back ? `<a class="back" href="${back}" aria-label="Indietro">‹</a>` : '<span class="logo">📚</span>'}
    <h1>${esc(title)}</h1>
    <a class="icon" href="#/impostazioni" aria-label="Impostazioni">⚙︎</a>
  </header>`;
}

async function loadManifest() {
  if (manifest) return manifest;
  const r = await fetch('decks.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('decks.json non trovato. Esegui "node scripts/build-manifest.mjs".');
  manifest = await r.json();
  return manifest;
}

async function loadDeck(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Impossibile caricare ${path}`);
  return parseDeck(await r.text());
}

// ---------- router ----------
async function route() {
  const h = decodeURIComponent(location.hash.slice(1) || '/');
  if (session && !h.startsWith('/gioca/')) stopSession();
  try {
    await loadManifest();
    if (h.startsWith('/cartella/')) return viewFolder(h.slice('/cartella/'.length));
    if (h.startsWith('/mazzo/')) return viewDeck(h.slice('/mazzo/'.length));
    if (h.startsWith('/gioca/')) return session ? null : go(`#/mazzo/${encPath(h.slice('/gioca/'.length))}`);
    if (h === '/impostazioni') return viewSettings();
    return viewFolder('');
  } catch (e) {
    render(`${header('Errore', '#/')}<main><div class="card error">${esc(e.message)}</div></main>`);
  }
}
window.addEventListener('hashchange', route);

// ---------- vista cartella ----------
async function viewFolder(folder) {
  const m = manifest;
  if (folder && !m.cartelle.includes(folder)) return go('#/');
  const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
  const subs = m.cartelle.filter((f) => f && (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '') === folder);
  const decks = m.mazzi.filter((d) => d.cartella === folder);
  const countIn = (f) => m.mazzi.filter((d) => d.cartella === f || d.cartella.startsWith(f + '/')).length;

  const results = await scores.folderResults(folder);
  const lastOf = (d) => results.find((r) => r.mazzo === d.path);

  const crumbs = folder
    ? `<nav class="crumbs"><a href="#/">Home</a>${folder.split('/').map((p, i, a) => {
      const f = a.slice(0, i + 1).join('/');
      return ` / ${i === a.length - 1 ? `<span>${esc(p)}</span>` : `<a href="#/cartella/${encPath(f)}">${esc(p)}</a>`}`;
    }).join('')}</nav>`
    : '';

  render(`${header(folderName(folder), folder ? (parent ? `#/cartella/${encPath(parent)}` : '#/') : null)}
  <main>
    ${crumbs}
    ${!folder ? `<input type="search" id="search" class="search" placeholder="Cerca tra tutti i mazzi…" autocomplete="off">
    <div id="search-results" class="list"></div>` : ''}
    <div id="browse">
    ${subs.length ? `<h2>Cartelle</h2><div class="list">${subs.map((f) => `
      <a class="row" href="#/cartella/${encPath(f)}">
        <span class="row-icon">📁</span>
        <span class="row-main"><strong>${esc(folderName(f))}</strong><small>${countIn(f)} mazzi</small></span>
        <span class="chev">›</span>
      </a>`).join('')}</div>` : ''}
    ${decks.length ? `<h2>Mazzi</h2><div class="list">${decks.map((d) => deckRow(d, lastOf(d))).join('')}</div>` : ''}
    ${!subs.length && !decks.length ? '<p class="muted center">Nessun mazzo qui. Aggiungi file .md nella cartella <code>decks/</code>.</p>' : ''}
    ${results.length ? `<h2>Ultimi punteggi in questa cartella</h2>${resultsTable(results.slice(0, 8), true)}` : ''}
    </div>
  </main>`);

  const $s = document.getElementById('search');
  if ($s) {
    $s.addEventListener('input', () => {
      const q = normalizeAnswer($s.value);
      const $r = document.getElementById('search-results');
      document.getElementById('browse').hidden = !!q;
      $r.innerHTML = q
        ? m.mazzi.filter((d) => normalizeAnswer(`${d.titolo} ${d.descrizione} ${d.cartella}`).includes(q)).map((d) => deckRow(d, null, true)).join('')
          || '<p class="muted center">Nessun risultato</p>'
        : '';
    });
  }
}

function deckRow(d, last, showFolder = false) {
  return `<a class="row" href="#/mazzo/${encPath(d.path)}">
    <span class="row-icon">${d.tipo === 'quiz' ? '❓' : '🃏'}</span>
    <span class="row-main"><strong>${esc(d.titolo)}</strong>
      <small>${typeLabel(d.tipo)} · ${d.n} ${d.tipo === 'quiz' ? 'domande' : 'carte'}${showFolder && d.cartella ? ` · ${esc(d.cartella)}` : ''}</small></span>
    ${last ? `<span class="pill ${pctClass(last.percentuale)}">${last.percentuale}%</span>` : ''}
    <span class="chev">›</span>
  </a>`;
}

function resultsTable(list, withDeck) {
  const title = (p) => manifest.mazzi.find((d) => d.path === p)?.titolo || p.split('/').pop();
  return `<div class="table-wrap"><table class="results">
    <thead><tr><th>Data</th>${withDeck ? '<th>Mazzo</th>' : ''}<th>Punti</th><th>Tempo</th></tr></thead>
    <tbody>${list.map((r) => `<tr>
      <td>${fmtDate(r.data)}</td>
      ${withDeck ? `<td>${esc(title(r.mazzo))}</td>` : ''}
      <td><span class="pill ${pctClass(r.percentuale)}">${r.punti}/${r.totale}</span></td>
      <td>${fmtDur(r.durata || 0)}</td></tr>`).join('')}</tbody></table></div>`;
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

  render(`${header(d.titolo, d.cartella ? `#/cartella/${encPath(d.cartella)}` : '#/')}
  <main>
    <section class="card hero">
      <span class="badge">${typeLabel(deck.type)}</span>
      <h2>${esc(d.titolo)}</h2>
      ${deck.description ? `<p>${md(deck.description, path)}</p>` : ''}
      <div class="stats">
        <div><b>${n}</b><small>${isQuiz ? 'domande' : 'carte'}</small></div>
        <div><b>${results.length}</b><small>tentativi</small></div>
        <div><b>${best >= 0 ? best + '%' : '–'}</b><small>migliore</small></div>
        <div><b>${results[0] ? results[0].percentuale + '%' : '–'}</b><small>ultimo</small></div>
      </div>
      ${deck.errors.length ? `<div class="error small">Problemi nel file:<br>${deck.errors.map(esc).join('<br>')}</div>` : ''}
      <form id="start" class="options">
        <label>Quante ${isQuiz ? 'domande' : 'carte'}
          <select name="count">${counts.map((c) => `<option value="${c}">${c}</option>`).join('')}<option value="${n}" selected>Tutte (${n})</option></select>
        </label>
        <label class="check"><input type="checkbox" name="shuffle" ${deck.shuffle ? 'checked' : ''}> Ordine casuale</label>
        ${!isQuiz ? '<label class="check"><input type="checkbox" name="reverse"> Inverti fronte/retro</label>' : ''}
        <button class="btn primary big" type="submit">▶ Inizia</button>
      </form>
    </section>
    ${results.length ? `<h2>Storico</h2>${resultsTable(results.slice(0, 20), false)}` : ''}
  </main>`);

  document.getElementById('start').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    let items = deck.items.filter((it) => (isQuiz ? it.kind : it.q && it.a));
    if (f.get('shuffle')) items = shuffle(items);
    items = items.slice(0, Number(f.get('count')));
    startSession(d, deck, items, { reverse: !!f.get('reverse'), shuffle: !!f.get('shuffle'), record: true });
  });
}

// ---------- sessioni ----------
function startSession(d, deck, items, opts) {
  session = { d, deck, items, opts, start: Date.now(), onKey: null };
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
  return `<div class="progress"><div style="width:${total ? (done / total) * 100 : 0}%"></div></div>`;
}

// ----- flashcard -----
function runFlashcards() {
  const s = session;
  s.queue = s.items.map((it, i) => ({ it, i }));
  s.firstTry = new Map(); // indice -> true/false (sapevo al primo colpo?)
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

  render(`${header(s.d.titolo, `#/mazzo/${encPath(s.d.path)}`)}
  <main class="play">
    ${progress(done, s.total)}
    <p class="muted center small">${done}/${s.total} completate · ${known} sapute al primo colpo${s.queue.length > s.total - done ? ` · ${s.queue.length} in coda` : ''}</p>
    <div class="flip" id="flip" tabindex="0" role="button" aria-label="Gira la carta">
      <div class="flip-inner">
        <div class="face front"><div class="face-content">${md(front, s.d.path)}</div><small class="hint">Tocca per girare</small></div>
        <div class="face back"><div class="face-content">${md(back, s.d.path)}</div></div>
      </div>
    </div>
    <div class="actions" id="actions" hidden>
      <button class="btn bad" id="no">✗ Da ripassare</button>
      <button class="btn good" id="yes">✓ La sapevo</button>
    </div>
    <div class="actions" id="reveal-wrap"><button class="btn primary" id="reveal">Mostra risposta</button></div>
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
  const hint = it.kind === 'multi' ? 'Seleziona tutte le risposte corrette' : it.kind === 'open' ? 'Scrivi la risposta' : '';

  render(`${header(s.d.titolo, `#/mazzo/${encPath(s.d.path)}`)}
  <main class="play">
    ${progress(s.idx, s.items.length)}
    <p class="muted center small">Domanda ${s.idx + 1} di ${s.items.length} · ${correctSoFar} corrette</p>
    <section class="card question">
      <div class="q-text">${md(it.q, s.d.path)}</div>
      ${hint ? `<p class="muted small">${hint}</p>` : ''}
      ${it.kind === 'open'
    ? `<form id="open"><input class="answer" name="a" autocomplete="off" autocapitalize="off" placeholder="La tua risposta"></form>`
    : `<div class="choices">${it.shown.map((o, i) => `<button class="choice" data-i="${i}"><span class="key">${String.fromCharCode(65 + i)}</span><span>${md(o.text, s.d.path)}</span></button>`).join('')}</div>`}
      <div id="feedback"></div>
    </section>
    <div class="actions">
      ${it.kind !== 'single' ? '<button class="btn primary" id="check">Verifica</button>' : ''}
      <button class="btn primary" id="next" hidden>${s.idx + 1 < s.items.length ? 'Avanti →' : 'Vedi risultato'}</button>
    </div>
  </main>`);

  const $choices = [...document.querySelectorAll('.choice')];
  const $check = document.getElementById('check');
  const $next = document.getElementById('next');
  let checked = false;

  const check = () => {
    if (checked) return;
    let ok;
    let given;
    if (it.kind === 'open') {
      const v = document.querySelector('.answer').value;
      if (!v.trim()) return;
      given = v;
      ok = it.accepted.some((a) => normalizeAnswer(a) === normalizeAnswer(v));
      document.querySelector('.answer').classList.add(ok ? 'right' : 'wrong');
      document.querySelector('.answer').readOnly = true;
    } else {
      const sel = $choices.filter((c) => c.classList.contains('selected')).map((c) => Number(c.dataset.i));
      if (!sel.length) return;
      given = sel.map((i) => it.shown[i].text).join(', ');
      ok = it.shown.every((o, i) => o.correct === sel.includes(i));
      $choices.forEach((c, i) => {
        c.disabled = true;
        if (it.shown[i].correct) c.classList.add('right');
        else if (sel.includes(i)) c.classList.add('wrong');
      });
    }
    checked = true;
    s.answers.push({ it, ok, given });
    const correctText = it.kind === 'open' ? it.accepted[0] : it.shown.filter((o) => o.correct).map((o) => o.text).join(' · ');
    document.getElementById('feedback').innerHTML = `<div class="feedback ${ok ? 'good' : 'bad'}">
      <strong>${ok ? '✓ Corretto!' : '✗ Sbagliato'}</strong>
      ${!ok && it.kind === 'open' ? `<div>Risposta: ${md(correctText, s.d.path)}</div>` : ''}
      ${it.e ? `<div class="expl">${md(it.e, s.d.path)}</div>` : ''}
    </div>`;
    if ($check) $check.hidden = true;
    $next.hidden = false;
    $next.focus();
  };
  const next = () => { if (checked) { s.idx++; showQuestion(); } };

  $choices.forEach((c) => c.addEventListener('click', () => {
    if (checked) return;
    if (it.kind === 'single') { c.classList.add('selected'); check(); } else c.classList.toggle('selected');
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
async function finish() {
  const s = session;
  setKeys(null);
  const isQuiz = s.deck.type === 'quiz';
  const durata = Math.round((Date.now() - s.start) / 1000);
  const punti = isQuiz ? s.answers.filter((a) => a.ok).length : [...s.firstTry.values()].filter(Boolean).length;
  const totale = isQuiz ? s.answers.length : s.total;
  const pct = totale ? Math.round((punti / totale) * 100) : 0;
  const wrongItems = isQuiz ? s.answers.filter((a) => !a.ok).map((a) => a.it) : s.items.filter((_, i) => !s.firstTry.get(i));

  let syncMsg = '';
  if (s.opts.record) {
    scores.addResult(s.d, { punti, totale, durata });
    syncMsg = scores.getSettings().token ? '<span id="sync">Salvataggio nel repository…</span>' : 'Punteggio salvato su questo dispositivo. <a href="#/impostazioni">Configura GitHub</a> per salvarlo nel repository.';
  } else {
    syncMsg = 'Ripasso degli errori: il punteggio non viene registrato.';
  }

  const d = s.d;
  const deck = s.deck;
  const opts = s.opts;
  render(`${header(d.titolo, `#/mazzo/${encPath(d.path)}`)}
  <main>
    <section class="card hero center">
      <div class="score ${pctClass(pct)}">${pct}%</div>
      <p><strong>${punti}/${totale}</strong> ${isQuiz ? 'risposte corrette' : 'carte sapute al primo colpo'} · ${fmtDur(durata)}</p>
      <p class="muted small">${syncMsg}</p>
      <div class="actions col">
        ${wrongItems.length ? '<button class="btn primary" id="retry-wrong">Ripassa solo gli errori</button>' : ''}
        <button class="btn" id="retry">Ricomincia</button>
        <a class="btn" href="#/mazzo/${encPath(d.path)}">Torna al mazzo</a>
      </div>
    </section>
    ${isQuiz && wrongItems.length ? `<h2>Da rivedere</h2>${s.answers.filter((a) => !a.ok).map((a) => `
      <div class="card review">
        <div class="q-text">${md(a.it.q, d.path)}</div>
        <p class="small"><span class="bad-text">Tua risposta:</span> ${md(a.given, d.path)}</p>
        <p class="small"><span class="good-text">Corretta:</span> ${md(a.it.kind === 'open' ? a.it.accepted[0] : a.it.options.filter((o) => o.correct).map((o) => o.text).join(' · '), d.path)}</p>
        ${a.it.e ? `<p class="small muted">${md(a.it.e, d.path)}</p>` : ''}
      </div>`).join('')}` : ''}
  </main>`);
  stopSession();

  document.getElementById('retry-wrong')?.addEventListener('click', () => startSession(d, deck, shuffle(wrongItems), { ...opts, record: false }));
  document.getElementById('retry').addEventListener('click', () => {
    const items = deck.items.filter((it) => (deck.type === 'quiz' ? it.kind : it.q && it.a));
    startSession(d, deck, (opts.shuffle ? shuffle(items) : items).slice(0, totale), { ...opts, record: true });
  });

  if (opts.record && scores.getSettings().token) {
    const r = await scores.syncAll();
    const $s = document.getElementById('sync');
    if ($s) $s.textContent = r.ok ? 'Punteggio salvato nel repository ✓' : `Salvato solo su questo dispositivo (errore: ${r.errore}). Riproverà alla prossima sincronizzazione.`;
  }
}

// ---------- impostazioni ----------
function viewSettings() {
  const s = scores.getSettings();
  const pending = scores.unsynced().length;
  render(`${header('Impostazioni', '#/')}
  <main>
    <section class="card">
      <h2>Salvataggio punteggi su GitHub</h2>
      <p class="small muted">I punteggi vengono sempre salvati nel browser. Inserendo un token GitHub vengono anche scritti
        nel file <code>punteggi.json</code> della cartella di ogni mazzo, così restano nel repository e si vedono da tutti i dispositivi.</p>
      <p class="small muted">Crea un <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>
        con accesso solo a questo repository e permesso <b>Contents: Read and write</b>. Il token resta salvato solo in questo browser.</p>
      <form id="gh" class="options">
        <label>Utente / organizzazione<input name="owner" value="${esc(s.owner)}" autocapitalize="off" required></label>
        <label>Repository<input name="repo" value="${esc(s.repo)}" autocapitalize="off" required></label>
        <label>Branch<input name="branch" value="${esc(s.branch)}" autocapitalize="off" required></label>
        <label>Token<input name="token" type="password" value="${esc(s.token)}" autocomplete="off" placeholder="github_pat_…"></label>
        <div class="actions">
          <button class="btn primary" type="submit">Salva</button>
          <button class="btn" type="button" id="test">Prova connessione</button>
        </div>
      </form>
      <p id="gh-msg" class="small"></p>
    </section>
    <section class="card">
      <h2>Sincronizzazione</h2>
      <p class="small">${pending ? `${pending} punteggi non ancora salvati nel repository.` : 'Tutti i punteggi sono sincronizzati.'}</p>
      <button class="btn" id="sync-now" ${pending ? '' : 'disabled'}>Sincronizza ora</button>
      <p id="sync-msg" class="small"></p>
    </section>
  </main>`);

  const read = () => Object.fromEntries(new FormData(document.getElementById('gh')));
  const msg = (id, t, ok) => { const el = document.getElementById(id); el.textContent = t; el.className = `small ${ok ? 'good-text' : 'bad-text'}`; };
  document.getElementById('gh').addEventListener('submit', (e) => {
    e.preventDefault();
    scores.saveSettings(read());
    msg('gh-msg', 'Salvato ✓', true);
  });
  document.getElementById('test').addEventListener('click', async () => {
    try { msg('gh-msg', `Connesso a ${await scores.testConnection(read())} ✓`, true); } catch (e) { msg('gh-msg', `Errore: ${e.message}`, false); }
  });
  document.getElementById('sync-now').addEventListener('click', async () => {
    scores.saveSettings(read());
    const r = await scores.syncAll();
    msg('sync-msg', r.ok ? `${r.inviati} punteggi inviati ✓` : `Errore: ${r.errore}`, r.ok);
  });
}

route();
