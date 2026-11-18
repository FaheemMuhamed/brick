// Builds the runtime parts library from the LDraw library + Rebrickable data.
// Output (public/data):
//   parts/{id}.mpd   packed LDraw model (part + every subfile/primitive it needs) for LDrawLoader
//   parts.json       manifest: name, category, bounding box, connectors, gear teeth, colours, popularity
//   colors.json      colour table (LDraw finish info + Rebrickable usage stats)
// Coordinates stay in LDraw units (LDU, Y points down); the app converts at load time.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const RAW = path.resolve('data/raw');
const LD = path.join(RAW, 'ldraw');
const OUT = path.resolve('public/data');
const MAX_PARTS = Number(process.env.MAX_PARTS || 5000);
fs.mkdirSync(path.join(OUT, 'parts'), { recursive: true });

const csv = (f) => parse(fs.readFileSync(path.join(RAW, 'rebrickable', f + '.csv')), { columns: true });

// ---------- part selection ----------
const BUILD_CATS = new Set([1, 3, 5, 6, 8, 9, 11, 12, 14, 15, 16, 18, 19, 20, 21, 23, 29, 32, 37, 40, 46, 49, 51, 52, 53, 54, 55, 67, 76]);
// second set: vehicles, Technic specials, pneumatics, hoses, scenery, animals and minifig accessories
for (const c of [7, 22, 25, 26, 27, 28, 30, 31, 33, 34, 35, 36, 38, 39, 47, 68, 69, 73]) BUILD_CATS.add(c);
const cats = Object.fromEntries(csv('part_categories').map((c) => [c.id, c.name]));
const popularity = new Map();
const partColors = new Map();
for (const r of csv('inventory_parts')) {
  popularity.set(r.part_num, (popularity.get(r.part_num) || 0) + Number(r.quantity));
  let s = partColors.get(r.part_num);
  if (!s) partColors.set(r.part_num, (s = new Map()));
  s.set(r.color_id, (s.get(r.color_id) || 0) + Number(r.quantity));
}
const isPrinted = (id) => /pr\d|pat\d|pb\d|px\d|p[0-9a-z]{2,}$/i.test(id) && !/^\d+p$/.test(id);
const candidates = csv('parts')
  .filter((p) => BUILD_CATS.has(Number(p.part_cat_id)) && !isPrinted(p.part_num))
  .filter((p) => fs.existsSync(path.join(LD, 'parts', p.part_num + '.dat')))
  .map((p) => ({ ...p, pop: popularity.get(p.part_num) || 0 }))
  .filter((p) => p.pop > 0)
  .sort((a, b) => b.pop - a.pop)
  .slice(0, MAX_PARTS);

// "Next set of parts": every part the official OMR models use is added too (printed parts, rare moulds,
// minifig pieces…), so guided builds never hit a missing part.
const omrParts = path.join(RAW, "omr", "_parts.json");
if (fs.existsSync(omrParts)) {
  const have = new Set(candidates.map((c) => c.part_num));
  const rbParts = new Map(csv("parts").map((r) => [r.part_num, r]));
  for (const id of JSON.parse(fs.readFileSync(omrParts, "utf8"))) {
    if (have.has(id) || id.includes("/") || !fs.existsSync(path.join(LD, "parts", id + ".dat"))) continue;
    const rb = rbParts.get(id);
    const title = fs.readFileSync(path.join(LD, "parts", id + ".dat"), "utf8").split("\n")[0].replace(/^0\s+/, "").replace(/^~/, "").trim();
    candidates.push({ part_num: id, name: rb?.name ?? title, part_cat_id: rb?.part_cat_id ?? "0", pop: popularity.get(id) || 0, omr: true });
    have.add(id);
  }
}

