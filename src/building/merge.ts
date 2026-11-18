import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from './snap';
import { standardPieces } from '../guided/generate';

// Merge & split for plain bricks and plates (like Studio's "splitters"):
//  • split: a W×D brick becomes W·D 1×1 bricks (plates → 1×1 plates), same colour, same place
//  • merge: same-colour, same-height bricks (or plates) whose studs form a filled rectangle become the one
//    part that covers it exactly — e.g. eight 1×1s → a 2×4

const ONE = { brick: '3005', plate: '3024' } as const;

/** Stud-cell centres a placed plain part covers (world x/z), or null for tilted / non-plain parts. */
export function cellsOf(b: Brick, parts: Map<string, Part>) {
  const pieces = standardPieces(parts);
  const pc = pieces.get(b.part);
  if (!pc || pc.tile || pc.slope) return null;
  const q = new THREE.Quaternion(...b.quat);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  if (up.y < 0.999) return null; // tilted: not on the grid
  const out: [number, number][] = [];
  for (let i = 0; i < pc.w; i++) for (let j = 0; j < pc.d; j++) {
    const v = new THREE.Vector3(i - pc.w / 2 + 0.5, 0, j - pc.d / 2 + 0.5).applyQuaternion(q);
    out.push([+(b.pos[0] + v.x).toFixed(2), +(b.pos[2] + v.z).toFixed(2)]);
  }
  return { kind: pc.kind, cells: out };
}

export function splitBrick(b: Brick, parts: Map<string, Part>, newId: () => string): Brick[] | null {
  const c = cellsOf(b, parts);
  if (!c || c.cells.length < 2) return null;
  const one = ONE[c.kind];
  if (!parts.has(one)) return null;
  return c.cells.map(([x, z]) => ({ id: newId(), part: one, color: b.color, pos: [x, b.pos[1], z], quat: [0, 0, 0, 1], group: b.group }));
}

export function mergeBricks(sel: Brick[], parts: Map<string, Part>, newId: () => string): { brick: Brick } | { error: string } {
  if (sel.length < 2) return { error: 'Select two or more bricks or plates to merge.' };
  const color = sel[0].color, y = sel[0].pos[1];
  const all: [number, number][] = [];
  let kind: 'brick' | 'plate' | null = null;
  for (const b of sel) {
    const c = cellsOf(b, parts);
    if (!c) return { error: 'Only plain bricks and plates can be merged.' };
    if (kind && c.kind !== kind) return { error: 'Merge bricks with bricks, or plates with plates.' };
    if (b.color !== color) return { error: 'Merged parts must all be the same colour.' };
    if (Math.abs(b.pos[1] - y) > 0.01) return { error: 'Merged parts must sit at the same height.' };
    kind = c.kind;
    all.push(...c.cells);
  }
  const xs = all.map((c) => c[0]), zs = all.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const W = Math.round(maxX - minX) + 1, D = Math.round(maxZ - minZ) + 1;
  const unique = new Set(all.map(([x, z]) => `${x},${z}`));
  if (unique.size !== all.length || unique.size !== W * D) return { error: "Those parts don't make a filled rectangle." };
  const pieces = [...standardPieces(parts).values()].filter((p) => p.kind === kind && !p.tile && !p.slope);
  const fit = pieces.find((p) => (p.w === W && p.d === D) || (p.w === D && p.d === W));
  if (!fit) return { error: `There is no single ${W} × ${D} ${kind}.` };
  const alongX = fit.w === W; // the part's long side runs along local X
  const q = alongX ? [0, 0, 0, 1] : [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  return { brick: { id: newId(), part: fit.part, color, pos: [+((minX + maxX) / 2).toFixed(3), y, +((minZ + maxZ) / 2).toFixed(3)], quat: q as Brick['quat'], group: sel[0].group } };
}
