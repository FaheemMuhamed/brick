// Downloads the LDraw Official Model Repository (OMR): official LEGO sets modelled in LDraw with build steps.
// Files are CC BY (see each file's header). Polite crawler: low concurrency, a pause between requests,
// resumable (skips files already on disk).
//   index:  https://library.ldraw.org/omr/sets?page=N        (25 sets per page)
//   set:    https://library.ldraw.org/omr/sets/{id}          (links /media/omr_models/{n}/{set}.mpd)
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('data/raw/omr');
const UA = { 'User-Agent': 'brick-atelier-data-fetch (non-commercial, rate-limited)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(1500 * (i + 1));
  }
  return null;
}

// 1) set page ids from the paginated index
const idx = path.join(OUT, '_index.json');
let ids = fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, 'utf8')) : [];
if (!ids.length) {
  for (let page = 1; page < 200; page++) {
    const html = await get(`https://library.ldraw.org/omr/sets?page=${page}`);
    const found = [...new Set([...(html ?? '').matchAll(/omr\/sets\/(\d+)"/g)].map((m) => m[1]))];
    if (!found.length) break;
    ids.push(...found);
    process.stdout.write(`\rindex page ${page}: ${ids.length} sets`);
    await sleep(250);
  }
  ids = [...new Set(ids)];
  fs.writeFileSync(idx, JSON.stringify(ids));
  console.log();
}

// 2) each set page → its main model file(s); download the .mpd
let done = 0, saved = 0;
const queue = [...ids];
async function worker() {
  while (queue.length) {
    const id = queue.shift();
    const html = await get(`https://library.ldraw.org/omr/sets/${id}`);
    const files = [...new Set([...(html ?? '').matchAll(/href="(https:\/\/library\.ldraw\.org\/media\/omr_models\/\d+\/([^"?]+\.(?:mpd|ldr)))/g)].map((m) => m[1] + '|' + m[2]))];
    for (const f of files) {
      const [url, name] = f.split('|');
      const dest = path.join(OUT, decodeURIComponent(name));
      if (fs.existsSync(dest)) continue;
      const text = await get(url);
      if (text) { fs.writeFileSync(dest, text); saved++; }
      await sleep(200);
    }
    done++;
    if (done % 10 === 0) process.stdout.write(`\rsets ${done}/${ids.length}, files saved ${saved}`);
    await sleep(200);
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log(`\ndone: ${done} sets, ${saved} new files in ${OUT}`);
