<img src="icon.svg" width="88" alt="">

# Flash Now

🇮🇹 [Versione italiana](README.it.md)

A static site for studying with **flashcards** and **quizzes**, published on GitHub Pages and designed for phones.

**Live site:** <https://m1ke324.github.io/flash-now/>

- Decks are plain text files in `decks/`, organised in folders and subfolders.
- On launch the site shows a menu of folders and decks, with search.
- Scores are saved in a `punteggi.json` file inside each folder, in this same repository.
- It can be added to the phone's home screen like an app.
- **Weak spots** mode (*Punti deboli*): shows you the questions and cards you get wrong most often, more often.
- Light and dark theme, inspired by Google's Material 3.

## Weak spots mode

The site records the outcome of every single question (in `punteggi.json`, alongside the score).
On a deck page, choosing **Punti deboli** builds the session from:

1. the questions you get wrong most often (relative to attempts);
2. the ones you haven't reviewed for a while, using a Leitner box system: each correct answer
   lengthens the interval before the next review (1, 2, 4, 8, 16 days), each mistake resets it;
3. the ones you have never seen.

During the session a wrong question comes back at the end (flashcards come back after a few cards), but only the first attempt counts toward the score.
The deck page also lists the questions you miss most often.

> The interface and the deck format use Italian keywords (`D:` = question, `R:` = answer, `S:` = explanation).
> English aliases are accepted too: `Q:`, `A:`, `E:`.

## Quick guide

**Create flashcards with AI (in the app or on the site)**
1. On the home screen tap **Nuovo mazzo** (new deck), pick *Flashcard* or *Quiz*.
2. Tap **Istruzioni per l'AI** (AI instructions): they are copied.
3. In ChatGPT, Claude or Gemini paste the instructions, add your notes below and send.
4. Copy the answer, go back to the editor, tap **Incolla** (paste, replaces the example) and then **Salva** (save).

The box under the editor turns green when the format is right, red with a line number when something is wrong.

**Study**: tap the card to flip it (flashcards) or tap an answer (quiz). **Punti deboli** (weak spots) shows what you miss most first.

**Organise**: **long-press** a deck or folder to rename, move, export or delete it. Items with a cloud are online: you can copy them to the device or hide them. **Seleziona** (select) moves or deletes several decks at once.

**Updates**: when a new version is out, the app shows it on the home screen and downloads it with **Aggiorna** (update).

**Advanced mode** (Settings): syncs scores to the repository with a GitHub token. Not needed for normal use.

**Keep your decks**: **Esporta** (export) saves a deck (.md) or a folder (.zip), **Importa file** (import) loads them back. Do it now and then as a backup.

The same guide is in the app, under the **?** icon.

## Creating flashcards and quizzes with AI (in the repository)

The intended workflow: **you write the notes, an AI assistant turns them into a deck**.

The repository contains everything an assistant needs to do this without extra explanation:

- [`FORMATO.md`](FORMATO.md) — the deck format specification (Italian);
- [`CLAUDE.md`](CLAUDE.md) — instructions for the assistant: where to put files, when to choose flashcards or a quiz, how to write questions and wrong options, how to validate the result.

### With Claude Code (recommended)

Open a terminal in the repository folder, run `claude` and paste your notes (or point it to a file or PDF):

```
These are my biology notes about the cell.
Make 20 flashcards and a 15-question quiz in the biologia/cellula folder.

<notes>
```

Claude reads `CLAUDE.md` automatically, creates the `.md` files, runs the format check and, if you ask, commits and pushes. About a minute later the deck is live.

Other useful requests:

- "Add 10 questions to the quiz `decks/storia/rivoluzione-francese.md` from these notes"
- "Look at my scores in `decks/fisica/punteggi.json` and make a deck on the topics I get wrong most"
- "Turn these flashcards into a multiple-choice quiz"

### With another assistant (ChatGPT, Gemini, Claude.ai…)

Give the assistant the contents of `FORMATO.md` together with your notes and ask for a file in that format. Then create the file on GitHub (**Add file → Create new file** at `decks/<folder>/name.md`) and paste the result. If the format is wrong, publishing stops and the error (with its line number) shows up in the **Actions** tab.

## The format at a glance

Full specification in **[FORMATO.md](FORMATO.md)**.

