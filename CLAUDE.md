# Istruzioni per Claude

Sito statico (GitHub Pages) per quiz e flashcard. Niente build, niente dipendenze: HTML + JS moduli.

## Quando l'utente fornisce appunti da trasformare in flashcard o quiz

1. Leggi `FORMATO.md`: è la specifica del formato dei mazzi.
2. Crea il file `.md` in `decks/<materia>/[<argomento>/]nome-mazzo.md`
   (nomi di file e cartelle in minuscolo, con trattini, senza spazi né accenti).
   Riusa le cartelle esistenti se l'argomento c'è già (`ls -R decks`).
3. Scegli il tipo in base alla richiesta. Se non specificato: definizioni/concetti → flashcard,
   verifica di comprensione → quiz. Per un quiz preferisci scelta singola con 3-4 opzioni plausibili,
   aggiungi `S:` con una spiegazione breve, usa le risposte aperte solo per risposte corte e univoche.
4. Resta fedele agli appunti: non inventare fatti che non ci sono. Domande atomiche, una idea per carta.
5. Esegui `node scripts/build-manifest.mjs --check` e correggi gli errori.
6. Non toccare i file `punteggi.json`: li scrive il sito.
7. Quando modifichi un mazzo esistente non riscrivere il testo delle domande senza motivo:
   l'identificativo di una domanda è l'hash del testo, e cambiarlo azzera la sua storia
   (usata dalla modalità "Punti deboli").

## Struttura

- `js/parser.js` — parser del formato (condiviso browser/Node)
- `js/app.js` — interfaccia (router a hash: `#/cartella/…`, `#/mazzo/…`, `#/impostazioni`)
- `js/scores.js` — punteggi: localStorage + scrittura su `punteggi.json` via API GitHub
- `js/library.js` — mazzi "Sul dispositivo" (localStorage, id che iniziano con `~`)
- `js/env.js` — web o app Android, mazzi online con cache offline
- `js/files.js` — zip (creazione/lettura) e salvataggio file; nell'app passa dal canale nativo `FlashNowAndroid`
- `fonts/` — font e icone ospitati qui (offline). Per usare una nuova icona Material aggiungila in `scripts/icone.sh` e rilancialo
- `android/` — app Android: WebView che serve il sito dagli asset (copiati dal task Gradle `copyWeb`); release con un tag `v*`
- `scripts/build-manifest.mjs` — genera `decks.json` (non versionato, lo genera la GitHub Action)
- `.github/workflows/pages.yml` — verifica e pubblica a ogni push su `main`

Prova locale: `npm run serve` e apri http://localhost:8000
