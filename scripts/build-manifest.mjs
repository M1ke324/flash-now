#!/usr/bin/env node
// Scansiona la cartella decks/ e genera decks.json (l'indice letto dal sito).
// Controlla anche che ogni mazzo rispetti il formato: in caso di errori esce con codice 1.
//
// Uso:  node scripts/build-manifest.mjs           -> genera decks.json
//       node scripts/build-manifest.mjs --check   -> solo verifica, non scrive nulla

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeck } from '../js/parser.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const decksDir = join(root, 'decks');
const checkOnly = process.argv.includes('--check');

const decks = [];
const folders = new Set(['']);
let errorCount = 0;

function walk(dir) {
  for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b, 'it'))) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const rel = relative(decksDir, full).split(sep).join('/');
    if (statSync(full).isDirectory()) {
      folders.add(rel);
      walk(full);
    } else if (name.endsWith('.md') && name.toLowerCase() !== 'readme.md') {
      const deck = parseDeck(readFileSync(full, 'utf8'));
      for (const e of deck.errors) {
        console.error(`ERRORE decks/${rel}: ${e}`);
        errorCount++;
      }
      const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      decks.push({
        path: `decks/${rel}`,
        cartella: folder,
        titolo: deck.title || name.replace(/\.md$/, '').replace(/[-_]/g, ' '),
        descrizione: deck.description,
        tipo: deck.type,
        n: deck.items.length,
      });
    }
  }
}

walk(decksDir);

console.log(`${decks.length} mazzi in ${folders.size} cartelle, ${errorCount} errori.`);
if (!checkOnly) {
  const manifest = { generato: new Date().toISOString(), cartelle: [...folders].sort(), mazzi: decks };
  writeFileSync(join(root, 'decks.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Scritto decks.json');
}
process.exit(errorCount ? 1 : 0);
