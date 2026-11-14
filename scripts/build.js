// Writes public/data/*.json so the page can be served by any static host
// (GitHub Pages). Run on a schedule to keep the data fresh.
import { mkdir, writeFile } from 'node:fs/promises';
import { DATA } from '../lib/data.js';
import { fetchText } from '../lib/util.js';

const OUT = new URL('../public/data/', import.meta.url);
// URL of the live site; when one dataset can't be fetched we keep its previous copy.
const PREVIOUS = process.env.PREVIOUS_URL ? process.env.PREVIOUS_URL.replace(/\/?$/, '/') : null;

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
      if (!PREVIOUS) return;
      try {
        await writeFile(file, await fetchText(`${PREVIOUS}data/${name}.json`));
        written++;
        console.log(`  ↺ ${name}: giữ bản cũ từ trang đang chạy`);
      } catch (e) {
        console.error(`  ✗ ${name}: không lấy được bản cũ (${e.message})`);
      }
    }
  }),
);

// Nothing usable: fail so the deploy step is skipped and the live site stays as is.
if (written === 0) process.exit(1);
