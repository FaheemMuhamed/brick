import * as THREE from 'three';
import type { Part, BrickColor } from '../data/library';
import type { Brick } from '../building/snap';
import type { GuidedModel, Target } from './guided';

// Alternate builds: design an original model that uses only the parts of one set.
//  1. a design is a stack of layers; each layer is a set of stud cells and the "role" of each cell
//     (wall, roof, leaf…). Roof cells can ask for a slope facing a direction; finishing layers prefer tiles.
//  2. the design is scaled to the biggest size the set's parts can cover
//  3. each layer is packed with the largest pieces that fit, preferring spots that bridge the seams of the
//     layer below (that interlock is what makes real models hold together)
//  4. the result is split into manual-style steps, bottom up

export type Design = 'cottage' | 'tower' | 'lighthouse' | 'tree' | 'pyramid' | 'mosaic' | 'photo';
export const DESIGNS: { id: Design; label: string }[] = [
  { id: 'cottage', label: 'Cottage' },
  { id: 'tower', label: 'Castle tower' },
  { id: 'lighthouse', label: 'Lighthouse' },
  { id: 'tree', label: 'Tree' },
  { id: 'pyramid', label: 'Stepped pyramid' },
  { id: 'mosaic', label: 'Mosaic tile' },
];

/** A cell role: a colour family, optionally a slope that must face a direction ("roof>-z"). */
type Role = string;
type Dir = '+x' | '-x' | '+z' | '-z';
interface Layer { kind: 'brick' | 'plate'; cells: Map<string, Role>; finish?: boolean }
interface Piece {
  part: string; w: number; d: number; kind: 'brick' | 'plate'; tile?: boolean;
  /** 45° slope: which way it descends (unrotated, part-local) */
  slope?: { down: [number, number] };
  /** offset of the footprint centre from the part origin (part-local, studs) */
  fc: [number, number];
}
type Budget = Map<string, number>; // `${part}:${color}` → count left

const key = (x: number, z: number) => `${x},${z}`;
const BRICK_OR_PLATE = /^(Brick|Plate) (\d+) x (\d+)$/;
const TILE = /^Tile (\d+) x (\d+)( with Groove)?$/;
const SLOPE45 = /^Brick Sloped 45° 2 x (\d+)$/;

/** Pieces the generator can use: plain bricks / plates, tiles, and 45° 2-deep slopes (read from geometry). */
export function standardPieces(parts: Map<string, Part>): Map<string, Piece> {
  const out = new Map<string, Piece>();
  for (const p of parts.values()) {
    const size = p.box.getSize(new THREE.Vector3());
    const c = p.box.getCenter(new THREE.Vector3());
    const fc: [number, number] = [+c.x.toFixed(3), +c.z.toFixed(3)];
    let m = BRICK_OR_PLATE.exec(p.name);
    if (m) {
      const a = Number(m[2]), b = Number(m[3]);
      out.set(p.id, { part: p.id, w: Math.max(a, b), d: Math.min(a, b), kind: m[1] === 'Brick' ? 'brick' : 'plate', fc: [0, 0] });
      continue;
    }
    m = TILE.exec(p.name);
    if (m) {
      const a = Number(m[1]), b = Number(m[2]);
      out.set(p.id, { part: p.id, w: Math.max(a, b), d: Math.min(a, b), kind: 'plate', tile: true, fc: [0, 0] });
      continue;
    }
    m = SLOPE45.exec(p.name);
    if (m) {
      // which way does it fall? from the footprint centre away from the stud row on its high side
      const studs = p.connectors.filter((k) => k.kind === 'stud');
      if (!studs.length) continue;
      const s = studs.reduce((a, k) => a.add(k.pos), new THREE.Vector3()).divideScalar(studs.length);
      const dx = c.x - s.x, dz = c.z - s.z;
      const down: [number, number] = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
      // footprint: width along the slope's edge, 2 deep
      const across = down[0] !== 0 ? size.z : size.x;
      out.set(p.id, { part: p.id, w: Math.round(across), d: 2, kind: 'brick', slope: { down }, fc });
    }
  }
  return out;
}

