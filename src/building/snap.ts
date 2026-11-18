import * as THREE from 'three';
import type { Part } from '../data/library';
import { occupiedAt, worldCellBoxes, worldCells } from './occupancy';

export interface Brick {
  id: string;
  part: string;
  color: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  hidden?: boolean;
  /** parts sharing a group id move, copy and select together */
  group?: string;
  /** flexible hose: end point and end directions, relative to pos/quat (part = 'hose') */
  hose?: { b: number[]; na: number[]; nb: number[]; r: number; sag?: number };
  /** chain or track loop (part = 'chain'): the gears / sprockets it runs on, in loop order */
  chain?: { kind: 'chain' | 'tread'; wheels: string[] };
  /** building step (0-based) authored in the step editor */
  step?: number;
  /** part of a linked submodel copy */
  link?: { def: string; inst: string; local: string };
}

export interface Placement { pos: THREE.Vector3; quat: THREE.Quaternion; valid: boolean; snapped: boolean }

const tmp = new THREE.Vector3();

export function brickMatrix(b: Pick<Brick, 'pos' | 'quat'>, out = new THREE.Matrix4()) {
  return out.compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
}

/** World AABB of the part body, shrunk slightly so touching faces don't count as collisions. */
export function worldBox(part: Part, pos: THREE.Vector3, quat: THREE.Quaternion, shrink = 0.04) {
  const m = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
  const b = part.box.clone().applyMatrix4(m);
  b.min.addScalar(shrink);
  b.max.subScalar(shrink);
  return b;
}

/** World-space connectors of a placed brick. */
export function worldConnectors(part: Part, pos: THREE.Vector3, quat: THREE.Quaternion, kind?: string) {
  const res: THREE.Vector3[] = [];
  for (const c of part.connectors) {
    if (kind && c.kind !== kind) continue;
    if (kind === 'stud' && c.axis.y < 0.9) continue; // only upward studs (unless rotated)
    res.push(c.pos.clone().applyQuaternion(quat).add(pos));
  }
  return res;
}

export interface SnapContext {
  parts: Map<string, Part>;
  bricks: Brick[];
  /** ignore these brick ids (e.g. the ones being moved) */
  ignore?: Set<string>;
}

/** Ground acts like an endless baseplate with studs at half-integers on y = 0. */
function groundStuds(hit: THREE.Vector3, radius = 4) {
  const out: THREE.Vector3[] = [];
  const cx = Math.floor(hit.x), cz = Math.floor(hit.z);
  for (let i = -radius; i <= radius; i++) for (let j = -radius; j <= radius; j++) out.push(new THREE.Vector3(cx + i + 0.5, 0, cz + j + 0.5));
  return out;
}

/**
 * Find the best snapped placement of `held` (with rotation `quat`) near the pointer hit.
 * `target` = brick under the cursor (null for ground), `normal` = world face normal at the hit.
 */
