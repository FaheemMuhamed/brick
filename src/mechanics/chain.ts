import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';

// Chains and tracks: a loop of links wrapped around gears or tread sprockets that share a plane.
// Stored as a "part" (part = 'chain') that only lists its wheels; the path is recomputed from where
// the wheels are now, so moving a wheel re-routes the chain. Every wheel on a loop turns the same way,
// at a speed set by its radius (the links all move at one surface speed).

export const CHAIN_PART = 'chain';
/** parts drawn from their own data (hoses, chains) rather than an LDraw file */
export const isVirtualPart = (id: string) => id === 'hose' || id === CHAIN_PART;
export const LINK = { chain: { part: '3711', color: 72, pitch: 0.8 }, tread: { part: '3873', color: 0, pitch: 0.8 } } as const;

export interface Wheel { id: string; centre: THREE.Vector3; axis: THREE.Vector3; r: number }

/** A gear or tread sprocket as a wheel the chain can run on (null for anything else). */
export function wheelOf(b: Brick, part?: Part): Wheel | null {
  if (!part || (!part.teeth && !part.sprocket)) return null;
  const hub = part.connectors.find((c) => c.kind === 'axlehole' || c.kind === 'pinhole');
  if (!hub) return null;
  const q = new THREE.Quaternion(...b.quat);
  const size = part.box.getSize(new THREE.Vector3());
  // gears: on the pitch circle (teeth / 16 studs); sprockets: just inside the tooth tips
  const r = part.teeth ? part.teeth / 16 : (Math.max(size.x, size.y, size.z) / 2) * 0.88;
  return { id: b.id, centre: hub.pos.clone().applyQuaternion(q).add(new THREE.Vector3(...b.pos)), axis: hub.axis.clone().applyQuaternion(q).normalize(), r };
}

type Piece = { kind: 'line'; a: THREE.Vector2; b: THREE.Vector2; len: number } | { kind: 'arc'; c: THREE.Vector2; r: number; a0: number; da: number; len: number };

export interface ChainPath {
  length: number;
  normal: THREE.Vector3;
  /** wheels in travel order (counter-clockwise about `normal`) */
  wheels: Wheel[];
  /** point, travel direction and outward normal at distance s along the loop */
  at(s: number): { pos: THREE.Vector3; tangent: THREE.Vector3; out: THREE.Vector3 };
}

/** The belt path around wheels in loop order, or an error when they can't carry one chain. */
export function chainPath(input: Wheel[]): ChainPath | { error: string } {
  if (input.length < 2) return { error: 'A chain needs at least two wheels.' };
  const N = input[0].axis.clone().normalize();
  for (const w of input) {
    if (Math.abs(w.axis.dot(N)) < 0.98) return { error: 'All wheels must face the same way (parallel axles).' };
    if (Math.abs(w.centre.clone().sub(input[0].centre).dot(N)) > 0.4) return { error: 'All wheels must sit in one line, side by side.' };
  }
  const O = input[0].centre.clone();
  const U = new THREE.Vector3().crossVectors(N, Math.abs(N.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const V = new THREE.Vector3().crossVectors(N, U);
  const to2 = (p: THREE.Vector3) => { const d = p.clone().sub(O); return new THREE.Vector2(d.dot(U), d.dot(V)); };
  const to3 = (p: THREE.Vector2) => O.clone().addScaledVector(U, p.x).addScaledVector(V, p.y);
  const dir3 = (d: THREE.Vector2) => new THREE.Vector3().addScaledVector(U, d.x).addScaledVector(V, d.y);

  let wheels = input;
  const pts = () => wheels.map((w) => to2(w.centre));
  // travel counter-clockwise, so the outside of the loop is always on the right
  let area = 0;
  const P0 = pts();
  for (let i = 0; i < P0.length; i++) { const a = P0[i], b = P0[(i + 1) % P0.length]; area += a.x * b.y - b.x * a.y; }
  if (area < 0) wheels = [...wheels].reverse();
  const P = pts();
  const n = wheels.length;

  // outward normal of the outer tangent on each span i → i+1
  const normals: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const A = P[i], B = P[(i + 1) % n], rA = wheels[i].r, rB = wheels[(i + 1) % n].r;
    const d = B.clone().sub(A);
    const L = d.length();
    if (L < Math.abs(rA - rB) + 0.05) return { error: 'Two wheels overlap.' };
    const e = d.divideScalar(L);
    const right = new THREE.Vector2(e.y, -e.x);
    const phi = Math.asin((rA - rB) / L);
    normals.push(right.multiplyScalar(Math.cos(phi)).addScaledVector(e, Math.sin(phi)).normalize());
  }
  const pieces: Piece[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = P[i].clone().addScaledVector(normals[i], wheels[i].r);
    const b = P[j].clone().addScaledVector(normals[i], wheels[j].r);
    pieces.push({ kind: 'line', a, b, len: a.distanceTo(b) });
    const a0 = Math.atan2(normals[i].y, normals[i].x);
    const a1 = Math.atan2(normals[j].y, normals[j].x);
    let da = a1 - a0;
    while (da < 0) da += Math.PI * 2;
    while (da >= Math.PI * 2) da -= Math.PI * 2;
    pieces.push({ kind: 'arc', c: P[j], r: wheels[j].r, a0, da, len: da * wheels[j].r });
  }
  const length = pieces.reduce((t, p) => t + p.len, 0);
  return {
    length, normal: N, wheels,
    at(s) {
      s = ((s % length) + length) % length;
      for (const p of pieces) {
        if (s > p.len && p !== pieces[pieces.length - 1]) { s -= p.len; continue; }
        if (p.kind === 'line') {
          const t = p.len ? s / p.len : 0;
          const d = p.b.clone().sub(p.a).normalize();
          return { pos: to3(p.a.clone().lerp(p.b, t)), tangent: dir3(d), out: dir3(new THREE.Vector2(d.y, -d.x)) };
        }
        const ang = p.a0 + s / p.r;
        const o = new THREE.Vector2(Math.cos(ang), Math.sin(ang));
        return { pos: to3(p.c.clone().addScaledVector(o, p.r)), tangent: dir3(new THREE.Vector2(-o.y, o.x)), out: dir3(o) };
      }
      throw new Error('unreachable');
    },
  };
}

/** Wheels of a chain brick, as they sit in the build now. */
export function chainWheels(chain: Brick, byId: Map<string, Brick>, parts: Map<string, Part>): Wheel[] | null {
  const out: Wheel[] = [];
  for (const id of chain.chain?.wheels ?? []) {
    const b = byId.get(id);
    const w = b && !b.hidden ? wheelOf(b, parts.get(b.part)) : null;
    if (!w) return null;
    out.push(w);
  }
  return out;
}

/** Link poses along the loop, `offset` studs further along (for a running chain). */
export function linkPoses(path: ChainPath, pitch: number, offset = 0) {
  const count = Math.max(3, Math.round(path.length / pitch));
  const step = path.length / count;
  const m = new THREE.Matrix4();
  const out: THREE.Matrix4[] = [];
  for (let i = 0; i < count; i++) {
    const { pos, tangent, out: o } = path.at(i * step + offset);
    // link model: long axis −z (towards the next link), thickness along y (outwards), width across the chain
    const x = path.normal.clone().negate(), y = o, z = tangent.clone().negate();
    m.makeBasis(x, y, z).setPosition(pos);
    out.push(m.clone());
  }
  return out;
}