// ---------------------------------------------------------------- designs
function rect(w: number, d: number, role: Role, inset = 0, x0 = 0, z0 = 0) {
  const m = new Map<string, Role>();
  for (let x = inset; x < w - inset; x++) for (let z = inset; z < d - inset; z++) m.set(key(x + x0, z + z0), role);
  return m;
}
function ring(w: number, d: number, role: Role, inset = 0) {
  const m = new Map<string, Role>();
  for (let x = inset; x < w - inset; x++) for (let z = inset; z < d - inset; z++)
    if (x === inset || z === inset || x === w - 1 - inset || z === d - 1 - inset) m.set(key(x, z), role);
  return m;
}
const merge = (...ms: Map<string, Role>[]) => { const o = new Map<string, Role>(); for (const m of ms) for (const [k, v] of m) o.set(k, v); return o; };

function design(kind: Design, s: number, slopes: boolean): Layer[] {
  const L: Layer[] = [];
  switch (kind) {
    case 'cottage': {
      const w = 4 + 2 * s, d = 4 + 2 * Math.max(0, s - 1), h = 2 + s;
      L.push({ kind: 'plate', cells: rect(w, d, 'base') });
      for (let y = 0; y < h; y++) {
        const r = ring(w, d, 'wall');
        const door = Math.floor(w / 2) - 1;
        if (y < 2) { r.delete(key(door, 0)); r.delete(key(door + 1, 0)); } // a two-wide door
        if (y === 1 && w >= 8) { r.set(key(1, 0), 'accent'); r.set(key(w - 2, 0), 'accent'); } // window frames
        L.push({ kind: 'brick', cells: r });
      }
      if (slopes) {
        // gable roof: slopes face front and back, one stud further in per course; the end walls rise as gables
        for (let i = 0; ; i++) {
          const f0 = i, b0 = d - 2 - i;
          const course = new Map<string, Role>();
          if (b0 - f0 >= 2) {
            for (let x = 0; x < w; x++) {
              course.set(key(x, f0), 'roof>-z'); course.set(key(x, f0 + 1), 'roof>-z');
              course.set(key(x, b0), 'roof>+z'); course.set(key(x, b0 + 1), 'roof>+z');
            }
            for (let z = f0 + 2; z < b0; z++) { course.set(key(0, z), 'wall'); course.set(key(w - 1, z), 'wall'); }
            L.push({ kind: 'brick', cells: course });
          } else {
            // ridge: whatever is left at the top, bricks in the roof colour
            for (let x = 0; x < w; x++) for (let z = f0; z <= b0 + 1; z++) course.set(key(x, z), 'roof');
            if (course.size) L.push({ kind: 'brick', cells: course });
            break;
          }
        }
      } else {
        // stepped roof: each course two studs deep and one further in, so it always sits on the one below
        for (let i = 0; 2 * i < Math.min(w, d) - 1; i++) L.push({ kind: 'brick', cells: merge(ring(w, d, 'roof', i), ring(w, d, 'roof', i + 1)) });
      }
      break;
    }
    case 'tower': {
      const w = 2 + s, h = 3 + 2 * s;
      L.push({ kind: 'plate', cells: rect(w, w, 'base') });
      for (let y = 0; y < h; y++) L.push({ kind: 'brick', cells: ring(w, w, y % 4 === 3 ? 'accent' : 'wall') });
      L.push({ kind: 'plate', cells: rect(w, w, 'roof') });
      const top = new Map<string, Role>();
      for (const [k] of ring(w, w, 'roof')) { const [x, z] = k.split(',').map(Number); if ((x + z) % 2 === 0) top.set(k, 'roof'); }
      L.push({ kind: 'brick', cells: top });
      break;
    }
    case 'lighthouse': {
      const w = 4, h = 4 + 2 * s, o = 1; // tower 4×4 standing on a 6×6 base
      L.push({ kind: 'plate', cells: rect(w + 2, w + 2, 'base') });
      const shifted = (m: Map<string, Role>) => new Map([...m].map(([k, v]) => { const [x, z] = k.split(',').map(Number); return [key(x + o, z + o), v]; }));
      for (let y = 0; y < h; y++) L.push({ kind: 'brick', cells: shifted(ring(w, w, Math.floor(y / 2) % 2 ? 'stripeB' : 'stripeA')) });
      L.push({ kind: 'plate', cells: rect(w + 2, w + 2, 'accent') });                      // gallery
      L.push({ kind: 'brick', cells: shifted(ring(w, w, 'lamp')) });                        // lantern
      L.push({ kind: 'brick', cells: shifted(ring(w, w, 'lamp')) });
      L.push({ kind: 'plate', cells: shifted(rect(w, w, 'stripeA')), finish: true });        // cap
      break;
    }
    case 'tree': {
      const c = 1 + s, n = 2 * c + 2; // canopy width
      const trunk = (m: Role) => rect(2, 2, m, 0, c, c);
      L.push({ kind: 'plate', cells: rect(n, n, 'grass', Math.max(0, c - 2)) });
      for (let y = 0; y < 2 + s; y++) L.push({ kind: 'brick', cells: trunk('trunk') });
      const blob = (half: number, role: Role) => {
        const m = new Map<string, Role>();
        for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
          const dx = Math.abs(x + 0.5 - n / 2), dz = Math.abs(z + 0.5 - n / 2);
          if (dx <= half && dz <= half && dx + dz <= half * 1.5) m.set(key(x, z), role);
        }
        return m;
      };
      const radii = [c - 0.5, c + 1, c + 1, c, c - 1, 1];
      radii.forEach((r, i) => { if (r >= 1) L.push({ kind: 'brick', cells: blob(r, i % 2 ? 'leaf2' : 'leaf') }); });
      break;
    }
    case 'pyramid': {
      const w = 4 + 2 * s;
      for (let i = 0; 2 * i < w; i++) L.push({ kind: 'brick', cells: rect(w, w, i % 2 ? 'accent' : 'wall', i) });
      break;
    }
    case 'mosaic': {
      const w = 6 + 2 * s;
      L.push({ kind: 'plate', cells: rect(w, w, 'base') });
      const pattern = new Map<string, Role>();
      const c = (w - 1) / 2;
      for (let x = 0; x < w; x++) for (let z = 0; z < w; z++) {
        const edge = x === 0 || z === 0 || x === w - 1 || z === w - 1;
        pattern.set(key(x, z), edge ? 'accent' : Math.abs(x - c) + Math.abs(z - c) <= c * 0.7 ? 'pattern' : 'wall');
      }
      L.push({ kind: 'plate', cells: pattern, finish: true });
      break;
    }
    case 'photo':
      break; // built by generatePhotoMosaic
  }
  return L;
}

