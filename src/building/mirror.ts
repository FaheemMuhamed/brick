import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from './snap';

// Mirror: reflect a selection across a vertical plane. A real brick can't be "flipped inside out", so each part
// is either swapped for its left/right counterpart (wedge plates, wings…) or, for a symmetric part, turned so it
// looks mirrored: rotation' = M · R · S, where M reflects the world and S reflects the part along an axis it is
// symmetric about (both reflections cancel into an ordinary rotation).

export type MirrorAxis = 'x' | 'z';

const reflect = (axis: 'x' | 'y' | 'z') => new THREE.Matrix4().makeScale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1);

/** Local axis a part is mirror-symmetric about (its footprint is centred on the origin along it). */
function symmetryAxis(part: Part): 'x' | 'z' {
  if (part.mirror) return 'x'; // LDraw left/right pairs mirror each other across their local X
  const c = part.box.getCenter(new THREE.Vector3());
  if (Math.abs(c.x) < 0.02) return 'x';
  if (Math.abs(c.z) < 0.02) return 'z';
  return 'x';
}

/** Selection bounds (for choosing where the mirror plane goes). */
export function boundsOf(bricks: Brick[], parts: Map<string, Part>) {
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const b of bricks) {
    const p = parts.get(b.part);
    if (!p) continue;
    m.compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
    box.union(p.box.clone().applyMatrix4(m));
  }
  return box;
}

export function mirrorBricks(bricks: Brick[], parts: Map<string, Part>, axis: MirrorAxis, plane: number): Brick[] {
  const M = reflect(axis);
  return bricks.map((b) => {
    const part = parts.get(b.part);
    if (!part) return b;
    const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...b.quat));
    const S = reflect(symmetryAxis(part));
    const q = new THREE.Quaternion().setFromRotationMatrix(M.clone().multiply(R).multiply(S)).normalize();
    const pos: Brick['pos'] = [...b.pos];
    const i = axis === 'x' ? 0 : 2;
    pos[i] = +(2 * plane - pos[i]).toFixed(4);
    return { ...b, part: part.mirror && parts.has(part.mirror) ? part.mirror : b.part, pos, quat: q.toArray().map((v) => +v.toFixed(6)) as Brick['quat'] };
  });
}