// ---------- LDraw file access ----------
const fileCache = new Map();
function findFile(name) {
  const n = name.toLowerCase().replace(/\\/g, '/');
  for (const dir of ['parts', 'p', 'models']) {
    const f = path.join(LD, dir, n);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
function readLD(name) {
  const key = name.toLowerCase().replace(/\\/g, '/');
  if (fileCache.has(key)) return fileCache.get(key);
  const f = findFile(key);
  const text = f ? fs.readFileSync(f, 'utf8').replace(/\r/g, '') : null;
  fileCache.set(key, text);
  return text;
}

// ---------- matrix helpers (3x4 affine, row-major) ----------
const mul = (A, B) => {
  // A,B = [a,b,c,d,e,f,g,h,i,x,y,z] (rot rows + translation)
  const r = new Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
  for (let i = 0; i < 3; i++) r[9 + i] = A[i * 3] * B[9] + A[i * 3 + 1] * B[10] + A[i * 3 + 2] * B[11] + A[9 + i];
  return r;
};
const apply = (M, [x, y, z]) => [
  M[0] * x + M[1] * y + M[2] * z + M[9], M[3] * x + M[4] * y + M[5] * z + M[10], M[6] * x + M[7] * y + M[8] * z + M[11]];
const dir = (M, [x, y, z]) => {
  const v = [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
  const l = Math.hypot(...v) || 1;
  return v.map((c) => c / l);
};
const len = (M, [x, y, z]) => Math.hypot(M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z);
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

// Primitive → connector classification. Primitives are modelled along +Y (LDraw down).
function classify(prim) {
  const p = prim.toLowerCase().replace(/\\/g, '/').replace(/^.*\//, '');
  if (/^stud(\d+a?|a|2a?|-logo\d?|2-logo\d?|p01|el|x|xa)?\.dat$/.test(p) && !/^stud(3|4|16|17|18|19|21|22|23|24|25|26|27|28)/.test(p)) return 'stud';
  if (/^stud(4|3|16|18a|21a|22a)/.test(p)) return 'tube';
  if (/^(connhol|peghole|beamhol|connhole)/.test(p)) return 'pinhole';
  if (/^axlehol|^axleho1|^axlehole/.test(p)) return 'axlehole';
  if (/^axle\.dat$|^axl[e]?end/.test(p)) return 'axle';
  if (/^connect\d*\.dat$/.test(p)) return 'pin';
  return null;
}

function walk(name, M, out, deps, depth = 0) {
  const text = readLD(name);
  if (text == null) { out.missing.add(name); return; }
  deps.add(name.toLowerCase().replace(/\\/g, '/'));
  for (const line of text.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0] === '1' && t.length >= 15) {
      const n = t.slice(14).join(' ');
      const m = t.slice(2, 14).map(Number);
      const L = [m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[0], m[1], m[2]];
      const W = mul(M, L);
      const kind = depth < 6 ? classify(n) : null;
      if (kind) {
        const pos = apply(W, [0, 0, 0]);
        const axis = dir(W, [0, 1, 0]);
        out.conns.push({ k: kind, p: pos.map((v) => +v.toFixed(2)), a: axis.map((v) => +v.toFixed(3)), l: +len(W, [0, 1, 0]).toFixed(2) });
      }
      walk(n, W, out, deps, depth + 1);
    } else if (t[0] === '3' || t[0] === '4') {
      const n = t[0] === '3' ? 3 : 4;
      for (let i = 0; i < n; i++) {
        const v = apply(M, [Number(t[2 + i * 3]), Number(t[3 + i * 3]), Number(t[4 + i * 3])]);
        for (let a = 0; a < 3; a++) { out.min[a] = Math.min(out.min[a], v[a]); out.max[a] = Math.max(out.max[a], v[a]); }
      }
    }
  }
}

// Bricks/plates: anti-stud grid on the underside derived from the footprint.
const GRID_CATS = new Set([1, 3, 5, 6, 9, 11, 14, 15, 19, 20, 21, 37, 49, 67]);
function antistuds(min, max, studs) {
  const w = Math.round((max[0] - min[0]) / 20), d = Math.round((max[2] - min[2]) / 20);
  if (w < 1 || d < 1 || w > 48 || d > 48) return [];
  const res = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++)
    res.push({ k: 'anti', p: [+(min[0] + 10 + i * 20).toFixed(2), +max[1].toFixed(2), +(min[2] + 10 + j * 20).toFixed(2)], a: [0, -1, 0], l: 0 });
  return res;
}

// Collapse nearly-identical connectors (e.g. stud with logo + stud) and merge stacked holes.
function dedupe(conns) {
  const seen = new Map();
  for (const c of conns) {
    const key = c.k + ':' + c.p.map((v) => Math.round(v)).join(',');
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

// ---------- Technic connectors ----------
// LDraw draws one hole with several primitives (one per face / depth) and reuses the "axle hole" primitive
// for solid axle bodies, so raw primitive hits are noisy. Clean them up:
//  1) holes: merge primitives lying on the same axis line into one connector (centre, axis, length)
//  2) axles / pins / gears / bushes: derive the connector from category + bounding box instead
const AXLE_CAT = 46, PIN_CAT = 53, GEAR_CAT = 52, BUSH_CAT = 54;
function canonAxis(a) {
  // one direction per line, so opposite-facing primitives of the same hole cluster together
  const i = [0, 1, 2].reduce((m, k) => (Math.abs(a[k]) > Math.abs(a[m]) ? k : m), 0);
  return a[i] < 0 ? a.map((v) => -v) : a;
}
function clusterHoles(conns) {
  const holes = conns.filter((c) => c.k === 'pinhole' || c.k === 'axlehole');
  const groups = [];
  for (const c of holes) {
    const a = canonAxis(c.a);
    // project the point onto the plane perpendicular to the axis: same line ⇔ same projection
    const d = c.p[0] * a[0] + c.p[1] * a[1] + c.p[2] * a[2];
    const q = [c.p[0] - a[0] * d, c.p[1] - a[1] * d, c.p[2] - a[2] * d];
    let g = groups.find((g) => Math.abs(g.a[0] * a[0] + g.a[1] * a[1] + g.a[2] * a[2]) > 0.99 && Math.hypot(g.q[0] - q[0], g.q[1] - q[1], g.q[2] - q[2]) < 3);
    if (!g) groups.push((g = { a, q, ds: [], kinds: new Set() }));
    g.ds.push(d, d + c.l * (c.a[0] * a[0] + c.a[1] * a[1] + c.a[2] * a[2]));
    g.kinds.add(c.k);
  }
  return groups.map((g) => {
    const lo = Math.min(...g.ds), hi = Math.max(...g.ds);
    const mid = (lo + hi) / 2;
    return {
      // any axle-shaped section makes the hole grip axles (rotation-locked); otherwise it's a round pin hole
      k: g.kinds.has('axlehole') ? 'axlehole' : 'pinhole',
      p: g.q.map((v, i) => +(v + g.a[i] * mid).toFixed(2)),
      a: g.a.map((v) => +v.toFixed(3)),
      l: +Math.max(hi - lo, 8).toFixed(2),
    };
  });
}
function boxAxes(min, max) {
  const ext = [0, 1, 2].map((i) => max[i] - min[i]);
  const order = [0, 1, 2].sort((x, y) => ext[x] - ext[y]);
  const unit = (i) => [0, 1, 2].map((k) => (k === i ? 1 : 0));
  return { ext, longest: unit(order[2]), thinnest: unit(order[0]), longLen: ext[order[2]] };
}
function technicConns(conns, cat, name, min, max) {
  const rest = conns.filter((c) => !['pinhole', 'axlehole', 'axle', 'pin'].includes(c.k));
  const centre = [0, 1, 2].map((i) => +((min[i] + max[i]) / 2).toFixed(2));
  const ax = boxAxes(min, max);
  if (cat === AXLE_CAT && /axle/i.test(name)) return [...rest, { k: 'axle', p: centre, a: ax.longest, l: +ax.longLen.toFixed(2) }];
  if (cat === PIN_CAT) return [...rest, { k: 'pin', p: centre, a: ax.longest, l: +ax.longLen.toFixed(2) }];
  if (cat === GEAR_CAT || cat === BUSH_CAT) {
    const holes = clusterHoles(conns);
    const hub = holes.find((h) => Math.hypot(h.p[0] - centre[0], h.p[1] - centre[1], h.p[2] - centre[2]) < 4);
    return [...rest, hub ?? { k: 'axlehole', p: centre, a: ax.thinnest, l: +ax.ext[ax.thinnest.indexOf(1)].toFixed(2) }];
  }
  return [...rest, ...conns.filter((c) => c.k === 'pin' || c.k === 'axle'), ...clusterHoles(conns)];
}

// tread sprockets carry a chain/tread, they don't mesh like gears
const sprocketTeeth = (name) => { const m = /Sprocket.*?(\d+)\s*Tooth/i.exec(name); return m ? Number(m[1]) : undefined; };
const gearTeeth = (name) => { const m = /Gear\s+(\d+)\s*Tooth/i.exec(name); return m ? Number(m[1]) : undefined; };

// ---------- pack ----------
const manifest = [];
let bytes = 0;
for (const p of candidates) {
  const out = { conns: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], missing: new Set() };
  const deps = new Set();
  walk(p.part_num + '.dat', I, out, deps);
  if (out.missing.size || !isFinite(out.min[0])) continue;
  // Only studs that point up (-Y in LDraw) are snap studs; tubes become anti-studs via the grid.
  let conns = out.conns.filter((c) => c.k !== 'tube' && !(c.k === 'stud' && c.a[1] > -0.9 && c.a[1] < 0.9 && false));
  const cat = Number(p.part_cat_id);
  if (GRID_CATS.has(cat)) conns = conns.concat(antistuds(out.min, out.max));
  conns = dedupe(conns);
  conns = technicConns(conns, cat, p.name, out.min, out.max);
  // packed mpd: main file first, then each dependency as a 0 FILE section
  const main = p.part_num + '.dat';
  let mpd = `0 FILE ${main}\n${readLD(main)}\n`;
  // LDrawLoader rewrites s/ → parts/s/ and 48/ → p/48/ before looking files up, so embed them under those names
  const embedName = (d) => (d.startsWith("s/") ? "parts/" + d : d.startsWith("48/") ? "p/" + d : d);
  for (const d of deps) if (d !== main.toLowerCase()) mpd += `0 FILE ${embedName(d)}\n${readLD(d)}\n`;
  fs.writeFileSync(path.join(OUT, 'parts', p.part_num + '.mpd'), mpd);
  bytes += mpd.length;
  const colors = [...(partColors.get(p.part_num) || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([c]) => Number(c));
  manifest.push({
    id: p.part_num, name: p.name, cat, pop: p.pop,
    min: out.min.map((v) => +v.toFixed(2)), max: out.max.map((v) => +v.toFixed(2)),
    conns, teeth: gearTeeth(p.name), sprocket: sprocketTeeth(p.name), colors, ...(p.omr ? { hidden: 1 } : {}),
  });
}
// Left/right pairs for the mirror tool: Rebrickable "R" (pair) relationships between two library parts whose
// names differ only by Left ↔ Right.
{
  const byId = new Map(manifest.map((m) => [m.id, m]));
  const norm = (n) => n.replace(/\b(Left|Right)\b/g, "#").trim();
  for (const r of csv("part_relationships")) {
    if (r.rel_type !== "R") continue;
    const a = byId.get(r.child_part_num), b = byId.get(r.parent_part_num);
    if (!a || !b || a === b) continue;
    const lr = (n) => (/\bLeft\b/.test(n) ? "L" : /\bRight\b/.test(n) ? "R" : "");
    if (!lr(a.name) || lr(a.name) === lr(b.name) || norm(a.name) !== norm(b.name)) continue;
    a.mirror = b.id; b.mirror = a.id;
  }
  // plus any two library parts whose names differ only by Left ↔ Right
  const byName = new Map();
  for (const m of manifest) if (!m.mirror && /\b(Left|Right)\b/.test(m.name)) {
    const k = norm(m.name);
    const other = byName.get(k);
    if (other && !other.mirror && /\bLeft\b/.test(other.name) !== /\bLeft\b/.test(m.name)) { m.mirror = other.id; other.mirror = m.id; }
    else byName.set(k, m);
  }
  console.log("mirror pairs:", manifest.filter((m) => m.mirror).length / 2);
}
fs.writeFileSync(path.join(OUT, 'parts.json'), JSON.stringify({ categories: cats, parts: manifest }));

// ---------- colours ----------
const rb = Object.fromEntries(csv('colors').map((c) => [c.id, c]));
const colors = [];
for (const line of readLD('../LDConfig.ldr')?.split('\n') ?? fs.readFileSync(path.join(LD, 'LDConfig.ldr'), 'utf8').split('\n')) {
  const m = /^0 !COLOUR (\S+)\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})\s+EDGE\s+#?(\S+)(.*)$/.exec(line.trim());
  if (!m) continue;
  const [, name, code, hex, , rest] = m;
  const alpha = /ALPHA\s+(\d+)/.exec(rest);
  const finish = /CHROME/.test(rest) ? 'chrome' : /METAL/.test(rest) ? 'metal' : /PEARLESCENT/.test(rest) ? 'pearl'
    : /RUBBER/.test(rest) ? 'rubber' : /MATERIAL GLITTER/.test(rest) ? 'glitter' : /MATERIAL SPECKLE/.test(rest) ? 'speckle'
    : /LUMINANCE/.test(rest) ? 'glow' : alpha ? 'trans' : 'solid';
  const r = rb[code];
  colors.push({ code: Number(code), name: r?.name ?? name.replace(/_/g, ' '), hex: '#' + hex, alpha: alpha ? Number(alpha[1]) / 255 : 1,
    finish, parts: r ? Number(r.num_parts) : 0, y1: r ? Number(r.y1) || undefined : undefined, y2: r ? Number(r.y2) || undefined : undefined });
}
fs.writeFileSync(path.join(OUT, 'colors.json'), JSON.stringify(colors));
console.log(`parts: ${manifest.length} of ${candidates.length} candidates, ${(bytes / 1e6).toFixed(1)} MB packed; colours: ${colors.length}`);
