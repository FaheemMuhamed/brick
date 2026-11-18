import * as THREE from 'three';
import type { Brick } from './snap';

// Groups (sub-assemblies): parts sharing a `group` id are selected, moved, copied and deleted together.

let gid = Date.now();
const newGroupId = () => 'g' + (gid++).toString(36);

/** Add every member of any group touched by `ids`. */
export function expandToGroups(ids: Iterable<string>, bricks: Brick[]): string[] {
  const set = new Set(ids);
  const groups = new Set(bricks.filter((b) => set.has(b.id) && b.group).map((b) => b.group!));
  if (!groups.size) return [...set];
  for (const b of bricks) if (b.group && groups.has(b.group)) set.add(b.id);
  return [...set];
}

/** Put the selected parts into one new group (absorbing any groups they were already in). */
export function groupBricks(bricks: Brick[], ids: Set<string>): { bricks: Brick[]; group: string | null } {
  const sel = expandToGroups(ids, bricks);
  if (sel.length < 2) return { bricks, group: null };
  const group = newGroupId();
  const s = new Set(sel);
  return { bricks: bricks.map((b) => (s.has(b.id) ? { ...b, group } : b)), group };
}

/** Dissolve every group touched by the selection. */
export function ungroupBricks(bricks: Brick[], ids: Set<string>): Brick[] {
  const groups = new Set(bricks.filter((b) => ids.has(b.id) && b.group).map((b) => b.group));
  if (!groups.size) return bricks;
  return bricks.map((b) => (b.group && groups.has(b.group) ? { ...b, group: undefined } : b));
}

/**
 * Carry `others` along with a pivot part that moved from (pivot.pos, pivot.quat) to (pos, quat),
 * keeping every part's position and rotation relative to the pivot.
 */
export function follow(pivot: Brick, pos: THREE.Vector3, quat: THREE.Quaternion, others: Brick[]): Brick[] {
  const p0 = new THREE.Vector3(...pivot.pos);
  const q0inv = new THREE.Quaternion(...pivot.quat).invert();
  return others.map((b) => {
    const rel = new THREE.Vector3(...b.pos).sub(p0).applyQuaternion(q0inv);
    const relQ = q0inv.clone().multiply(new THREE.Quaternion(...b.quat));
    const np = rel.applyQuaternion(quat).add(pos);
    const nq = quat.clone().multiply(relQ).normalize();
    // keep positions tidy on the stud/plate grid (avoid float drift after many moves)
    const r = (v: number, s: number) => Math.round(v / s) * s;
    return { ...b, pos: [r(np.x, 0.05), r(np.y, 0.05), r(np.z, 0.05)], quat: nq.toArray() as Brick['quat'] };
  });
}

/** Fresh ids (and fresh group ids, preserving which copies belong together) for a pasted copy. */
export function freshCopies(bricks: Brick[], newId: () => string): Brick[] {
  const remap = new Map<string, string>();
  return bricks.map((b) => {
    let group = b.group;
    if (group) {
      if (!remap.has(group)) remap.set(group, newGroupId());
      group = remap.get(group);
    }
    // a copy of a submodel copy is a new linked copy: same submodel, new copy id (= its group)
    return { ...b, id: newId(), group, link: b.link && group ? { ...b.link, inst: group } : b.link };
  });
}
