import * as THREE from 'three';
import type { Brick } from './snap';

// Submodels: a group of parts that can be copied with every copy staying linked.
// Each part of a copy carries link = { def, inst, local }: which submodel, which copy, which part of it.
// After every edit, syncSubmodels() looks at what changed:
//   • a whole copy moved/turned rigidly → just that copy moved (copies are placed independently)
//   • individual parts changed (colour, position, deleted) → the submodel's definition changes, and every
//     other copy of it is rebuilt from the new definition at its own placement.

export interface Link { def: string; inst: string; local: string }
export type Linked = Brick & { link?: Link };

const mat = (b: Pick<Brick, 'pos' | 'quat'>) => new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
const fromMat = (m: THREE.Matrix4) => {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { pos: p.toArray().map((v) => +v.toFixed(4)) as Brick['pos'], quat: q.normalize().toArray().map((v) => +v.toFixed(6)) as Brick['quat'] };
};
const same = (a: Brick, b: Brick) =>
  a.part === b.part && a.color === b.color && !!a.hidden === !!b.hidden &&
  a.pos.every((v, i) => Math.abs(v - b.pos[i]) < 1e-3) && a.quat.every((v, i) => Math.abs(v - b.quat[i]) < 1e-4);

let uid = Date.now();
const nid = (p: string) => p + (uid++).toString(36);

/** Turn a selection into submodel copy #1. The copy's placement is its first part (local = identity there). */
export function makeSubmodel(bricks: Linked[], ids: Set<string>): Linked[] {
  const def = nid('s'), inst = nid('i');
  return bricks.map((b) => (ids.has(b.id) ? { ...b, group: inst, link: { def, inst, local: b.id } } : b));
}

/** Placement (world transform) of a copy, from any of its parts: world · local⁻¹. */
function placementOf(copy: Linked[], defParts: Map<string, Brick>) {
  for (const b of copy) {
    const local = defParts.get(b.link!.local);
    if (local) return mat(b).multiply(mat(local).invert());
  }
  return null;
}

/** The definition of a submodel: its parts in submodel space, taken from a copy at a known placement. */
function definitionFrom(copy: Linked[], placement: THREE.Matrix4) {
  const inv = placement.clone().invert();
  return new Map(copy.map((b) => [b.link!.local, { ...b, ...fromMat(inv.clone().multiply(mat(b))) } as Brick]));
}

/** Make a linked copy of a submodel copy, shifted by `offset` (studs). */
export function linkedCopy(bricks: Linked[], inst: string, offset: [number, number, number], newId: () => string): Linked[] {
  const src = bricks.filter((b) => b.link?.inst === inst);
  const nInst = nid('i');
  return src.map((b) => ({ ...b, id: newId(), group: nInst, pos: [b.pos[0] + offset[0], b.pos[1] + offset[1], b.pos[2] + offset[2]], link: { ...b.link!, inst: nInst } }));
}

/** Unlink one copy (it becomes a plain group) or release a whole submodel (all copies become plain groups). */
export function unlinkCopy(bricks: Linked[], inst: string): Linked[] {
  return bricks.map((b) => (b.link?.inst === inst ? { ...b, link: undefined } : b));
}
export function releaseSubmodel(bricks: Linked[], def: string): Linked[] {
  return bricks.map((b) => (b.link?.def === def ? { ...b, link: undefined } : b));
}

/** Propagate per-part edits made in one copy to every other copy of the same submodel. */
export function syncSubmodels(prev: Linked[], next: Linked[], newId: () => string): Linked[] {
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const nextById = new Map(next.map((b) => [b.id, b]));
  const defs = new Set(prev.filter((b) => b.link).map((b) => b.link!.def));
  let out = next;
  for (const def of defs) {
    const prevCopies = groupBy(prev.filter((b) => b.link?.def === def), (b) => b.link!.inst);
    // find the copy whose individual parts were edited (not merely moved as a whole)
    for (const [inst, before] of prevCopies) {
      const after = before.map((b) => nextById.get(b.id)).filter(Boolean) as Linked[];
      const deleted = before.filter((b) => !nextById.has(b.id));
      const changed = after.filter((b) => !same(b, prevById.get(b.id)!));
      if (!changed.length && !deleted.length) continue;
      // the old definition, from this copy before the edit
      const oldPlace = placementOf(before, new Map(before.map((b) => [b.link!.local, b]))) ?? new THREE.Matrix4();
      const oldDef = definitionFrom(before, oldPlace);
      // whole copy moved rigidly? (every part keeps the same pose relative to the others, nothing deleted, same colours)
      if (!deleted.length && after.length === before.length) {
        const newPlace = placementOf(after, oldDef);
        const rigid = newPlace && after.every((b) => {
          const expect = fromMat(newPlace.clone().multiply(mat(oldDef.get(b.link!.local)!)));
          return b.color === prevById.get(b.id)!.color && b.part === prevById.get(b.id)!.part && same({ ...b, ...expect }, b);
        });
        if (rigid) continue;
      }
      // per-part edit: the unchanged parts tell us where this copy sits; the edited parts redefine the submodel
      const anchor = after.filter((b) => !changed.includes(b));
      const place = (anchor.length ? placementOf(anchor, oldDef) : null) ?? oldPlace;
      const newDef = definitionFrom(after, place);
      // rebuild every other copy of this submodel from the new definition, at its own placement
      const others = groupBy(out.filter((b) => b.link?.def === def && b.link.inst !== inst), (b) => b.link!.inst);
      const rebuilt: Linked[] = [];
      for (const [oInst, copy] of others) {
        const oPlace = placementOf(copy, oldDef);
        if (!oPlace) continue;
        const byLocal = new Map(copy.map((b) => [b.link!.local, b]));
        for (const [local, part] of newDef) {
          const existing = byLocal.get(local);
          rebuilt.push({ ...(existing ?? { id: newId(), group: oInst }), part: part.part, color: part.color, hidden: part.hidden, ...fromMat(oPlace.clone().multiply(mat(part))), link: { def, inst: oInst, local } } as Linked);
        }
      }
      out = [...out.filter((b) => !(b.link?.def === def && b.link.inst !== inst)), ...rebuilt];
      break; // one edited copy per commit
    }
  }
  return out;
}

function groupBy<T>(xs: T[], k: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) { const key = k(x); if (!m.has(key)) m.set(key, []); m.get(key)!.push(x); }
  return m;
}