export function snapPlacement(
  ctx: SnapContext, held: Part, quat: THREE.Quaternion, hit: THREE.Vector3, normal: THREE.Vector3, target: Brick | null, spinTurns = 0,
): Placement {
  if (target) {
    const t = technicSnap(ctx, held, hit, normal, target, spinTurns);
    if (t) return t;
  }
  // Studs and anti-studs carry outward directions (studs up, anti-studs down on a plain brick). A stud takes an
  // anti-stud pointing the opposite way, so a tilted part snaps sideways onto side studs (SNOT) as well.
  // Anti-studs come from the footprint grid; drop the ones under empty corners (L-shaped parts).
  const heldAnti = dirConns(held, 'anti', quat);
  const heldStud = dirConns(held, 'stud', quat);
  const center = held.box.getCenter(new THREE.Vector3()).applyQuaternion(quat);

  let targets: DirConn[] = [];
  let mine: DirConn[] = heldAnti;
  const tp = target ? ctx.parts.get(target.part) : undefined;
  if (!target || !tp) {
    targets = groundStuds(hit).map((pos) => ({ pos, axis: UP })); // ground, or something without studs (a hose)
  } else {
    const tpos = new THREE.Vector3(...target.pos), tq = new THREE.Quaternion(...target.quat);
    const studs = dirConns(tp, 'stud', tq, tpos), antis = dirConns(tp, 'anti', tq, tpos);
    const facing = (c: DirConn) => c.axis.dot(normal) > 0.5;
    if (studs.some(facing)) targets = studs.filter(facing);
    else if (antis.some(facing) && heldStud.length) { targets = antis.filter(facing); mine = heldStud; }
    // clicked a face without studs (the side of a brick): use the studs on top, as before
    else targets = studs.filter((c) => c.axis.y > 0.9);
  }

  let best: THREE.Vector3 | null = null;
  let bestScore = Infinity;
  const want = hit.clone();
  for (const t of targets) for (const m of mine) {
    if (m.axis.dot(t.axis) > -0.9) continue; // must face each other
    const p = tmp.copy(t.pos).sub(m.pos);
    // keep the part's centre near the cursor, measured across the connection (not along it)
    const d = p.clone().add(center).sub(want);
    d.addScaledVector(t.axis, -d.dot(t.axis));
    const score = d.lengthSq();
    if (score < bestScore) { bestScore = score; best = p.clone(); }
  }
  let snapped = !!best;
  if (!best) {
    // no compatible connectors: rest the part on the surface, on the stud grid
    const low = worldBox(held, new THREE.Vector3(), quat, 0).min.y;
    best = new THREE.Vector3(Math.round(hit.x - center.x), hit.y - low, Math.round(hit.z - center.z));
    snapped = false;
  }
  const valid = !collides(ctx, held, best, quat);
  return { pos: best, quat: quat.clone(), valid, snapped };
}

interface DirConn { pos: THREE.Vector3; axis: THREE.Vector3 }
const UP = new THREE.Vector3(0, 1, 0);
function dirConns(part: Part, kind: 'stud' | 'anti', quat: THREE.Quaternion, at?: THREE.Vector3): DirConn[] {
  return part.connectors
    .filter((c) => c.kind === kind && (kind !== 'anti' || occupiedAt(part, c.pos)))
    .map((c) => ({ pos: at ? c.pos.clone().applyQuaternion(quat).add(at) : c.pos.clone().applyQuaternion(quat), axis: c.axis.clone().applyQuaternion(quat).normalize() }));
}

export function collides(ctx: SnapContext, part: Part, pos: THREE.Vector3, quat: THREE.Quaternion) {
  const box = worldBox(part, pos, quat);
  if (box.min.y < -0.05) return true; // below the ground
  let mine: Set<string> | null | undefined;
  let mineBoxes: THREE.Box3[] | null | undefined;
  for (const b of ctx.bricks) {
    if (b.hidden || ctx.ignore?.has(b.id)) continue;
    const p = ctx.parts.get(b.part);
    if (!p) continue;
    const bp = new THREE.Vector3(...b.pos), bq = new THREE.Quaternion(...b.quat);
    if (!worldBox(p, bp, bq).intersectsBox(box)) continue; // broad phase
    // narrow phase: compare real shapes cell by cell (falls back to boxes if a shape isn't known yet)
    if (mine === undefined) mine = worldCells(part, pos, quat);
    const theirs = mine ? worldCells(p, bp, bq) : null;
    if (mine && theirs) {
      for (const k of mine) if (theirs.has(k)) return true;
      continue;
    }
    // a part on its side: its cells are off the plate grid, so compare cell boxes instead
    if (mineBoxes === undefined) mineBoxes = worldCellBoxes(part, pos, quat);
    const theirBoxes = mineBoxes ? worldCellBoxes(p, bp, bq) : null;
    if (!mineBoxes || !theirBoxes) return true;
    for (const a of mineBoxes) for (const b2 of theirBoxes) if (a.intersectsBox(b2)) return true;
  }
  return false;
}

/** Quarter turns about world X (tilt forward/back) and Z (roll), for placing parts on their side. */
export function tiltQuat(tilt: [number, number]) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (tilt[1] * Math.PI) / 2)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (tilt[0] * Math.PI) / 2));
}

