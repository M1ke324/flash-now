import { parseDeck, normalizeAnswer } from './parser.js';
import * as scores from './scores.js';

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
const folderName = (f) => (f ? f.split('/').pop().replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Studio');
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
    : `<div class="brand">${icon('school', 'fill')}</div><h1 class="title-l"></h1>`}
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

async function loadManifest() {
  if (manifest) return manifest;
  const r = await fetch('decks.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Manca decks.json. Generalo con "node scripts/build-manifest.mjs" e ricarica la pagina.');
  manifest = await r.json();
  return manifest;
}

async function loadDeck(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Non riesco a caricare ${path} (HTTP ${r.status}).`);
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
    render(`${appbar('Errore', '#/')}<main><div class="card error">${esc(e.message)}</div></main>`);
  }
}
window.addEventListener('hashchange', route);

// ---------- vista cartella ----------
async function viewFolder(folder) {
  const m = manifest;
  if (folder && !m.cartelle.includes(folder)) return go('#/');
  const parentOf = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');
  const subs = m.cartelle.filter((f) => f && parentOf(f) === folder);
  const decks = m.mazzi.filter((d) => d.cartella === folder);
  const countIn = (f) => m.mazzi.filter((d) => d.cartella === f || d.cartella.startsWith(f + '/')).length;

  const results = await scores.folderResults(folder);
  const lastOf = (d) => results.find((r) => r.mazzo === d.path);
  const back = folder ? (parentOf(folder) ? `#/cartella/${encPath(parentOf(folder))}` : '#/') : null;

  render(`${appbar(folderName(folder), back)}
  <main>
    ${!folder ? `<h2 class="home-title">Cosa ripassi oggi?</h2>
    <label class="searchbar">${icon('search')}<input type="search" id="search" placeholder="Cerca un mazzo" autocomplete="off" aria-label="Cerca un mazzo"></label>
    <div id="search-results" class="list"></div>` : ''}
    <div id="browse">
    ${subs.length ? `<div class="subhead title-s">Cartelle</div><div class="list">${subs.map((f) => `
      <a class="item state" href="#/cartella/${encPath(f)}">
        <span class="avatar folder">${icon('folder', 'fill')}</span>
        <span class="item-main"><span class="headline">${esc(folderName(f))}</span><span class="support">${countIn(f)} ${countIn(f) === 1 ? 'mazzo' : 'mazzi'}</span></span>
        ${icon('chevron_right', 'trail')}
      </a>`).join('')}</div>` : ''}
    ${decks.length ? `<div class="subhead title-s">Mazzi</div><div class="list">${decks.map((d) => deckItem(d, lastOf(d))).join('')}</div>` : ''}
    ${!subs.length && !decks.length ? `<div class="empty">${icon('folder')}<p>Questa cartella è vuota. Aggiungi un file .md in <code>decks/${esc(folder)}</code> per creare un mazzo.</p></div>` : ''}
    ${results.length ? `<div class="subhead title-s">Attività recente</div>${resultList(results.slice(0, 6), true)}` : ''}
    </div>
  </main>`);

  const $s = document.getElementById('search');
  if ($s) {
    $s.addEventListener('input', () => {
      const q = normalizeAnswer($s.value);
      const $r = document.getElementById('search-results');
      document.getElementById('browse').hidden = !!q;
      $r.innerHTML = q
        ? m.mazzi.filter((d) => normalizeAnswer(`${d.titolo} ${d.descrizione} ${d.cartella}`).includes(q)).map((d) => deckItem(d, null, true)).join('')
          || `<div class="empty">${icon('search')}<p>Nessun mazzo contiene “${esc($s.value)}”.</p></div>`
        : '';
    });
  }
}

function deckItem(d, last, showFolder = false) {
  return `<a class="item state" href="#/mazzo/${encPath(d.path)}">
    <span class="avatar ${d.tipo}">${icon(typeIcon(d.tipo))}</span>
    <span class="item-main"><span class="headline">${esc(d.titolo)}</span>
      <span class="support">${d.n} ${unit(d.tipo, d.n)}${showFolder && d.cartella ? ` in ${esc(d.cartella)}` : ''}</span></span>
    ${last ? `<span class="score-chip ${pctClass(last.percentuale)}">${last.percentuale}%</span>` : icon('chevron_right', 'trail')}
  </a>`;
}

