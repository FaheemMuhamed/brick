import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';

// Static stability: how hard each joint is working to hold the model together under gravity.
//  • every connection between two parts gets a strength from how many studs (or Technic pins/axles) engage
//  • parts touching the baseplate are supported; the rest hang off the strongest path back to it
//  • a joint's stress = straight pull (parts hanging underneath) + leverage (weight sticking out sideways),
//    divided by what its studs can hold.  ≤0.5 comfortable · 0.5–1 working hard · >1 would come apart

const CLUTCH = 6;        // weight one stud can hold in straight pull (≈ 1.25 bricks 2×4)
const LEVER = 3.5;       // leverage one stud can resist per stud of joint width
const TECHNIC = 2.5;     // a pin or axle connection counts like this many studs

export interface Edge { a: string; b: string; studs: number; point: THREE.Vector3; spread: number }
export interface Stability {
  /** brick id → stress of the joint holding it up (Infinity = not connected to anything that reaches the ground) */
  stress: Map<string, number>;
  weak: { a: string; b: string; stress: number }[];
  floating: string[];
}

interface WC { kind: string; pos: THREE.Vector3; axis: THREE.Vector3; len: number }
const worldConns = (b: Brick, part: Part): WC[] => {
  const p = new THREE.Vector3(...b.pos), q = new THREE.Quaternion(...b.quat);
  return part.connectors.map((c) => ({ kind: c.kind, pos: c.pos.clone().applyQuaternion(q).add(p), axis: c.axis.clone().applyQuaternion(q).normalize(), len: c.len }));
};
const boxOf = (b: Brick, part: Part) =>
  part.box.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1)));

/** All connections between parts, with how many studs / Technic links engage. */
export function connections(bricks: Brick[], parts: Map<string, Part>): Edge[] {
  const live = bricks.filter((b) => !b.hidden && parts.has(b.part));
  const conns = new Map(live.map((b) => [b.id, worldConns(b, parts.get(b.part)!)]));
  const boxes = new Map(live.map((b) => [b.id, boxOf(b, parts.get(b.part)!).expandByScalar(0.3)]));
  const edges: Edge[] = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const A = live[i], B = live[j];
    if (!boxes.get(A.id)!.intersectsBox(boxes.get(B.id)!)) continue;
    let studs = 0;
    const pts: THREE.Vector3[] = [];
    for (const x of conns.get(A.id)!) for (const y of conns.get(B.id)!) {
      const clutch = (x.kind === 'stud' && y.kind === 'anti') || (x.kind === 'anti' && y.kind === 'stud');
      if (clutch && x.pos.distanceTo(y.pos) < 0.08) { studs++; pts.push(x.pos); continue; }
      const male = (k: string) => k === 'axle' || k === 'pin', hole = (k: string) => k === 'axlehole' || k === 'pinhole';
      const m = male(x.kind) && hole(y.kind) ? x : male(y.kind) && hole(x.kind) ? y : null;
      if (!m) continue;
      const h = m === x ? y : x;
      if (Math.abs(m.axis.dot(h.axis)) < 0.98) continue;
      const d = h.pos.clone().sub(m.pos);
      const along = d.dot(m.axis);
      if (d.clone().sub(m.axis.clone().multiplyScalar(along)).length() < 0.08 && Math.abs(along) <= m.len / 2 + h.len / 2) { studs += TECHNIC; pts.push(h.pos); }
    }
    if (!studs) continue;
    const point = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
    let spread = 0;
    for (const p of pts) spread = Math.max(spread, Math.hypot(p.x - point.x, p.z - point.z) * 2);
    edges.push({ a: A.id, b: B.id, studs, point, spread });
  }
  return edges;
}

/** Weight of a part: its body volume (studs excluded), hollow bricks count about half. */
const weightOf = (part: Part) => {
  const s = part.box.getSize(new THREE.Vector3());
  return Math.max(0.05, s.x * s.y * s.z * 0.5);
};

export function analyseStability(bricks: Brick[], parts: Map<string, Part>): Stability {
  const live = bricks.filter((b) => !b.hidden && parts.has(b.part));
  const byId = new Map(live.map((b) => [b.id, b]));
  const edges = connections(live, parts);
  const boxes = new Map(live.map((b) => [b.id, boxOf(b, parts.get(b.part)!)]));
  const GROUND = '__ground__';

  // Strongest path to the ground: maximum spanning tree (Kruskal), the baseplate as one node.
  const all: Edge[] = [...edges];
  for (const b of live) if (boxes.get(b.id)!.min.y < 0.06) {
    const box = boxes.get(b.id)!;
    all.push({ a: GROUND, b: b.id, studs: 99, point: new THREE.Vector3(box.getCenter(new THREE.Vector3()).x, 0, box.getCenter(new THREE.Vector3()).z), spread: 9 });
  }
  all.sort((x, y) => y.studs - x.studs);
  const parent = new Map<string, string>([[GROUND, GROUND], ...live.map((b) => [b.id, b.id] as [string, string])]);
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const tree = new Map<string, Edge[]>();
  const link = (e: Edge, x: string) => { if (!tree.has(x)) tree.set(x, []); tree.get(x)!.push(e); };
  for (const e of all) {
    const ra = find(e.a), rb = find(e.b);
    if (ra === rb) continue;
    parent.set(ra, rb);
    link(e, e.a); link(e, e.b);
  }

  // Walk the tree from the ground; each part remembers the joint that holds it up.
  const holder = new Map<string, { edge: Edge; parent: string }>();
  const order: string[] = [];
  const seen = new Set([GROUND]);
  const queue = [GROUND];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of tree.get(n) ?? []) {
      const other = e.a === n ? e.b : e.a;
      if (seen.has(other)) continue;
      seen.add(other);
      holder.set(other, { edge: e, parent: n });
      order.push(other);
      queue.push(other);
    }
  }

  // Weight and centre of mass of everything hanging from each part (leaves first).
  const mass = new Map<string, number>();
  const com = new Map<string, THREE.Vector3>();
  for (const id of order) {
    const b = byId.get(id)!;
    mass.set(id, weightOf(parts.get(b.part)!));
    com.set(id, boxes.get(id)!.getCenter(new THREE.Vector3()));
  }
  for (const id of [...order].reverse()) {
    const h = holder.get(id)!;
    if (h.parent === GROUND) continue;
    const m = mass.get(id)!, pm = mass.get(h.parent)!;
    com.set(h.parent, com.get(h.parent)!.clone().multiplyScalar(pm).add(com.get(id)!.clone().multiplyScalar(m)).divideScalar(pm + m));
    mass.set(h.parent, pm + m);
  }

  const stress = new Map<string, number>();
  const weak: Stability['weak'] = [];
  for (const id of order) {
    const { edge, parent: p } = holder.get(id)!;
    if (p === GROUND) { stress.set(id, 0); continue; }
    const load = mass.get(id)!;
    const c = com.get(id)!;
    // hanging underneath its holder = straight pull on the studs; sitting on top = pushed together (free)
    const hanging = boxes.get(id)!.getCenter(new THREE.Vector3()).y < edge.point.y - 0.05;
    const lever = Math.hypot(c.x - edge.point.x, c.z - edge.point.z);
    const s = (hanging ? load / (edge.studs * CLUTCH) : 0) + (load * lever) / (edge.studs * LEVER * (1 + edge.spread));
    stress.set(id, s);
    if (s > 1) weak.push({ a: edge.a, b: edge.b, stress: s });
  }
  const floating = live.filter((b) => !seen.has(b.id)).map((b) => b.id);
  for (const id of floating) stress.set(id, Infinity);
  return { stress, weak, floating };
}