/** Quarter-turn rotation about world Y. */
export const yaw90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

if (import.meta.env.DEV && typeof window !== 'undefined') (window as any).__snap = { collides, worldBox, snapPlacement };

// ---------------------------------------------------------------- Technic: pins / axles into holes
const MALE = new Set(['axle', 'pin']);
const HOLE = new Set(['axlehole', 'pinhole']);

/**
 * Snap a Technic connection: the held part's pin/axle slides into a hole of the part under the cursor,
 * or the held part's hole goes onto a pin/axle. R spins the part a quarter turn around that axis.
 * Returns null when nothing Technic is within reach (stud snapping takes over).
 */
export function technicSnap(ctx: SnapContext, held: Part, hit: THREE.Vector3, normal: THREE.Vector3, target: Brick, spinTurns: number): Placement | null {
  const tp = ctx.parts.get(target.part);
  if (!tp) return null;
  const heldT = held.connectors.filter((c) => MALE.has(c.kind) || HOLE.has(c.kind));
  if (!heldT.length) return null;
  const tpos = new THREE.Vector3(...target.pos), tq = new THREE.Quaternion(...target.quat);
  const targetT = tp.connectors
    .filter((c) => MALE.has(c.kind) || HOLE.has(c.kind))
    .map((c) => ({ kind: c.kind, len: c.len, pos: c.pos.clone().applyQuaternion(tq).add(tpos), axis: c.axis.clone().applyQuaternion(tq).normalize() }));
  if (!targetT.length) return null;

  let best: { pos: THREE.Vector3; quat: THREE.Quaternion; score: number } | null = null;
  for (const t of targetT) {
    const tMale = MALE.has(t.kind);
    // which way along the axis the cursor is: insert from that side
    const side = Math.abs(normal.dot(t.axis)) > 0.5 ? Math.sign(normal.dot(t.axis)) : 0;
    for (const h of heldT) {
      if (MALE.has(h.kind) === tMale) continue; // need one male + one hole
      for (const flip of [1, -1]) {
        const qa = new THREE.Quaternion().setFromUnitVectors(h.axis, t.axis.clone().multiplyScalar(flip));
        const qs = new THREE.Quaternion().setFromAxisAngle(t.axis, (spinTurns * Math.PI) / 2);
        const q = qs.multiply(qa);
        const hpos = h.pos.clone().applyQuaternion(q);
        let along: number;
        if (tMale) {
          // our hole slides onto their pin/axle: nearest spot along it, on a half-stud grid
          // nominal lengths: LDraw axles are modelled a hair short (59 LDU for a 3-stud axle)
          const nominal = (l: number) => Math.round(l * 2) / 2;
          const room = Math.max(0, nominal(t.len) / 2 - nominal(h.len) / 2);
          along = THREE.MathUtils.clamp(Math.round(hit.clone().sub(t.pos).dot(t.axis) / 0.5) * 0.5, -room, room);
        } else {
          // our pin/axle goes into their hole, sticking out on the cursor's side
          along = side * Math.max(0, h.len / 2 - t.len / 2);
        }
        const joint = t.pos.clone().add(t.axis.clone().multiplyScalar(tMale ? along : 0));
        const pos = tMale ? joint.clone().sub(hpos) : t.pos.clone().add(t.axis.clone().multiplyScalar(along)).sub(hpos);
        // prefer the orientation whose body ends up on the cursor's side of the joint
        const bodyCentre = held.box.getCenter(new THREE.Vector3()).applyQuaternion(q).add(pos);
        const score = joint.distanceTo(hit) + (side !== 0 && Math.sign(bodyCentre.clone().sub(joint).dot(t.axis)) !== side ? 0.4 : 0);
        if (!best || score < best.score) best = { pos, quat: q, score };
      }
    }
  }
  if (!best || best.score > 1.4) return null;
  // the connected parts interlock by design: only check collisions against everything else
  const valid = !collides({ ...ctx, ignore: new Set([...(ctx.ignore ?? []), target.id]) }, held, best.pos, best.quat);
  return { pos: best.pos, quat: best.quat, valid, snapped: true };
}
