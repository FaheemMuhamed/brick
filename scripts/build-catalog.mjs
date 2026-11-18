// Builds the official set catalogue from Rebrickable CSV dumps.
// Output (public/data):
//   themes.json        [{id, name, parent}]
//   sets.json          [[set_num, name, year, theme_id, num_parts, buildable%]]  (compact rows)
//   inv/{set}.json     {parts: [[part, color, qty]], minifigs: [[fig, qty]]}  (latest inventory version, spares excluded)
//   appears.json       {part: [count, [set_num...up to 40, newest first]]} for parts in our library
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const RAW = path.resolve('data/raw/rebrickable');
const OUT = path.resolve('public/data');
const csv = (f) => parse(fs.readFileSync(path.join(RAW, f + '.csv')), { columns: true });
fs.mkdirSync(path.join(OUT, 'inv'), { recursive: true });

const library = new Set(JSON.parse(fs.readFileSync(path.join(OUT, 'parts.json'), 'utf8')).parts.map((p) => p.id));
// A printed or patterned variant (pr0001, pat0001, …) we have no model for uses the plain model of the same part:
// same shape, just without the decoration. Covers e.g. 60 wheels/tyres and thousands of printed tiles.
const aliasCache = new Map();
function modelFor(id) {
  if (library.has(id)) return id;
  if (aliasCache.has(id)) return aliasCache.get(id);
  const tries = [id.replace(/(pr|pat|pb|px)\d+.*$/, ''), id.replace(/(pr|pat|pb|px)\d+.*$/, '').replace(/[a-z]$/, ''), id.replace(/[a-z]$/, '')];
  const hit = tries.find((t) => t && t !== id && library.has(t)) ?? null;
  aliasCache.set(id, hit);
  return hit;
}

const themes = csv('themes').map((t) => ({ id: Number(t.id), name: t.name, parent: t.parent_id ? Number(t.parent_id) : null }));
fs.writeFileSync(path.join(OUT, 'themes.json'), JSON.stringify(themes));

// latest inventory version per set
const latest = new Map();
for (const inv of csv('inventories')) {
  const cur = latest.get(inv.set_num);
  if (!cur || Number(inv.version) > cur.version) latest.set(inv.set_num, { id: inv.id, version: Number(inv.version) });
}
const invToSet = new Map([...latest.entries()].map(([s, v]) => [v.id, s]));

const invParts = new Map();
for (const r of csv('inventory_parts')) {
  const set = invToSet.get(r.inventory_id);
  if (!set || r.is_spare === 'True') continue;
  let a = invParts.get(set);
  if (!a) invParts.set(set, (a = []));
  a.push([modelFor(r.part_num) ?? r.part_num, Number(r.color_id), Number(r.quantity)]);
}
const invFigs = new Map();
for (const r of csv('inventory_minifigs')) {
  const set = invToSet.get(r.inventory_id);
  if (!set) continue;
  let a = invFigs.get(set);
  if (!a) invFigs.set(set, (a = []));
  a.push([r.fig_num, Number(r.quantity)]);
}

const sets = csv('sets');
const year = Object.fromEntries(sets.map((s) => [s.set_num, Number(s.year)]));
const rows = [];
const appears = new Map();
for (const s of sets) {
  const parts = invParts.get(s.set_num) || [];
  if (!parts.length) continue;
  let have = 0, total = 0;
  for (const [p, , q] of parts) {
    total += q;
    if (library.has(p)) {
      have += q;
      let a = appears.get(p);
      if (!a) appears.set(p, (a = new Set()));
      a.add(s.set_num);
    }
  }
  const pct = total ? Math.round((have / total) * 100) : 0;
  rows.push([s.set_num, s.name, Number(s.year), Number(s.theme_id), Number(s.num_parts), pct]);
  fs.writeFileSync(path.join(OUT, 'inv', s.set_num + '.json'), JSON.stringify({ parts, minifigs: invFigs.get(s.set_num) || [] }));
}
rows.sort((a, b) => b[2] - a[2] || b[4] - a[4]);
fs.writeFileSync(path.join(OUT, 'sets.json'), JSON.stringify(rows));

const ap = {};
for (const [p, s] of appears) ap[p] = [s.size, [...s].sort((a, b) => year[b] - year[a]).slice(0, 40)];
fs.writeFileSync(path.join(OUT, 'appears.json'), JSON.stringify(ap));
console.log(`themes ${themes.length}, sets ${rows.length}, appears ${Object.keys(ap).length}`);
