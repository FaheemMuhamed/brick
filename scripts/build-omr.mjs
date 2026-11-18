// Converts LDraw OMR models (data/raw/omr/*.mpd) into flat, ordered build steps for guided mode.
//   public/data/models/{set}.json  { set, name, steps: [[part, color, x, y, z, qx, qy, qz, qw], ...][] }
//   public/data/guided.json        [[set, name, stepCount, partCount], ...]
//   data/raw/omr/_parts.json       every part id the models use (fed to build-parts so none are missing)
// Submodels are built in place: when a step adds a submodel, that submodel's own steps are emitted first,
// already at their final position, so a guide reads like the paper manual (sub-assembly, then attach).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { parse } from 'csv-parse/sync';

const RAW = path.resolve('data/raw/omr');
const LD = path.resolve('data/raw/ldraw');
const OUT = path.resolve('public/data/models');
fs.mkdirSync(OUT, { recursive: true });
const LDU = 1 / 20;
const isPart = (name) => fs.existsSync(path.join(LD, 'parts', name.replace(/\\/g, '/')));

function parseMpd(text) {
  const files = new Map();
  let cur = null, first = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const m = /^0\s+FILE\s+(.+)$/i.exec(line);
    if (m) { cur = m[1].trim().toLowerCase(); first ??= cur; files.set(cur, []); continue; }
    if (!cur) { cur = '__main__'; first = cur; files.set(cur, []); }
    if (/^0\s+NOFILE/i.test(line)) { cur = null; continue; }
    files.get(cur).push(line);
  }
  return { files, main: first };
}

// LDraw (Y down) → world (Y up, 1 unit = 1 stud): conjugate by S = diag(1,-1,-1), scale positions by 1/20
const S = new THREE.Matrix4().makeScale(1, -1, -1);
function toWorld(M) {
  const w = S.clone().multiply(M).multiply(S);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  w.decompose(p, q, sc);
  p.multiplyScalar(LDU);
  return { p, q };
}

function convert(text) {
  const { files, main } = parseMpd(text);
  const usedParts = new Set();
  const steps = [];
  let current = [];
  const flush = () => { if (current.length) steps.push(current); current = []; };

  function walk(name, parent, color, depth) {
    const lines = files.get(name);
    if (!lines || depth > 12) return;
    for (const line of lines) {
      if (/^0\s+(ROT)?STEP\b/i.test(line)) { if (depth === 0 || true) flush(); continue; }
      const t = line.split(/\s+/);
      if (t[0] !== '1' || t.length < 15) continue;
      const c = t[1] === '16' ? color : Number(t[1]);
      const n = t.slice(14).join(' ').toLowerCase().replace(/\\/g, '/');
      const v = t.slice(2, 14).map(Number);
      const L = new THREE.Matrix4().set(v[3], v[4], v[5], v[0], v[6], v[7], v[8], v[1], v[9], v[10], v[11], v[2], 0, 0, 0, 1);
      const W = parent.clone().multiply(L);
      if (files.has(n)) {
        // sub-assembly: build it (its own steps) in place, then continue
        flush();
        walk(n, W, c, depth + 1);
        flush();
      } else if (n.endsWith('.dat') && !n.includes('/') && isPart(n)) {
        const id = n.replace(/\.dat$/, '');
        usedParts.add(id);
        const { p, q } = toWorld(W);
        current.push([id, c, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5), +q.w.toFixed(5)]);
      }
    }
  }
  walk(main, new THREE.Matrix4(), 16, 0);
  flush();
  // Paper manuals add a handful of parts per step; split huge steps (e.g. unstepped models) into chunks of ~12.
  const tidy = steps.flatMap((s) => {
    if (s.length <= 16) return [s];
    const out = [];
    const sorted = [...s].sort((a, b) => a[3] - b[3]); // bottom-up
    for (let i = 0; i < sorted.length; i += 12) out.push(sorted.slice(i, i + 12));
    return out;
  });
  const title = (files.get(main) ?? []).find((l) => l.startsWith('0 ') && !/^0\s+(Name:|Author:|!|FILE|BFC|STEP)/i.test(l))?.slice(2).trim();
  return { steps: tidy, usedParts, title };
}

// official set names (the model files are often just called "main")
const setNames = new Map(parse(fs.readFileSync(path.resolve('data/raw/rebrickable/sets.csv')), { columns: true }).map((r) => [r.set_num, r.name]));
const index = [];
const allParts = new Set();
let ok = 0, skipped = 0;
for (const f of fs.readdirSync(RAW).filter((f) => /\.(mpd|ldr)$/i.test(f))) {
  const set = /^([0-9a-z]+-\d+)/i.exec(f)?.[1];
  if (!set) { skipped++; continue; }
  try {
    const { steps, usedParts, title } = convert(fs.readFileSync(path.join(RAW, f), 'utf8'));
    const count = steps.reduce((a, s) => a + s.length, 0);
    if (!count) { skipped++; continue; }
    usedParts.forEach((p) => allParts.add(p));
    const name = setNames.get(set) ?? title ?? set;
    fs.writeFileSync(path.join(OUT, `${set}.json`), JSON.stringify({ set, name, steps }));
    index.push([set, name, steps.length, count]);
    ok++;
  } catch (e) {
    skipped++;
    console.warn('skip', f, e.message);
  }
}
index.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
fs.writeFileSync(path.resolve('public/data/guided.json'), JSON.stringify(index));
fs.writeFileSync(path.join(RAW, '_parts.json'), JSON.stringify([...allParts]));
console.log(`models: ${ok} converted, ${skipped} skipped; ${allParts.size} distinct parts used`);
