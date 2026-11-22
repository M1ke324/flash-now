<img src="icon.svg" width="88" alt="">

# Flash Now

🇬🇧 [English version](README.md)

Sito statico per ripassare con **flashcard** e **quiz**, pubblicato su GitHub Pages e pensato per il telefono.

**Sito:** <https://m1ke324.github.io/flash-now/>

- I mazzi sono file di testo in `decks/`, organizzati in cartelle e sottocartelle.
- All'avvio il sito mostra il menu delle cartelle e dei mazzi, con la ricerca.
- I punteggi vengono salvati nel file `punteggi.json` di ogni cartella, nel repository stesso.
- Si può aggiungere alla schermata Home del telefono come un'app.
- Modalità **Punti deboli**: ripropone più spesso le domande e le carte che sbagli di più.
- Tema chiaro e scuro in stile Material 3.

## Modalità "Punti deboli"

Il sito registra l'esito di ogni singola domanda (nel `punteggi.json`, insieme al punteggio).
Nella pagina di un mazzo, scegliendo **Punti deboli**, la sessione prende per prime:

1. le domande che sbagli più spesso (in proporzione ai tentativi);
2. quelle che non ripassi da tempo, con un sistema a scatole (Leitner): ogni risposta giusta
   allunga l'intervallo prima del ripasso successivo (1, 2, 4, 8, 16 giorni), ogni errore lo azzera;
3. quelle mai viste.

Durante la sessione, una domanda sbagliata torna alla fine (le flashcard tornano dopo qualche carta), ma il punteggio conta solo il primo tentativo.
La pagina del mazzo mostra anche l'elenco delle domande che sbagli più spesso.

## Guida rapida

**Crea flashcard con l'AI (dall'app o dal sito)**
1. Apri **Sul dispositivo** → **Nuovo mazzo**, scegli *Flashcard* o *Quiz*.
2. Tocca **Istruzioni per l'AI**: vengono copiate.
3. In ChatGPT, Claude o Gemini incolla le istruzioni, aggiungi sotto i tuoi appunti e invia.
4. Copia la risposta, torna all'editor, tocca **Incolla** (sostituisce l'esempio) e poi **Salva**.

Il riquadro sotto l'editor è verde se il formato è giusto, rosso con il numero di riga se c'è un errore.

**Studia**: tocca la carta per girarla (flashcard) o la risposta (quiz). **Punti deboli** ripropone prima quello che sbagli di più.

**Organizza**: nella pagina di un mazzo trovi **Sposta** ed **Elimina**; in una cartella, **Seleziona** permette di spostare o eliminare più mazzi insieme.

**Conserva**: **Esporta** salva un mazzo (.md) o una cartella (.zip), **Importa file** li ricarica. Fallo ogni tanto come backup.

La stessa guida è nell'app, sotto l'icona **?**.

## Creare flashcard e quiz con l'AI (nel repository)

Il flusso pensato è: **tu scrivi gli appunti, l'AI li trasforma in un mazzo**.

Il repository contiene tutto quello che serve a un assistente AI per lavorare senza spiegazioni:

- [`FORMATO.md`](FORMATO.md) — la specifica del formato dei mazzi;
- [`CLAUDE.md`](CLAUDE.md) — le istruzioni per l'assistente: dove mettere i file, come scegliere tra flashcard e quiz, come scrivere domande e distrattori, come verificare il risultato.

### Con Claude Code (consigliato)

Apri un terminale nella cartella del repository, avvia `claude` e incolla gli appunti (o indica un file / PDF):

```
Questi sono i miei appunti di Biologia sulla cellula.
Fammi 20 flashcard e un quiz da 15 domande, nella cartella biologia/cellula.

<appunti>
```

Claude legge `CLAUDE.md` in automatico, crea i file `.md`, esegue la verifica del formato e, se glielo chiedi, fa commit e push. Dopo circa un minuto il mazzo è sul sito.

Altre richieste utili:

- "Aggiungi 10 domande al quiz `decks/storia/rivoluzione-francese.md` usando questi appunti"
- "Guarda i miei punteggi in `decks/fisica/punteggi.json` e fammi un mazzo solo sugli argomenti dove sbaglio di più"
- "Trasforma queste flashcard in un quiz a scelta multipla"

### Con un altro assistente (ChatGPT, Gemini, Claude.ai…)

Dai all'assistente il contenuto di `FORMATO.md` insieme agli appunti e chiedi un file nel formato descritto. Poi crea il file su GitHub (**Add file → Create new file** in `decks/<cartella>/nome.md`) e incollaci il risultato. Se il formato è sbagliato, la pubblicazione si ferma e l'errore (con il numero di riga) si vede nella scheda **Actions**.

## Il formato in breve

Spiegato per intero in **[FORMATO.md](FORMATO.md)**.

```
---
titolo: Biologia – la cellula
tipo: quiz
---

D: Dove avviene la respirazione cellulare?
- [ ] Nel nucleo
- [x] Nei mitocondri
- [ ] Nei ribosomi
S: I mitocondri producono ATP.

D: Simbolo chimico del sodio?
R: Na
```