```
---
titolo: Biology – the cell
tipo: quiz
---

Q: Where does cellular respiration happen?
- [ ] In the nucleus
- [x] In the mitochondria
- [ ] In the ribosomes
E: Mitochondria produce ATP.

Q: Chemical symbol for sodium?
A: Na
```

Flashcards (`tipo: flashcard`): `Q:` front, `A:` back. Quizzes (`tipo: quiz`): options `- [ ]` / `- [x]` (one or more correct), or an open answer with `A:` (alternatives separated by `|`).

## How the site was built with AI

The site itself was written by [Claude Code](https://claude.com/claude-code) from a plain-language request: "a GitHub Pages site for quizzes and flashcards that works on mobile, with a documented format, folders, and scores saved in the repository". The main decisions:

- **No build step, no dependencies**: HTML, CSS and JavaScript modules served as-is. Edit any file and the site is updated.
- **Line-based Markdown format** instead of JSON: readable on GitHub, easy to write by hand and easy for a language model to generate.
- **One parser** (`js/parser.js`) used by both the browser and the validation script, so whatever passes validation is exactly what the site shows.
- **Index generated by a GitHub Action**: a static site cannot list folders, so on every push `scripts/build-manifest.mjs` builds `decks.json`.
- **Scores through the GitHub API**: GitHub Pages cannot write files, so the site uses a personal token to commit `punteggi.json`.
- **Design** inspired by Material 3, refined by reviewing screenshots of the site taken with a headless browser.

To change the site with AI, just ask in this folder ("add a timed exam mode", "change the main colour"): `CLAUDE.md` also describes the code structure.

## Android app (APK)

Download the APK from [Releases](https://github.com/M1ke324/flash-now/releases/latest), open it on your phone and allow installs from that source when Android asks.

The app (`android/` folder) bundles the site and **works offline, without any repository**:

- **Sul dispositivo** (on this device): your own folders and decks, stored only on the phone. Create folders, import `.md` files, write a deck in the editor or paste one generated by an AI (the *Copia le istruzioni per l'AI* button copies a prompt describing the format). Their scores stay on the device.
- **Online decks** (optional, can be turned off in Settings): the decks of this repository, downloaded when online and cached for offline use. Newly published decks show up without updating the APK.

The *Sul dispositivo* library is available on the website too, in the browser.

**Releasing a new version:** create a tag and push it.

```sh
git tag v1.0.0 && git push origin v1.0.0
```

The `.github/workflows/android.yml` Action builds the APK, signs it and creates a Release with the file attached.
Signing uses a key stored in the repository secrets, created once with `scripts/android-keystore.sh`.
Keep the key safe (`~/.android-keys/`): Android only accepts an update signed with the same key.

## Saving scores to the repository

1. Go to <https://github.com/settings/personal-access-tokens/new> (fine-grained token).
2. **Repository access → Only select repositories** → pick this repository.
3. **Permissions → Repository permissions → Contents: Read and write**.
4. Paste the token in the site under **⚙︎ Impostazioni** (Settings). Owner and repository are detected automatically.

Scores are always saved **on the device first** (browser or app); syncing with GitHub is optional.
The token is stored only on that device. With a token set up, sync with **Sincronizza ora** (Sync now; the home screen shows how many sessions are pending), or turn on **Sincronizza dopo ogni sessione** (sync after every session). Each sync is a commit to `decks/<folder>/punteggi.json`.

> This repository is public, so decks and scores are public too.

## Publishing

On every push to `main`, the `.github/workflows/pages.yml` Action validates the decks, generates `decks.json` and deploys the site (under **Settings → Pages** the source must be **GitHub Actions**).

## Running locally

```sh
npm run serve        # builds decks.json and serves http://localhost:8000 (needs Python)
npm run check        # validates deck format only
```

## Structure

```
index.html, style.css       interface
js/app.js                   menu, flashcards, quiz, settings
js/parser.js                deck format parser
js/scores.js                scores (browser + GitHub)
scripts/build-manifest.mjs  builds decks.json and validates decks
decks/                      the decks (and punteggi.json files)
android/                    Android app (WebView wrapper around the site)
FORMATO.md                  format specification
CLAUDE.md                   instructions for the AI assistant
```

## Author

Flash Now was conceived and created by **Michele Castrucci**.
Feedback and ideas: use the **Invia un feedback** (send feedback) page in the app (guide → Informazioni) or open an [issue](https://github.com/M1ke324/flash-now/issues).
