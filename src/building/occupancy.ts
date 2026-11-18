import * as THREE from 'three';
import type { Part } from '../data/library';

// Voxel occupancy per part, built from its real geometry: one cell per stud (x, z) × plate height (y).
// Lets L-shaped, round and sloped parts interlock without their bounding boxes "colliding".

export const CELL_XZ = 1;
export const CELL_Y = 0.4;

export interface Occupancy {
  /** local cell centres (part space, world scale) of occupied cells */
  centres: THREE.Vector3[];
}

const occ = new Map<string, Occupancy>();
export const getOccupancy = (id: string) => occ.get(id);

/** Build occupancy from the part's merged render geometry (must carry a BVH). */
export function buildOccupancy(part: Part, geometries: THREE.BufferGeometry[]) {
  if (occ.has(part.id)) return;
  const b = part.box;
  const nx = Math.max(1, Math.round((b.max.x - b.min.x) / CELL_XZ));
  const ny = Math.max(1, Math.round((b.max.y - b.min.y) / CELL_Y));
  const nz = Math.max(1, Math.round((b.max.z - b.min.z) / CELL_XZ));
  if (nx * ny * nz > 6000) { occ.set(part.id, { centres: [] }); return; } // huge baseplates: box test is fine
  const I = new THREE.Matrix4();
  const cell = new THREE.Box3();
  const centres: THREE.Vector3[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const c = new THREE.Vector3(b.min.x + (i + 0.5) * CELL_XZ, b.min.y + (j + 0.5) * CELL_Y, b.min.z + (k + 0.5) * CELL_XZ);
    // shrink each cell by 0.05: walls lying exactly on a cell boundary (shared with a neighbour) do not count
    cell.min.set(c.x - 0.45, c.y - 0.15, c.z - 0.45);
    cell.max.set(c.x + 0.45, c.y + 0.15, c.z + 0.45);
    if (geometries.some((g) => (g as any).boundsTree?.intersectsBox(cell, I))) centres.push(c);
  }
  occ.set(part.id, { centres });
}

const isGridRotation = (q: THREE.Quaternion) => {
  // rotations made only of quarter turns about Y keep cells on the world grid
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  const quarter = (a: number) => Math.abs(a / (Math.PI / 2) - Math.round(a / (Math.PI / 2))) < 1e-3;
  return Math.abs(e.x) < 1e-3 && Math.abs(e.z) < 1e-3 && quarter(e.y);
};

const key = (v: THREE.Vector3) => `${Math.round(v.x * 2)},${Math.round(v.y * 5)},${Math.round(v.z * 2)}`;

/** World cell keys for a placed part, or null when occupancy is unknown / rotation is off-grid. */
export function worldCells(part: Part, pos: THREE.Vector3, quat: THREE.Quaternion): Set<string> | null {
  const o = occ.get(part.id);
  if (!o || !o.centres.length || !isGridRotation(quat)) return null;
  const out = new Set<string>();
  const v = new THREE.Vector3();
  for (const c of o.centres) out.add(key(v.copy(c).applyQuaternion(quat).add(pos)));
  return out;
}

/** Any orientation made of quarter turns (tilted / on its side): every rotated axis lines up with a world axis. */
const isQuarterRotation = (q: THREE.Quaternion) => {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  return [0, 1, 2, 4, 5, 6, 8, 9, 10].every((i) => Math.abs(e[i]) < 1e-3 || Math.abs(Math.abs(e[i]) - 1) < 1e-3);
};

/**
 * World boxes of a placed part's occupied cells, for parts turned onto their side, where cells no longer sit
 * on the plate-height grid. Each cell is shrunk slightly so faces that only touch don't count. Null when unknown.
 */
export function worldCellBoxes(part: Part, pos: THREE.Vector3, quat: THREE.Quaternion): THREE.Box3[] | null {
  const o = occ.get(part.id);
  if (!o || !o.centres.length || !isQuarterRotation(quat)) return null;
  const half = new THREE.Vector3(0.45, 0.15, 0.45).applyQuaternion(quat);
  half.set(Math.abs(half.x), Math.abs(half.y), Math.abs(half.z));
  return o.centres.map((c) => {
    const w = c.clone().applyQuaternion(quat).add(pos);
    return new THREE.Box3(w.clone().sub(half), w.clone().add(half));
  });
}

/** Is there material in the cell just above this local point? (used to drop phantom anti-studs) */
export function occupiedAt(part: Part, local: THREE.Vector3) {
  const o = occ.get(part.id);
  if (!o || !o.centres.length) return true;
  return o.centres.some((c) => Math.abs(c.x - local.x) < 0.3 && Math.abs(c.z - local.z) < 0.3 && c.y - local.y > 0 && c.y - local.y < CELL_Y * 1.01);
}

if (import.meta.env.DEV && typeof window !== 'undefined') (window as any).__occ = { getOccupancy, worldCells };