Flashcard: `D:` fronte, `R:` retro. Quiz: opzioni `- [ ]` / `- [x]` (una o più corrette) oppure risposta aperta con `R:`.

## Come è stato costruito il sito con l'AI

Il sito stesso è stato scritto da [Claude Code](https://claude.com/claude-code) a partire da una richiesta in linguaggio naturale: "un sito su GitHub Pages per quiz e flashcard, che funzioni sul telefono, con un formato documentato, cartelle e punteggi salvati nel repository". Le scelte principali:

- **Niente build né dipendenze**: HTML, CSS e moduli JavaScript serviti così come sono. Si modifica qualsiasi file e il sito è aggiornato.
- **Formato in Markdown a righe** invece di JSON: si legge su GitHub, si scrive a mano ed è facile da generare per un modello linguistico.
- **Un solo parser** (`js/parser.js`) usato sia dal browser sia dallo script di verifica, così ciò che passa la verifica è esattamente ciò che il sito mostra.
- **Indice generato da una GitHub Action**: un sito statico non può elencare le cartelle, quindi a ogni push `scripts/build-manifest.mjs` crea `decks.json`.
- **Punteggi via API di GitHub**: GitHub Pages non può scrivere file, quindi il sito usa un token personale per fare commit di `punteggi.json`.
- **Grafica** ispirata a Material 3 di Google, rifinita controllando screenshot del sito generati con un browser headless.

Per modificare il sito con l'AI basta chiederlo in questa cartella ("aggiungi una modalità esame a tempo", "cambia il colore principale"): `CLAUDE.md` descrive anche la struttura del codice.

## App Android (APK)

L'APK si scarica dalle [Release](https://github.com/M1ke324/flash-now/releases/latest): aprilo dal telefono e consenti l'installazione da quella fonte quando Android lo chiede.

L'app (cartella `android/`) contiene il sito e **funziona senza connessione e senza repository**:

- **Sul dispositivo**: cartelle e mazzi tuoi, salvati solo nel telefono. Puoi creare cartelle, importare file `.md`, scrivere un mazzo nell'editor o incollare quello generato da un'AI (il pulsante *Copia le istruzioni per l'AI* copia il prompt con il formato). I loro punteggi restano sul dispositivo.
- **Mazzi online** (facoltativi, si spengono in Impostazioni): i mazzi di questo repository, scaricati quando c'è connessione e conservati per l'uso offline. I nuovi mazzi pubblicati compaiono senza aggiornare l'APK.

La libreria *Sul dispositivo* esiste anche nel sito, nel browser.

**Pubblicare una nuova versione:** crea un tag e fai push.

```sh
git tag v1.0.0 && git push origin v1.0.0
```

La Action `.github/workflows/android.yml` compila l'APK, lo firma e crea la Release con il file allegato.
La firma usa una chiave salvata nei secret del repository, creata una sola volta con `scripts/android-keystore.sh`.
Conserva la chiave (`~/.android-keys/`): Android accetta un aggiornamento solo se è firmato con la stessa chiave.

## Salvare i punteggi nel repository

1. Vai su <https://github.com/settings/personal-access-tokens/new> (fine-grained token).
2. **Repository access → Only select repositories** → scegli questo repository.
3. **Permissions → Repository permissions → Contents: Read and write**.
4. Incolla il token nel sito, in **⚙︎ Impostazioni** (utente e repository vengono riconosciuti in automatico).

I punteggi vengono sempre salvati **prima di tutto sul dispositivo** (nel browser o nell'app); la sincronizzazione con GitHub è facoltativa.
Il token resta salvato solo su quel dispositivo. Con il token configurato sincronizzi con **Sincronizza ora** (la home mostra quante sessioni sono in attesa), oppure attivi **Sincronizza dopo ogni sessione**. Ogni sincronizzazione è un commit su `decks/<cartella>/punteggi.json`.

> Il repository è pubblico: anche mazzi e punteggi sono pubblici.

## Pubblicazione

A ogni push su `main` la Action `.github/workflows/pages.yml` verifica i mazzi, genera `decks.json` e pubblica il sito (in **Settings → Pages** la sorgente deve essere **GitHub Actions**).

## Provare in locale

```sh
npm run serve        # genera decks.json e avvia http://localhost:8000 (serve Python)
npm run check        # verifica solo il formato dei mazzi
```

## Struttura

```
index.html, style.css       interfaccia
js/app.js                   menu, flashcard, quiz, impostazioni
js/parser.js                lettura del formato dei mazzi
js/scores.js                punteggi (browser + GitHub)
scripts/build-manifest.mjs  genera decks.json e verifica i mazzi
decks/                      i mazzi (e i punteggi.json)
android/                    app Android (contenitore WebView del sito)
FORMATO.md                  specifica del formato
CLAUDE.md                   istruzioni per l'assistente AI
```
