import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import { buildGraph, solve, gearRadius, type Graph } from '../mechanics';
import type { Brick } from '../../building/snap';

const manifest = JSON.parse(fs.readFileSync('public/data/parts.json', 'utf8'));
const lib = await import('../../data/library');
const part = (id: string) => (lib as any).__toPartForTest(manifest.parts.find((p: any) => p.id === id));
const parts = new Map(['32523', '4519', '3647', '3648b'].map((id) => [id, part(id)]));

const q = (axis: [number, number, number], deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), (deg * Math.PI) / 180).toArray() as Brick['quat'];
const I: Brick['quat'] = [0, 0, 0, 1];

// A 1x3 beam lying flat (holes vertical), two vertical axles through its end holes,
// an 8T gear on one axle and a 24T on the other, both 0.75 above the beam: 2 studs apart = 0.5 + 1.5 ✓
const train: Brick[] = [
  { id: 'beam', part: '32523', color: 0, pos: [0, 0, 0], quat: I },
  { id: 'ax1', part: '4519', color: 0, pos: [0, 0, 1], quat: q([0, 0, 1], 90) },
  { id: 'ax2', part: '4519', color: 0, pos: [0, 0, -1], quat: q([0, 0, 1], 90) },
  { id: 'g8', part: '3647', color: 7, pos: [0, 0.75, 1], quat: q([1, 0, 0], 90) },
  { id: 'g24', part: '3648b', color: 7, pos: [0, 0.75, -1], quat: q([1, 0, 0], 90) },
];

describe('mechanisms', () => {
  it('gear radii follow the Technic module (8T↔24T are 2 studs apart)', () => {
    expect(gearRadius(8) + gearRadius(24)).toBeCloseTo(2);
  });

  it('axles turn in beam holes, gears lock onto axles', () => {
    const g = buildGraph(train, parts);
    const kind = (a: string, b: string) => g.joints.find((j) => (j.a === a && j.b === b) || (j.a === b && j.b === a))?.kind;
    expect(kind('ax1', 'beam')).toBe('revolute');
    expect(kind('ax2', 'beam')).toBe('revolute');
    expect(kind('g8', 'ax1')).toBe('fixed');
    expect(g.bodyOf.get('g8')).toBe(g.bodyOf.get('ax1'));
    expect(g.bodyOf.get('beam')).not.toBe(g.bodyOf.get('ax1'));
  });

  it('meshing 8T → 24T turns the second axle 3× slower, the other way', () => {
    const g = buildGraph(train, parts);
    expect(g.meshes).toHaveLength(1);
    const m = solve(g, 'ax1', 3);
    expect(m.jammed).toBe(false);
    const w2 = m.spin.get(g.bodyOf.get('ax2')!)!.omega;
    expect(w2).toBeCloseTo(-1);
    expect(m.spin.has(g.bodyOf.get('beam')!)).toBe(false); // the frame stays still
  });

  it('a loop of three meshing gears jams', () => {
    // hand-built graph: three equal gears all meshing each other (odd loop)
    const ids = ['a', 'b', 'c'];
    const g: Graph = {
      joints: [], gears: ids.map((id) => ({ brick: id, teeth: 16, centre: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0) })),
      bodyOf: new Map(ids.map((i) => [i, i])), bodies: new Map(ids.map((i) => [i, [i]])),
      meshes: [{ a: 'a', b: 'b', ratio: -1 }, { a: 'b', b: 'c', ratio: -1 }, { a: 'c', b: 'a', ratio: -1 }],
    };
    expect(solve(g, 'a', 1).jammed).toBe(true);
  });
});

describe('technic snapping', async () => {
  const { technicSnap } = await import('../../building/snap');
  it('slides an axle into a beam hole, vertical like the hole', () => {
    const beam = train[0];
    const hit = new THREE.Vector3(0, 0.5, 1); // top face of the beam, over the end hole
    const pl = technicSnap({ parts, bricks: [beam] }, parts.get('4519')!, hit, new THREE.Vector3(0, 1, 0), beam, 0)!;
    expect(pl).toBeTruthy();
    expect(pl.pos.x).toBeCloseTo(0);
    expect(pl.pos.z).toBeCloseTo(1);
    // axle's own axis (local x) now points up/down
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(pl.quat);
    expect(Math.abs(axis.y)).toBeCloseTo(1);
    // it sticks out of the top: centre above the beam's mid-plane
    expect(pl.pos.y).toBeGreaterThan(0.5);
  });
  it('puts a gear onto an axle on the half-stud grid', () => {
    const axle = train[1];
    const pl = technicSnap({ parts, bricks: [axle] }, parts.get('3647')!, new THREE.Vector3(0.3, 0.8, 1), new THREE.Vector3(1, 0, 0), axle, 0)!;
    expect(pl).toBeTruthy();
    expect(pl.pos.y).toBeCloseTo(1);
    expect(pl.pos.z).toBeCloseTo(1);
  });
});
