import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';
import { chainWheels } from './chain';

// Kinematic mechanisms: which parts move together, which joints turn, which gears mesh, and how fast
// everything spins when one part is driven. Pure functions (no rendering) so they can be unit-tested.

export type JointKind = 'fixed' | 'revolute';
export interface Joint { a: string; b: string; kind: JointKind; point: THREE.Vector3; axis: THREE.Vector3 }
export interface Gear { brick: string; teeth: number; centre: THREE.Vector3; axis: THREE.Vector3 }
export interface Mesh { a: string; b: string; ratio: number } // ω_b = ratio · ω_a
export interface Graph {
  joints: Joint[];
  bodyOf: Map<string, string>;          // brick id → body id (root brick id)
  bodies: Map<string, string[]>;        // body id → brick ids
  gears: Gear[];
  meshes: Mesh[];
}
export interface Motion {
  /** angular speed (radians / second) about `axis` through `pivot`, per moving body */
  spin: Map<string, { omega: number; axis: THREE.Vector3; pivot: THREE.Vector3 }>;
  jammed: boolean;
  /** parts that turn */
  moving: number;
}

const MALE = new Set(['axle', 'pin']);
const HOLE = new Set(['axlehole', 'pinhole']);

interface WConn { kind: string; pos: THREE.Vector3; axis: THREE.Vector3; len: number }
function worldConns(b: Brick, part: Part): WConn[] {
  const p = new THREE.Vector3(...b.pos), q = new THREE.Quaternion(...b.quat);
  return part.connectors.map((c) => ({ kind: c.kind, pos: c.pos.clone().applyQuaternion(q).add(p), axis: c.axis.clone().applyQuaternion(q).normalize(), len: c.len }));
}

function worldBox(b: Brick, part: Part, grow: number) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
  return part.box.clone().applyMatrix4(m).expandByScalar(grow);
}

/** Does a male connector (axle/pin) pass through a hole? */
function engages(male: WConn, hole: WConn) {
  if (Math.abs(male.axis.dot(hole.axis)) < 0.98) return false;
  const d = hole.pos.clone().sub(male.pos);
  const along = d.dot(male.axis);
  const perp = d.clone().sub(male.axis.clone().multiplyScalar(along)).length();
  return perp < 0.08 && Math.abs(along) <= male.len / 2 + hole.len / 2 - 0.05;
}

const pinGear = (part: Part) => part.teeth && part.teeth >= 8 && part.cat === 52;
/** Technic gear pitch radius: 8T↔24T sit 2 studs apart, so r = teeth / 16 studs. */
export const gearRadius = (teeth: number) => teeth / 16;