// ---------------------------------------------------------------- colours
/** Perceptual-ish distance between two hex colours (weighted RGB). */
export function colorDistance(a?: string, b?: string) {
  if (!a || !b) return 999;
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

/** Strict pass: natural roles may only borrow similar shades (relaxed if a design can't be built that way). */
let strictRoles = true;

/** Roles that should look like something real: ask for the closest shade the set has. */
const ROLE_HEX: Record<string, string> = {
  trunk: '#6B3F22', leaf: '#4B974A', leaf2: '#237841', grass: '#58AB41',
  stripeA: '#C91A09', stripeB: '#F4F4F4', lamp: '#F5CD2F',
};
const baseRole = (r: Role) => r.split('>')[0];

/** The role's palette colour if this shape exists in it, otherwise the closest shade the set has for this shape. */
function chooseColor(budget: Budget, part: string, role: Role, palette: Map<Role, number>, colors: Map<number, BrickColor>) {
  const r = baseRole(role);
  const preferred = palette.get(r);
  if (preferred != null && (budget.get(`${part}:${preferred}`) ?? 0) > 0) return preferred;
  const want = colors.get(preferred ?? -1)?.hex ?? ROLE_HEX[r];
  let best = -1, bestD = Infinity;
  for (const [k, n] of budget) {
    const [p, c] = k.split(':');
    if (p !== part || n <= 0) continue;
    // keep transparent / chrome pieces for accents and lamps only
    const fin = colors.get(Number(c))?.finish;
    if (r !== 'accent' && r !== 'lamp' && fin && fin !== 'solid') continue;
    const dist = colorDistance(want, colors.get(Number(c))?.hex);
    // things that should look real (leaves, trunk, stripes…) never borrow a wildly different colour
    if (strictRoles && ROLE_HEX[r] && dist > 150) continue;
    const d = dist - Math.min(n, 20);
    if (d < bestD) { bestD = d; best = Number(c); }
  }
  return best >= 0 ? best : null;
}

// ---------------------------------------------------------------- packing
interface Placed { part: string; color: number; x: number; z: number; W: number; D: number; yaw: number; fc: [number, number]; kind: 'brick' | 'plate'; role: Role }

const DIRS: Record<Dir, [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
/** Yaw (multiple of 90°) that turns a part-local direction into a target direction. */
function yawFor(local: [number, number], target: [number, number]) {
  for (const yaw of [0, 90, 180, 270]) {
    const t = (yaw * Math.PI) / 180;
    const x = local[0] * Math.cos(t) + local[1] * Math.sin(t), z = -local[0] * Math.sin(t) + local[1] * Math.cos(t);
    if (Math.abs(x - target[0]) < 0.01 && Math.abs(z - target[1]) < 0.01) return yaw;
  }
  return 0;
}

function packLayer(layer: Layer, pieces: Piece[], budget: Budget, below: Set<string> | null, palette: Map<Role, number>, colors: Map<number, BrickColor>): { placed: Placed[]; seams: Set<string> } {
  const open = new Map(layer.cells);
  const placed: Placed[] = [];
  const owner = new Map<string, number>();
  const cand = pieces
    .filter((p) => p.kind === layer.kind && (!p.tile || layer.finish))
    .sort((a, b) => b.w * b.d - a.w * a.d);
  const cells = [...open.keys()].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [cx, cz] of cells) {
    if (!open.has(key(cx, cz))) continue;
    const role = open.get(key(cx, cz))!;
    const dir = role.includes('>') ? (role.split('>')[1] as Dir) : null;
    let best: { p: Piece; x: number; z: number; W: number; D: number; yaw: number; color: number; score: number } | null = null;
    for (const p of cand) {
      // slope cells want a slope facing their direction (bricks are the fallback); other cells take any non-slope
      if (!dir && p.slope) continue;
      const options: { W: number; D: number; yaw: number }[] = p.slope && dir
        ? (() => { const yaw = yawFor(p.slope!.down, DIRS[dir]); const along = dir.endsWith('z'); return [{ W: along ? p.w : p.d, D: along ? p.d : p.w, yaw }]; })()
        : [{ W: p.w, D: p.d, yaw: 0 }, { W: p.d, D: p.w, yaw: 90 }];
      for (const o of options) {
        let fits = true;
        for (let x = cx; x < cx + o.W && fits; x++) for (let z = cz; z < cz + o.D && fits; z++) if (open.get(key(x, z)) !== role) fits = false;
        if (!fits) continue;
        const color = chooseColor(budget, p.part, role, palette, colors);
        if (color == null) continue;
        let bridge = 0;
        if (below) for (let x = cx; x < cx + o.W; x++) for (let z = cz; z < cz + o.D; z++) if (below.has(key(x, z))) bridge++;
        // colour fidelity beats size: a smaller piece in the right colour wins over a big one in the wrong colour
        const want = colors.get(palette.get(baseRole(role)) ?? -1)?.hex ?? ROLE_HEX[baseRole(role)];
        // photo pixels: being the right colour outweighs everything; elsewhere it is a strong preference
        const mismatch = want ? colorDistance(want, colors.get(color)?.hex) / (/^c\d+$/.test(role) ? 0.5 : 6) : 0;
        const score = o.W * o.D * 10 + bridge * 3 - mismatch + (p.slope && dir ? 40 : 0) + (p.tile && layer.finish ? 25 : 0);
        if (!best || score > best.score) best = { p, x: cx, z: cz, W: o.W, D: o.D, yaw: o.yaw, color, score };
      }
    }
    if (!best) { open.delete(key(cx, cz)); continue; } // out of parts that fit here: leave a gap
    for (let x = best.x; x < best.x + best.W; x++) for (let z = best.z; z < best.z + best.D; z++) { open.delete(key(x, z)); owner.set(key(x, z), placed.length); }
    budget.set(`${best.p.part}:${best.color}`, budget.get(`${best.p.part}:${best.color}`)! - 1);
    placed.push({ part: best.p.part, color: best.color, x: best.x, z: best.z, W: best.W, D: best.D, yaw: best.yaw, fc: best.p.fc, kind: best.p.kind, role });
  }
  const seams = new Set<string>();
  for (const [k, i] of owner) {
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { const o = owner.get(key(x + dx, z + dz)); if (o != null && o !== i) seams.add(k); }
  }
  return { placed, seams };
}

/** Seeded random (so "Try another design" is repeatable). */
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

export interface GenerateResult { model: GuidedModel; design: Design; used: number; coverage: number }

function budgetOf(inventory: [string, number, number][], pieces: Map<string, Piece>) {
  const base: Budget = new Map();
  for (const [p, c, q] of inventory) if (pieces.has(p)) base.set(`${p}:${c}`, (base.get(`${p}:${c}`) ?? 0) + q);
  return base;
}

function buildLayers(layers: Layer[], pieceList: Piece[], base: Budget, palette: Map<Role, number>, colors: Map<number, BrickColor>) {
  const budget = new Map(base);
  let total = 0, covered = 0;
  let below: Set<string> | null = null;
  const out: Placed[][] = [];
  for (const layer of layers) {
    const { placed, seams } = packLayer(layer, pieceList, budget, below, palette, colors);
    total += layer.cells.size;
    covered += placed.reduce((a, p) => a + p.W * p.D, 0);
    below = seams;
    out.push(placed);
  }
  // colour consistency: share of covered area whose colour is (close to) what its role asked for
  let good = 0;
  for (const l of out) for (const p of l) {
    const want = colors.get(palette.get(baseRole(p.role)) ?? -1)?.hex ?? ROLE_HEX[baseRole(p.role)];
    if (!want || colorDistance(want, colors.get(p.color)?.hex) < 90) good += p.W * p.D;
  }
  return { out, coverage: covered / Math.max(1, total), used: out.reduce((a, l) => a + l.length, 0), consistency: good / Math.max(1, covered) };
}

/** Placed pieces → world transforms, centred on the baseplate, split into steps of ≤ 10 parts, bottom up. */
function toSteps(layers: Placed[][], heights: number[]): Target[][] {
  let maxX = 0, maxZ = 0;
  for (const l of layers) for (const p of l) { maxX = Math.max(maxX, p.x + p.W); maxZ = Math.max(maxZ, p.z + p.D); }
  const ox = -Math.floor(maxX / 2), oz = -Math.floor(maxZ / 2);
  const steps: Target[][] = [];
  let y = 0, n = 0;
  layers.forEach((layer, li) => {
    y += heights[li];
    const step: Target[] = [];
    for (const p of layer) {
      const t = (p.yaw * Math.PI) / 180;
      // footprint centre minus the part's own centre offset (slopes aren't centred on their origin)
      const fx = p.fc[0] * Math.cos(t) + p.fc[1] * Math.sin(t), fz = -p.fc[0] * Math.sin(t) + p.fc[1] * Math.cos(t);
      const quat: Brick['quat'] = [0, +Math.sin(t / 2).toFixed(6), 0, +Math.cos(t / 2).toFixed(6)];
      step.push({ id: `a${n++}`, part: p.part, color: p.color, pos: [+(ox + p.x + p.W / 2 - fx).toFixed(3), +y.toFixed(2), +(oz + p.z + p.D / 2 - fz).toFixed(3)], quat, step: 0 });
      if (step.length === 10) steps.push(step.splice(0));
    }
    if (step.length) steps.push(step);
  });
  steps.forEach((s, i) => s.forEach((t) => (t.step = i)));
  return steps;
}

/**
 * Generate an alternate build from a set's inventory ([part, colour, qty][]).
 * Tries the designs at every size and keeps the largest one the parts can fill well (≥ 92% of cells).
 */
export function generateAlternate(
  set: string, setName: string, inventory: [string, number, number][], parts: Map<string, Part>, colors: Map<number, BrickColor>, seed = 1, only?: Design,
): GenerateResult | null {
  const pieces = standardPieces(parts);
  const base = budgetOf(inventory, pieces);
  if (![...base.values()].some((n) => n > 0)) return null;
  const pieceList = [...pieces.values()].filter((p) => [...base.keys()].some((k) => k.startsWith(p.part + ':')));
  const hasSlopes = pieceList.some((p) => p.slope);

  // palette: most plentiful solid colours become wall / base / roof / accent, shuffled by the seed;
  // "real" roles (trunk, leaves, lamp…) take the set's closest shade to how they should look
  // colour families by how much area the set has in each, separately for bricks, plates and slopes,
  // so a role gets a colour the set can actually cover it with
  const areaBy = (pred: (pc: Piece) => boolean) => {
    const m = new Map<number, number>();
    for (const [k, n] of base) {
      const [pid, c] = k.split(':');
      const pc = pieces.get(pid)!;
      if (!pred(pc) || (colors.get(Number(c))?.finish ?? 'solid') !== 'solid') continue;
      m.set(Number(c), (m.get(Number(c)) ?? 0) + n * pc.w * pc.d);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  };
  const bricksRanked = areaBy((pc) => pc.kind === 'brick' && !pc.slope);
  const platesRanked = areaBy((pc) => pc.kind === 'plate');
  const slopesRanked = areaBy((pc) => !!pc.slope);
  const ranked = bricksRanked.length ? bricksRanked : platesRanked;
  if (!ranked.length) return null;
  const r = rng(seed);
  const pick = (list: number[], i: number) => list.length ? list[Math.min(list.length - 1, Math.floor(r() * Math.min(2, list.length)) + i)] : ranked[0];
  const wall = pick(ranked, 0);
  const palette = new Map<Role, number>([
    ['wall', wall], ['base', pick(platesRanked, 0)], ['roof', slopesRanked[0] ?? pick(ranked.filter((c) => c !== wall), 0)],
    ['accent', pick(ranked.filter((c) => c !== wall), 1)], ['pattern', pick(platesRanked.filter((c) => c !== platesRanked[0]), 0)],
  ]);
  const allColors = [...new Set([...base.keys()].map((k) => Number(k.split(':')[1])))];
  for (const [role, hex] of Object.entries(ROLE_HEX)) {
    const ok = allColors.filter((c) => role === 'lamp' || (colors.get(c)?.finish ?? 'solid') === 'solid');
    let bestC = ranked[0], bestD = Infinity;
    for (const c of ok) { const d = colorDistance(hex, colors.get(c)?.hex); if (d < bestD) { bestD = d; bestC = c; } }
    palette.set(role, bestC);
  }

  const order = only ? [only] : DESIGNS.map((d) => d.id).sort(() => r() - 0.5);
  let best: { layers: Placed[][]; heights: number[]; design: Design; used: number; coverage: number; score: number } | null = null;
  for (const kind of order) for (const strict of [true, false]) {
    strictRoles = strict;
    const before = best?.design;
    let builtThisKind = false;
    for (let s = 1; s <= 8; s++) {
      const layers = design(kind, s, hasSlopes);
      if (!layers.length) break;
      const { out, coverage, used, consistency } = buildLayers(layers, pieceList, base, palette, colors);
      if (coverage < 0.92) break; // too big for this set: bigger sizes only get worse
      // prefer a model that reads as one colour scheme over a bigger rainbow one
      const score = used * consistency * consistency;
      builtThisKind = true;
      if (!best || score > best.score) best = { layers: out, heights: layers.map((l) => (l.kind === 'brick' ? 1.2 : 0.4)), design: kind, used, coverage, score };
    }
    void before;
    if (builtThisKind) break; // the strict pass worked: no need to relax colours for this design
  }
  strictRoles = true;
  if (!best || best.used < 4) return null;
  const label = DESIGNS.find((d) => d.id === best!.design)!.label;
  return {
    model: { set, name: `${label} · alternate build from ${setName}`, steps: toSteps(best.layers, best.heights), alt: { setName, inventory, seed, design: best.design } },
    design: best.design, used: best.used, coverage: best.coverage,
  };
}

/**
 * Photo mosaic: an image (RGBA pixels at size n×n) becomes a stud mosaic in the set's own plate and tile colours.
 * Same-colour runs merge into longer plates; a base layer of plates underneath holds it together.
 */
export function generatePhotoMosaic(
  set: string, setName: string, inventory: [string, number, number][], parts: Map<string, Part>, colors: Map<number, BrickColor>,
  image: { size: number; data: Uint8ClampedArray } | ((n: number) => Uint8ClampedArray),
): GenerateResult | null {
  const pieces = standardPieces(parts);
  const base = budgetOf(inventory, pieces);
  const plates = [...pieces.values()].filter((p) => p.kind === 'plate' && [...base.keys()].some((k) => k.startsWith(p.part + ':')));
  if (!plates.length) return null;
  // the set's flat colours and how much plate area it has in each
  const area = new Map<number, number>();
  for (const [k, cnt] of base) {
    const [pid, c] = k.split(':');
    const pc = pieces.get(pid);
    if (!pc || pc.kind !== 'plate' || (colors.get(Number(c))?.finish ?? 'solid') !== 'solid') continue;
    area.set(Number(c), (area.get(Number(c)) ?? 0) + cnt * pc.w * pc.d);
  }
  const usable = [...area.entries()].filter(([, a]) => a >= 2).map(([c]) => c);
  if (usable.length < 2) return null;
  const sample = typeof image === 'function' ? image : () => image.data;
  const sizes = typeof image === 'function'
    ? Array.from({ length: 21 }, (_, i) => 48 - 2 * i).filter((n) => n >= 8 && n * n <= [...area.values()].reduce((a, b) => a + b, 0))
    : [image.size];

  let bestMosaic: { quality: number; result: GenerateResult } | null = null;
  for (const n of sizes) {
    const data = sample(n);
    // Poster-style: reduce the picture to its few main colours (k-means), then give each region one set colour
    // that has enough plates to fill it. Regions stay solid shapes, so the picture reads even if shades shift.
    const px: [number, number, number][] = [];
    for (let i = 0; i < n * n; i++) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    const k = Math.min(5, usable.length);
    let centres = Array.from({ length: k }, (_, i) => px[Math.floor(((i + 0.5) / k) * px.length)].slice() as [number, number, number]);
    const assign = new Array(px.length).fill(0);
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < px.length; i++) {
        let bi = 0, bd = Infinity;
        centres.forEach((c, j) => { const d = (c[0] - px[i][0]) ** 2 + (c[1] - px[i][1]) ** 2 + (c[2] - px[i][2]) ** 2; if (d < bd) { bd = d; bi = j; } });
        assign[i] = bi;
      }
      centres = centres.map((c, j) => {
        const mine = px.filter((_, i) => assign[i] === j);
        return mine.length ? [0, 1, 2].map((ch) => mine.reduce((a, q) => a + q[ch], 0) / mine.length) as [number, number, number] : c;
      });
    }
    const hexOf = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const clusters = centres.map((c, j) => ({ j, hex: hexOf(c), size: assign.filter((a) => a === j).length })).filter((c) => c.size).sort((a, b) => b.size - a.size);
    const left = new Map(area);
    const chosen = new Map<number, number>();
    for (const cl of clusters) {
      // closest colour wins; being short of plates costs in proportion to the shortfall
      const cost = (c: number) => colorDistance(cl.hex, colors.get(c)?.hex) + 250 * Math.max(0, 1 - (left.get(c) ?? 0) / (cl.size * 1.15));
      const pick = usable.filter((c) => ![...chosen.values()].includes(c)).sort((x, y) => cost(x) - cost(y))[0] ?? usable[0];
      chosen.set(cl.j, pick);
      left.set(pick, (left.get(pick) ?? 0) - cl.size);
    }
    const roles = new Map<string, Role>();
    const palette = new Map<Role, number>();
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const c = chosen.get(assign[z * n + x])!;
      roles.set(key(x, z), `c${c}`);
      palette.set(`c${c}`, c);
    }
    // the picture claims its plates first; the hidden backing layer takes whatever is left
    const budget = new Map(base);
    const face = packLayer({ kind: 'plate', cells: roles, finish: true }, plates, budget, null, palette, colors);
    const covered = face.placed.reduce((a, q) => a + q.W * q.D, 0);
    const faithful = face.placed.filter((q) => q.color === palette.get(q.role)).reduce((a, q) => a + q.W * q.D, 0);
    // score: a big picture is good, but only if it is filled and true to its colours
    const quality = (n * n) * (faithful / (n * n)) ** 2;
    if (covered < n * n * 0.9 && n !== sizes[sizes.length - 1]) continue;
    if (bestMosaic && quality <= bestMosaic.quality) continue;
    palette.set('base', usable[0]);
    const backing = packLayer({ kind: 'plate', cells: rect(n, n, 'base') }, plates, budget, face.seams, palette, colors);
    const used = face.placed.length + backing.placed.length;
    if (used < 4) continue;
    bestMosaic = { quality, result: {
      model: { set, name: `Photo mosaic · alternate build from ${setName}`, steps: toSteps([backing.placed, face.placed], [0.4, 0.4]), alt: { setName, inventory, seed: 0, design: 'photo' } },
      design: 'photo', used, coverage: covered / (n * n),
    } };
  }
  return bestMosaic?.result ?? null;
}