function resultList(list, withDeck) {
  const title = (p) => manifest.mazzi.find((d) => d.path === p)?.titolo || p.split('/').pop();
  return `<div class="list">${list.map((r) => `
    <div class="item">
      <span class="score-chip ${pctClass(r.percentuale)}">${r.percentuale}%</span>
      <span class="item-main">
        <span class="headline">${withDeck ? esc(title(r.mazzo)) : `${r.punti} su ${r.totale}`}</span>
        <span class="support">${withDeck ? `${r.punti} su ${r.totale}, ` : ''}${fmtDur(r.durata || 0)}</span>
      </span>
      <span class="trail-text">${fmtDate(r.data)}</span>
    </div>`).join('')}</div>`;
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

  render(`${appbar(d.cartella ? folderName(d.cartella) : 'Studio', d.cartella ? `#/cartella/${encPath(d.cartella)}` : '#/')}
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
        <div class="field">
          <label for="count">${isQuiz ? 'Domande' : 'Carte'} per sessione</label>
          <select id="count" name="count">${counts.map((c) => `<option value="${c}">${c}</option>`).join('')}<option value="${n}" selected>Tutte (${n})</option></select>
          ${icon('arrow_drop_down')}
        </div>
        <label class="setting-row"><span>Ordine casuale</span><input class="switch" type="checkbox" name="shuffle" ${deck.shuffle ? 'checked' : ''}></label>
        ${!isQuiz ? '<label class="setting-row"><span>Mostra prima la risposta</span><input class="switch" type="checkbox" name="reverse"></label>' : ''}
        <button class="btn filled large" type="submit">${icon('play_arrow', 'fill')}Inizia</button>
      </form>
    </section>
    ${results.length ? `<div class="subhead title-s">Andamento</div>
      <div class="chart" aria-label="Percentuali degli ultimi ${chartData.length} tentativi">${chartData.map((r) => `<span class="${pctClass(r.percentuale)}" style="height:${Math.max(4, r.percentuale)}%" title="${r.percentuale}%"></span>`).join('')}</div>
      ${resultList(results.slice(0, 10), false)}` : ''}
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
    <div class="status body-m"><span>Domanda ${s.idx + 1} di ${s.items.length}</span><span>${correctSoFar} corrette</span></div>
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
    s.answers.push({ it, ok, given });
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
  const hasToken = !!scores.getSettings().token;

  if (s.opts.record) scores.addResult(s.d, { punti, totale, durata });

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
    const items = deck.items.filter((it) => (deck.type === 'quiz' ? it.kind : it.q && it.a));
    startSession(d, deck, (opts.shuffle ? shuffle(items) : items).slice(0, totale), { ...opts, record: true });
  });

  if (!opts.record) return;
  if (!hasToken) {
    snackbar('Punteggio salvato su questo dispositivo. Aggiungi un token GitHub nelle impostazioni per salvarlo nel repository.');
    return;
  }
  const r = await scores.syncAll();
  snackbar(r.ok ? 'Punteggio salvato nel repository' : `Punteggio salvato solo su questo dispositivo: ${r.errore}. Riprova da Impostazioni.`);
}

// ---------- impostazioni ----------
function viewSettings() {
  const s = scores.getSettings();
  const pending = scores.unsynced().length;
  const field = (name, label, value, extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" value="${esc(value)}" autocapitalize="off" autocomplete="off" spellcheck="false" ${extra}></div>`;
  render(`${appbar('Impostazioni', '#/')}
  <main>
    <section class="card">
      <h2 class="title-l">Salva i punteggi su GitHub</h2>
      <p class="body-m variant">I punteggi restano sempre in questo browser. Con un token GitHub vengono scritti anche in <code>punteggi.json</code>, nella cartella di ogni mazzo, e li vedi da tutti i dispositivi.</p>
      <p class="body-m variant">Crea un <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a> limitato a questo repository, con il permesso <strong>Contents: Read and write</strong>. Il token resta salvato solo in questo browser.</p>
      <form id="gh" class="settings-form">
        ${field('owner', 'Utente o organizzazione', s.owner, 'required')}
        ${field('repo', 'Repository', s.repo, 'required')}
        ${field('branch', 'Branch', s.branch, 'required')}
        ${field('token', 'Token', s.token, 'type="password" placeholder="github_pat_…"')}
        <div class="btn-row">
          <button class="btn outlined" type="button" id="test">Prova connessione</button>
          <button class="btn filled" type="submit">Salva</button>
        </div>
      </form>
    </section>
    <section class="card">
      <h2 class="title-l">Sincronizzazione</h2>
      <p class="body-m variant">${pending ? `${pending} ${pending === 1 ? 'punteggio non è ancora stato salvato' : 'punteggi non sono ancora stati salvati'} nel repository.` : 'Tutti i punteggi sono salvati nel repository.'}</p>
      <button class="btn tonal" id="sync-now" ${pending ? '' : 'disabled'}>${icon('sync')}Sincronizza ora</button>
    </section>
  </main>`);

  const read = () => Object.fromEntries(new FormData(document.getElementById('gh')));
  document.getElementById('gh').addEventListener('submit', (e) => {
    e.preventDefault();
    scores.saveSettings(read());
    snackbar('Impostazioni salvate');
  });
  document.getElementById('test').addEventListener('click', async () => {
    try { snackbar(`Connesso a ${await scores.testConnection(read())}`); } catch (e) { snackbar(`Connessione non riuscita: ${e.message}. Controlla utente, repository e token.`); }
  });
  document.getElementById('sync-now').addEventListener('click', async () => {
    scores.saveSettings(read());
    const r = await scores.syncAll();
    snackbar(r.ok ? `${r.inviati} ${r.inviati === 1 ? 'punteggio salvato' : 'punteggi salvati'} nel repository` : `Sincronizzazione non riuscita: ${r.errore}`);
    if (r.ok) viewSettings();
  });
}

route();
