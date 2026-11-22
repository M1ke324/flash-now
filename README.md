# Studio · Quiz e Flashcard

Sito statico per ripassare con **flashcard** e **quiz**, pensato per GitHub Pages e per il telefono.

- I mazzi sono file di testo in `decks/`, organizzati in cartelle e sottocartelle.
- All'avvio il sito mostra il menu delle cartelle e dei mazzi; c'è anche la ricerca.
- I punteggi vengono salvati nel file `punteggi.json` di ogni cartella, nel repository stesso.
- Si può aggiungere alla schermata Home del telefono come un'app.

Il formato dei mazzi è spiegato in **[FORMATO.md](FORMATO.md)**. In breve:

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
```

## Aggiungere materiale

**Con Claude:** dai gli appunti e chiedi "fammi delle flashcard / un quiz su questi appunti".
Le istruzioni per Claude sono in [CLAUDE.md](CLAUDE.md): il mazzo viene creato nella cartella giusta e verificato.

**A mano:** crea un file `.md` in `decks/<cartella>/` (anche dall'editor web di GitHub) e fai commit.
Dopo circa un minuto il sito è aggiornato.

## Pubblicazione su GitHub Pages (una volta sola)

1. Crea il repository su GitHub e fai push di questa cartella sul branch `main`.
2. Sul repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. A ogni push la Action `.github/workflows/pages.yml` verifica i mazzi, genera l'indice
   `decks.json` e pubblica il sito su `https://<utente>.github.io/<repository>/`.

Se un mazzo contiene errori di formato la pubblicazione si ferma: l'errore si vede nella scheda **Actions**.

## Salvare i punteggi nel repository

Un sito su GitHub Pages non può scrivere file da solo, quindi lo fa tramite l'API di GitHub con un token personale:

1. Vai su <https://github.com/settings/personal-access-tokens/new> (fine-grained token).
2. **Repository access → Only select repositories** → scegli questo repository.
3. **Permissions → Repository permissions → Contents: Read and write**.
4. Copia il token e incollalo nel sito in **⚙︎ Impostazioni** (utente e repository vengono riconosciuti in automatico).

Il token resta salvato solo nel browser di quel dispositivo (va inserito su ogni dispositivo).
Senza token i punteggi restano comunque salvati nel browser; quando poi configuri il token,
**Sincronizza ora** invia quelli arretrati.

Ogni salvataggio è un commit sul file `decks/<cartella>/punteggi.json` e fa ripartire la pubblicazione:
i punteggi appena fatti si vedono subito sul dispositivo che li ha registrati e sugli altri dopo circa un minuto.

> Se il repository è pubblico, anche i punteggi e i mazzi sono pubblici.
> Con un repository privato GitHub Pages richiede un piano a pagamento.

## Provare in locale

Serve Node.js (per generare l'indice) e Python (solo per il server di prova):

```sh
npm run serve        # genera decks.json e avvia http://localhost:8000
npm run check        # verifica solo il formato dei mazzi
```

## Struttura

```
index.html, style.css     interfaccia
js/app.js                 menu, flashcard, quiz, impostazioni
js/parser.js              lettura del formato dei mazzi
js/scores.js              punteggi (browser + GitHub)
scripts/build-manifest.mjs  genera decks.json e verifica i mazzi
decks/                    i mazzi (e i punteggi.json)
```
