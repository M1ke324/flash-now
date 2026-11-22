# Formato dei mazzi

Ogni mazzo (un insieme di flashcard **oppure** un quiz) è un file di testo `.md`
dentro la cartella `decks/`. Le sottocartelle di `decks/` diventano le cartelle
del menu del sito, a qualsiasi profondità.

Il formato è Markdown "a righe": si legge bene anche su GitHub e si scrive a mano senza strumenti.

## Struttura del file

```
---
titolo: Titolo del mazzo
tipo: flashcard            # oppure: quiz
descrizione: Testo facoltativo mostrato nella pagina del mazzo
mescola: si                # facoltativo: "no" per mantenere l'ordine del file
---

D: Prima domanda
R: Risposta
```

L'intestazione tra le due righe `---` è facoltativa. Se manca: `tipo` vale
`flashcard` e il titolo è il nome del file (`-` e `_` diventano spazi).

| Campo         | Valori                  | Default         |
|---------------|-------------------------|-----------------|
| `titolo`      | testo                   | nome del file   |
| `tipo`        | `flashcard` \| `quiz`   | `flashcard`     |
| `descrizione` | testo                   | vuota           |
| `mescola`     | `si` \| `no`            | `si`            |

## Marcatori

Ogni marcatore deve stare **a inizio riga** (colonna 0) e in **maiuscolo**.

| Marcatore         | Significato                         | Alias inglese |
|-------------------|-------------------------------------|---------------|
| `D:`              | inizia una nuova domanda / carta    | `Q:`          |
| `R:`              | risposta                            | `A:`          |
| `S:`              | spiegazione (mostrata dopo la risposta nei quiz) | `E:` |
| `- [ ]` testo     | opzione sbagliata (solo quiz)       |               |
| `- [x]` testo     | opzione corretta (solo quiz)        |               |

Regole:

- **Righe successive**: una riga senza marcatore continua il campo precedente
  (domanda, risposta, spiegazione o opzione). Così le risposte possono essere lunghe più righe.
- **Escape**: per iniziare una riga di testo con qualcosa che sembra un marcatore
  (es. `S: zolfo`), mettere uno spazio davanti: ` S: zolfo`. Lo spazio viene rimosso.
- Le righe che iniziano con `#` (titoli Markdown) vengono ignorate: servono solo a
  organizzare il file in sezioni.
- Tutto ciò che sta prima del primo `D:` viene ignorato (si possono scrivere note).
- Le righe vuote dentro un campo vengono mantenute come "a capo".

## Flashcard (`tipo: flashcard`)

Ogni carta ha fronte (`D:`) e retro (`R:`). Eventuali `S:` vengono ignorate.

```
D: Cos'è il mitocondrio?
R: L'organello che produce ATP
tramite la respirazione cellulare.
```

Nel sito: si tocca la carta per girarla e si risponde "La sapevo" / "Da ripassare".
Le carte da ripassare tornano dopo qualche carta, finché non vengono sapute.
**Punteggio** = carte sapute al primo tentativo / totale.

## Quiz (`tipo: quiz`)

Il tipo di domanda dipende da cosa contiene:

**Scelta singola** — opzioni con esattamente una `[x]`. Si risponde con un tocco.

```
D: Qual è la capitale dell'Australia?
- [ ] Sydney
- [x] Canberra
- [ ] Melbourne
S: Canberra fu scelta come compromesso tra Sydney e Melbourne.
```

**Scelta multipla** — più di una `[x]`. Bisogna selezionarle tutte (e solo quelle).

```
D: Quali sono numeri primi?
- [x] 2
- [ ] 9
- [x] 13
```

**Risposta aperta** — nessuna opzione, solo `R:`. Più risposte accettate si separano con `|`.
Il confronto ignora maiuscole, accenti, punteggiatura e spazi superflui.

```
D: Simbolo chimico dell'oro?
R: Au
```

```
D: Chi ha scritto la Divina Commedia?
R: Dante Alighieri | Dante
```

**Punteggio** = risposte corrette / domande.

## Formattazione del testo

In domande, risposte, opzioni e spiegazioni:

- `**grassetto**`, `*corsivo*`, `` `codice` ``
- immagini: `![descrizione](immagine.png)` — percorso relativo al file del mazzo
  (es. metti l'immagine nella stessa cartella), oppure un URL `https://`.

## Punteggi: `punteggi.json`

I risultati vengono salvati nel file `punteggi.json` della cartella del mazzo
(per la cartella principale: `decks/punteggi.json`). Lo scrive il sito tramite
l'API di GitHub (vedi README); non serve modificarlo a mano.

```json
{
  "versione": 1,
  "risultati": [
    {
      "id": "lz8k2m1-a3f9c",
      "mazzo": "decks/biologia/cellula.md",
      "cartella": "biologia",
      "tipo": "quiz",
      "data": "2026-11-22T18:30:00.000Z",
      "punti": 8,
      "totale": 10,
      "percentuale": 80,
      "durata": 154
    }
  ]
}
```

`durata` è in secondi. `mazzo` è il percorso del file dalla radice del repository:
se rinomini o sposti un mazzo, i vecchi risultati restano nel file ma non vengono
più associati a quel mazzo.

## Verifica

`node scripts/build-manifest.mjs --check` controlla tutti i mazzi e segnala
gli errori con il numero di riga (domanda senza risposta, quiz senza opzione corretta, ecc.).
La stessa verifica gira su GitHub a ogni push: se un mazzo è sbagliato il sito non viene aggiornato.
