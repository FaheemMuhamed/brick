// Downloads raw source data into data/raw (each source in its own folder).
//  - LDraw official parts library (CC BY 2.0)  https://library.ldraw.org
//  - Rebrickable catalog CSV dumps             https://rebrickable.com/downloads/
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RAW = path.resolve('data/raw');
const RB = 'https://cdn.rebrickable.com/media/downloads/';
const RB_FILES = ['themes', 'colors', 'part_categories', 'parts', 'part_relationships', 'elements',
  'sets', 'minifigs', 'inventories', 'inventory_parts', 'inventory_sets', 'inventory_minifigs'];

async function download(url, dest, gunzip = false) {
  if (existsSync(dest)) { console.log('skip', path.basename(dest)); return; }
  console.log('get ', url);
  const res = await fetch(url, { headers: { 'User-Agent': 'brick-atelier-data-fetch' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = Readable.fromWeb(res.body);
  if (gunzip) await pipeline(body, createGunzip(), createWriteStream(dest));
  else await pipeline(body, createWriteStream(dest));
}

mkdirSync(path.join(RAW, 'rebrickable'), { recursive: true });
mkdirSync(path.join(RAW, 'ldraw-zip'), { recursive: true });

await Promise.all(RB_FILES.map((f) => download(`${RB}${f}.csv.gz`, path.join(RAW, 'rebrickable', `${f}.csv`), true)));

const zip = path.join(RAW, 'ldraw-zip', 'complete.zip');
await download('https://library.ldraw.org/library/updates/complete.zip', zip);
if (!existsSync(path.join(RAW, 'ldraw'))) {
  console.log('unzip ldraw');
  execFileSync('unzip', ['-q', zip, '-d', RAW]); // zip contains a top-level "ldraw/" folder
}
console.log('done');