export function buildGraph(bricks: Brick[], parts: Map<string, Part>): Graph {
  const live = bricks.filter((b) => !b.hidden && parts.has(b.part));
  const conns = new Map(live.map((b) => [b.id, worldConns(b, parts.get(b.part)!)]));
  const boxes = new Map(live.map((b) => [b.id, worldBox(b, parts.get(b.part)!, 0.25)]));
  const joints: Joint[] = [];

  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const A = live[i], B = live[j];
    if (!boxes.get(A.id)!.intersectsBox(boxes.get(B.id)!)) continue;
    const ca = conns.get(A.id)!, cb = conns.get(B.id)!;
    let found: Joint | null = null;
    for (const x of ca) {
      for (const y of cb) {
        // stud ↔ anti-stud clutch: rigid
        if ((x.kind === 'stud' && y.kind === 'anti') || (x.kind === 'anti' && y.kind === 'stud')) {
          if (x.pos.distanceTo(y.pos) < 0.08) { found = { a: A.id, b: B.id, kind: 'fixed', point: x.pos.clone(), axis: new THREE.Vector3(0, 1, 0) }; break; }
          continue;
        }
        const male = MALE.has(x.kind) && HOLE.has(y.kind) ? x : MALE.has(y.kind) && HOLE.has(x.kind) ? y : null;
        if (!male) continue;
        const hole = male === x ? y : x;
        if (!engages(male, hole)) continue;
        // an axle in an axle-shaped hole is locked; anything round turns freely
        const kind: JointKind = male.kind === 'axle' && hole.kind === 'axlehole' ? 'fixed' : 'revolute';
        const j: Joint = { a: A.id, b: B.id, kind, point: hole.pos.clone(), axis: hole.axis.clone() };
        if (kind === 'fixed') { found = j; break; }
        found ??= j;
      }
      if (found?.kind === 'fixed') break;
    }
    if (found) joints.push(found);
  }

  // rigid bodies: union-find over fixed joints
  const parent = new Map(live.map((b) => [b.id, b.id]));
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const j of joints) if (j.kind === 'fixed') parent.set(find(j.a), find(j.b));
  const bodyOf = new Map(live.map((b) => [b.id, find(b.id)]));
  const bodies = new Map<string, string[]>();
  for (const [id, body] of bodyOf) { if (!bodies.has(body)) bodies.set(body, []); bodies.get(body)!.push(id); }

  // gears and meshing
  const gears: Gear[] = [];
  for (const b of live) {
    const part = parts.get(b.part)!;
    if (!pinGear(part)) continue;
    const hub = conns.get(b.id)!.find((c) => c.kind === 'axlehole' || c.kind === 'pinhole');
    if (!hub) continue;
    gears.push({ brick: b.id, teeth: part.teeth!, centre: hub.pos.clone(), axis: hub.axis.clone() });
  }
  const meshes: Mesh[] = [];
  for (let i = 0; i < gears.length; i++) for (let j = i + 1; j < gears.length; j++) {
    const g = gears[i], h = gears[j];
    if (Math.abs(g.axis.dot(h.axis)) < 0.98) continue; // parallel spur gears only (bevel/worm: later)
    const d = h.centre.clone().sub(g.centre);
    const along = d.dot(g.axis);
    if (Math.abs(along) > 0.3) continue; // not in the same plane
    const dist = d.clone().sub(g.axis.clone().multiplyScalar(along)).length();
    if (Math.abs(dist - (gearRadius(g.teeth) + gearRadius(h.teeth))) > 0.12) continue;
    meshes.push({ a: g.brick, b: h.brick, ratio: -g.teeth / h.teeth });
  }
  // chains and tracks: every wheel on a loop shares one surface speed, so neighbours turn the same way at r_a / r_b
  const byId = new Map(bricks.map((b) => [b.id, b]));
  for (const c of bricks) {
    if (!c.chain || c.hidden) continue;
    const ws = chainWheels(c, byId, parts);
    if (!ws || ws.length < 2) continue;
    for (let i = 0; i < ws.length; i++) {
      const a = ws[i], b = ws[(i + 1) % ws.length];
      if (ws.length === 2 && i === 1) break;
      meshes.push({ a: a.id, b: b.id, ratio: a.r / b.r });
    }
  }
  return { joints, bodyOf, bodies, gears, meshes };
}

/** Spin `driver` at `omega` rad/s and propagate through rigid bodies and meshing gears. */
export function solve(graph: Graph, driver: string, omega: number): Motion {
  const spin: Motion['spin'] = new Map();
  const start = graph.bodyOf.get(driver);
  if (!start) return { spin, jammed: false, moving: 0 };
  const axisFor = (body: string, preferBrick?: string) => {
    const members = new Set(graph.bodies.get(body));
    const gear = graph.gears.find((g) => g.brick === preferBrick) ?? graph.gears.find((g) => members.has(g.brick));
    if (gear) return { axis: gear.axis.clone(), pivot: gear.centre.clone() };
    const j = graph.joints.find((j) => j.kind === 'revolute' && (members.has(j.a) !== members.has(j.b)));
    if (j) return { axis: j.axis.clone(), pivot: j.point.clone() };
    return null;
  };
  const first = axisFor(start, driver);
  if (!first) return { spin, jammed: false, moving: 0 };
  spin.set(start, { omega, ...first });
  let jammed = false;
  const queue = [start];
  while (queue.length) {
    const body = queue.shift()!;
    const w = spin.get(body)!.omega;
    for (const m of graph.meshes) {
      for (const [from, to, ratio] of [[m.a, m.b, m.ratio], [m.b, m.a, 1 / m.ratio]] as const) {
        if (graph.bodyOf.get(from) !== body) continue;
        const other = graph.bodyOf.get(to)!;
        const want = w * ratio;
        const seen = spin.get(other);
        if (seen) { if (Math.abs(seen.omega - want) > 1e-6) jammed = true; continue; }
        const ax = axisFor(other, to)!;
        // keep axis directions consistent so signs of ω mean the same thing across parallel gears
        if (ax.axis.dot(spin.get(body)!.axis) < 0) ax.axis.negate();
        spin.set(other, { omega: want, ...ax });
        queue.push(other);
      }
    }
  }
  if (jammed) for (const v of spin.values()) v.omega = 0;
  let moving = 0;
  for (const [body] of spin) moving += graph.bodies.get(body)?.length ?? 0;
  return { spin, jammed, moving };
}

/** Transform of a brick after its body has turned by `angle` (radians). */
export function turned(b: Brick, axis: THREE.Vector3, pivot: THREE.Vector3, angle: number) {
  const r = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  const pos = new THREE.Vector3(...b.pos).sub(pivot).applyQuaternion(r).add(pivot);
  const quat = r.multiply(new THREE.Quaternion(...b.quat));
  return { pos, quat };
}
