import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';

// Guided builds: an official model split into ordered steps. Each step lists target parts at their exact
// final transform; the builder places them (or asks the app to), and the guide advances when a step is done.

export interface Target extends Brick { step: number }
export interface GuidedModel {
  set: string; name: string; steps: Target[][];
  /** present for generated alternate builds: lets the guide offer other designs */
  alt?: { setName: string; inventory: [string, number, number][]; seed: number; design: string };
}
/** [set, name, stepCount, partCount] */
export type GuidedRow = [string, string, number, number];

type RawStep = [string, number, number, number, number, number, number, number, number][];

let indexPromise: Promise<Map<string, GuidedRow>> | null = null;
export function loadGuidedIndex() {
  indexPromise ??= fetch('/data/guided.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: GuidedRow[]) => new Map(rows.map((r) => [r[0], r])))
    .catch(() => new Map());
  return indexPromise;
}

/** Load a model, drop parts we can't draw, and set it on the baseplate: lowest part on the floor, centred on the stud grid. */
export async function loadGuidedModel(set: string, parts: Map<string, Part>): Promise<GuidedModel> {
  const r = await fetch(`/data/models/${encodeURIComponent(set)}.json`);
  if (!r.ok) throw new Error(`No step-by-step model for ${set}`);
  const raw: { set: string; name: string; steps: RawStep[] } = await r.json();
  let n = 0;
  const steps: Target[][] = raw.steps
    .map((s, i) => s.filter(([p]) => parts.has(p)).map(([part, color, x, y, z, qx, qy, qz, qw]) => ({
      id: `t${n++}`, part, color: color === 16 ? 7 : color, pos: [x, y, z] as Brick['pos'], quat: [qx, qy, qz, qw] as Brick['quat'], step: i,
    })))
    .filter((s) => s.length);
  steps.forEach((s, i) => s.forEach((t) => (t.step = i)));

  // ground + centre
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const s of steps) for (const t of s) {
    const part = parts.get(t.part)!;
    m.compose(new THREE.Vector3(...t.pos), new THREE.Quaternion(...t.quat), new THREE.Vector3(1, 1, 1));
    box.union(part.box.clone().applyMatrix4(m));
  }
  const dx = -Math.round((box.min.x + box.max.x) / 2);
  const dz = -Math.round((box.min.z + box.max.z) / 2);
  const dy = -box.min.y;
  for (const s of steps) for (const t of s) t.pos = [+(t.pos[0] + dx).toFixed(3), +(t.pos[1] + dy).toFixed(3), +(t.pos[2] + dz).toFixed(3)];
  return { set: raw.set, name: raw.name, steps };
}

/** Parts of a step grouped as a manual's callout box: part + colour → count. */
export function calloutOf(step: Target[], placed?: Set<string>) {
  const m = new Map<string, { part: string; color: number; total: number; left: number }>();
  for (const t of step) {
    const k = `${t.part}:${t.color}`;
    const e = m.get(k) ?? { part: t.part, color: t.color, total: 0, left: 0 };
    e.total++;
    if (!placed?.has(t.id)) e.left++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** World box around a set of targets (for framing the camera on a step). */
export function targetsBox(targets: Target[], parts: Map<string, Part>) {
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const t of targets) {
    const part = parts.get(t.part);
    if (!part) continue;
    m.compose(new THREE.Vector3(...t.pos), new THREE.Quaternion(...t.quat), new THREE.Vector3(1, 1, 1));
    box.union(part.box.clone().applyMatrix4(m));
  }
  return box;
}

/** Nearest unplaced target of this part + colour to a world point (guided placement snaps to targets). */
export function nearestTarget(step: Target[], placed: Set<string>, part: string, color: number, point: THREE.Vector3) {
  let best: Target | null = null;
  let bestD = Infinity;
  for (const t of step) {
    if (placed.has(t.id) || t.part !== part || t.color !== color) continue;
    const d = point.distanceToSquared(new THREE.Vector3(...t.pos));
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** Link to the official building instructions for a set (opens LEGO's own site; nothing is copied). */
export const officialInstructionsUrl = (set: string) => `https://www.lego.com/service/building-instructions/${encodeURIComponent(set.replace(/-\d+$/, ''))}`;
