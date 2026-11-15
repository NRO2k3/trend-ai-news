// Writes public/data/*.json so the page can be served by any static host
// (GitHub Pages). Run on a schedule to keep the data fresh.
import { mkdir, writeFile } from 'node:fs/promises';
import { DATA } from '../lib/data.js';
import { learnNotes } from '../lib/explain.js';
import { learnFrom } from '../lib/translate.js';
import { fetchText } from '../lib/util.js';

const OUT = new URL('../public/data/', import.meta.url);
// URL of the live site. Its current files let us reuse earlier translations and,
// if a dataset can't be fetched this time, keep publishing its previous copy.
const PREVIOUS = process.env.PREVIOUS_URL ? process.env.PREVIOUS_URL.replace(/\/?$/, '/') : null;

const previous = {};
if (PREVIOUS) {
  await Promise.all(
    Object.keys(DATA).map(async (name) => {
      try {
        previous[name] = await fetchText(`${PREVIOUS}data/${name}.json`);
        const old = JSON.parse(previous[name]);
        learnFrom(old);
        if (name === 'news' || name === 'repos') learnNotes(old);
      } catch {
        // first deploy, or the live site is down: start from scratch
      }
    }),
  );
}

await mkdir(OUT, { recursive: true });
let written = 0;

await Promise.all(
  Object.entries(DATA).map(async ([name, load]) => {
    const file = new URL(`${name}.json`, OUT);
    try {
      const data = await load();
      await writeFile(file, JSON.stringify(data));
      written++;
      const failed = data.sources?.filter((s) => !s.ok).map((s) => `${s.name} (${s.error})`) ?? [];
      console.log(`✓ ${name}${failed.length ? ` — nguồn lỗi: ${failed.join(', ')}` : ''}`);
    } catch (err) {
      console.error(`✗ ${name}: ${err.message}`);
      if (previous[name]) {
        await writeFile(file, previous[name]);
        written++;
        console.log(`  ↺ ${name}: giữ bản cũ từ trang đang chạy`);
      }
    }
  }),
);

// Nothing usable: fail so the deploy step is skipped and the live site stays as is.
if (written === 0) process.exit(1);
