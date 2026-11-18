import * as THREE from 'three';
import { Line } from '@react-three/drei';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';

// Flexible hoses (Technic soft axles, pneumatic tubing): a tube between two ends that leaves each end straight
// out along its direction and sags a little under its own weight. Stored as an ordinary "part" so moving,
// grouping, painting, deleting and undo all just work: pos/quat place the start, `hose` holds the rest locally.

export const HOSE_PART = 'hose';
export const HOSE_RADIUS = 0.15; // ≈ a Technic flex hose

/** Local cubic Bézier: start at the origin, end at b, leaving along na / arriving along nb. */
export function hoseCurve(h: NonNullable<Brick['hose']>) {
  const a = new THREE.Vector3(0, 0, 0);
  const b = new THREE.Vector3(...h.b);
  const na = new THREE.Vector3(...h.na).normalize();
  const nb = new THREE.Vector3(...h.nb).normalize();
  const dist = a.distanceTo(b);
  const reach = THREE.MathUtils.clamp(dist * 0.45, 0.6, 4);
  const sag = new THREE.Vector3(0, -(h.sag ?? Math.min(dist * 0.18, 2)), 0);
  return new THREE.CubicBezierCurve3(a, a.clone().addScaledVector(na, reach).add(sag), b.clone().addScaledVector(nb, reach).add(sag), b);
}

const geoCache = new Map<string, THREE.TubeGeometry>();
export function hoseGeometry(h: NonNullable<Brick['hose']>) {
  const key = JSON.stringify(h);
  let g = geoCache.get(key);
  if (!g) {
    const curve = hoseCurve(h);
    g = new THREE.TubeGeometry(curve, Math.max(24, Math.round(curve.getLength() * 10)), h.r ?? HOSE_RADIUS, 14, false);
    geoCache.set(key, g);
  }
  return g;
}

export const hoseLength = (h: NonNullable<Brick['hose']>) => hoseCurve(h).getLength();

/** Make a hose brick from two world-space ends with outward directions. */
export function makeHose(id: string, color: number, a: THREE.Vector3, na: THREE.Vector3, b: THREE.Vector3, nb: THREE.Vector3): Brick {
  const r = (v: THREE.Vector3) => v.toArray().map((x) => +x.toFixed(4)) as [number, number, number];
  // droop with length, but never through the floor
  const sag = Math.max(0, Math.min(a.distanceTo(b) * 0.18, 2, Math.min(a.y, b.y) - HOSE_RADIUS * 2));
  return { id, part: HOSE_PART, color, pos: r(a), quat: [0, 0, 0, 1], hose: { b: r(b.clone().sub(a)), na: r(na), nb: r(nb), r: HOSE_RADIUS, sag: +sag.toFixed(3) } };
}

/** Where a hose end attaches: a Technic hole/pin/axle near the click (pointing out of it), or the surface itself. */
export function hoseAnchor(hit: THREE.Vector3, normal: THREE.Vector3, brick: Brick | null, part?: Part) {
  if (brick && part) {
    const p = new THREE.Vector3(...brick.pos), q = new THREE.Quaternion(...brick.quat);
    let best: { pos: THREE.Vector3; dir: THREE.Vector3; d: number } | null = null;
    for (const c of part.connectors) {
      if (!['pinhole', 'axlehole', 'pin', 'axle'].includes(c.kind)) continue;
      const pos = c.pos.clone().applyQuaternion(q).add(p);
      const axis = c.axis.clone().applyQuaternion(q).normalize();
      // the end of the hole/pin on the side that was clicked
      const side = Math.sign(hit.clone().sub(pos).dot(axis)) || 1;
      const end = pos.clone().addScaledVector(axis, side * c.len / 2);
      const d = end.distanceTo(hit);
      if (d < 0.7 && (!best || d < best.d)) best = { pos: end, dir: axis.multiplyScalar(side), d };
    }
    if (best) return { pos: best.pos, dir: best.dir, snapped: true };
  }
  return { pos: hit.clone().addScaledVector(normal, HOSE_RADIUS), dir: normal.clone().normalize(), snapped: false };
}

/** Dashed preview from the first end to the cursor while placing a hose. */
export function HosePreview({ a, b }: { a: number[]; b: number[] }) {
  return <Line points={[new THREE.Vector3(...a), new THREE.Vector3(...b)]} color="#111" lineWidth={2} dashed dashSize={0.2} gapSize={0.12} depthTest={false} />;
}
