import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import { snapPlacement, collides, type Brick } from '../snap';

// Load real manifest entries and convert them the same way the app does.
const manifest = JSON.parse(fs.readFileSync('public/data/parts.json', 'utf8'));
const lib = await import('../../data/library');
const toPart = (id: string) => {
  const d = manifest.parts.find((p: any) => p.id === id);
  (globalThis as any).fetch = undefined;
  return (lib as any).__toPartForTest(d);
};

describe('stud snapping', () => {
  const b24 = toPart('3001');
  const b11 = toPart('3005');
  const parts = new Map([['3001', b24], ['3005', b11]]);
  const q = new THREE.Quaternion();

  it('2x4 brick has 8 studs and 8 anti-studs', () => {
    expect(b24.connectors.filter((c: any) => c.kind === 'stud')).toHaveLength(8);
    expect(b24.connectors.filter((c: any) => c.kind === 'anti')).toHaveLength(8);
  });

  it('sits flat on the baseplate on the stud grid', () => {
    const p = snapPlacement({ parts, bricks: [] }, b24, q, new THREE.Vector3(0.3, 0, 0.2), new THREE.Vector3(0, 1, 0), null);
    expect(p.valid).toBe(true);
    expect(p.pos.y).toBeCloseTo(1.2);
    expect(Math.abs(p.pos.x % 1)).toBeCloseTo(0);
    expect(Math.abs(p.pos.z % 1)).toBeCloseTo(0);
  });

  it('stacks a 1x1 on top of a 2x4 exactly one brick higher', () => {
    const base: Brick = { id: 'a', part: '3001', color: 4, pos: [0, 1.2, 0], quat: [0, 0, 0, 1] };
    const p = snapPlacement({ parts, bricks: [base] }, b11, q, new THREE.Vector3(1.4, 1.2, 0.4), new THREE.Vector3(0, 1, 0), base);
    expect(p.valid).toBe(true);
    expect(p.pos.y).toBeCloseTo(2.4);
    expect(p.pos.x).toBeCloseTo(1.5);
    expect(p.pos.z).toBeCloseTo(0.5);
  });

  it('reports a collision when two bricks overlap', () => {
    const base: Brick = { id: 'a', part: '3001', color: 4, pos: [0, 1.2, 0], quat: [0, 0, 0, 1] };
    expect(collides({ parts, bricks: [base] }, b11, new THREE.Vector3(0.5, 1.2, 0.5), q)).toBe(true);
    expect(collides({ parts, bricks: [base] }, b11, new THREE.Vector3(0.5, 2.4, 0.5), q)).toBe(false);
  });
});

describe('sideways building (SNOT)', () => {
  const side = toPart('87087'); // brick 1x1 with a stud on one side
  const plate = toPart('3024'); // plate 1x1
  const parts = new Map([['87087', side], ['3024', plate]]);
  const target: Brick = { id: 's', part: '87087', color: 4, pos: [0, 1.2, 0], quat: [0, 0, 0, 1] };
  const sideStud = side.connectors.find((c: any) => c.kind === 'stud' && Math.abs(c.axis.y) < 0.5)!;
  const studPos = sideStud.pos.clone().add(new THREE.Vector3(...target.pos));

  it('a plate tilted onto its side clicks onto the side stud', () => {
    // tilt the plate so its anti-stud faces the side stud
    const anti = plate.connectors.find((c: any) => c.kind === 'anti')!;
    const q = new THREE.Quaternion().setFromUnitVectors(anti.axis, sideStud.axis.clone().negate());
    const p = snapPlacement({ parts, bricks: [target] }, plate, q, studPos.clone().addScaledVector(sideStud.axis, 0.2), sideStud.axis.clone(), target);
    expect(p.snapped).toBe(true);
    const antiWorld = anti.pos.clone().applyQuaternion(q).add(p.pos);
    expect(antiWorld.distanceTo(studPos)).toBeLessThan(1e-6);
  });

  it('an upright plate does not snap onto the side stud', () => {
    const p = snapPlacement({ parts, bricks: [target] }, plate, new THREE.Quaternion(), studPos.clone().addScaledVector(sideStud.axis, 0.2), sideStud.axis.clone(), target);
    const anti = plate.connectors.find((c: any) => c.kind === 'anti')!;
    expect(anti.pos.clone().add(p.pos).distanceTo(studPos)).toBeGreaterThan(0.1);
  });
});
