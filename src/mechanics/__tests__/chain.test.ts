import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import { buildGraph, solve } from '../mechanics';
import { chainPath, linkPoses, type ChainPath, type Wheel } from '../chain';
import type { Brick } from '../../building/snap';

const manifest = JSON.parse(fs.readFileSync('public/data/parts.json', 'utf8'));
const lib = await import('../../data/library');
const part = (id: string) => (lib as any).__toPartForTest(manifest.parts.find((p: any) => p.id === id));
const parts = new Map(['32523', '4519', '3647', '3648b'].map((id) => [id, part(id)]));
const q = (axis: [number, number, number], deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), (deg * Math.PI) / 180).toArray() as Brick['quat'];
const I: Brick['quat'] = [0, 0, 0, 1];
const wheel = (id: string, x: number, y: number, r: number): Wheel => ({ id, centre: new THREE.Vector3(x, y, 0), axis: new THREE.Vector3(0, 0, 1), r });

describe('chains and tracks', () => {
  it('wraps two equal wheels: two straight runs plus one full turn', () => {
    const p = chainPath([wheel('a', 0, 0, 1), wheel('b', 4, 0, 1)]) as ChainPath;
    expect(p.length).toBeCloseTo(8 + 2 * Math.PI, 5);
    // every point sits on a wheel rim or on a straight run one radius out
    for (let s = 0; s < p.length; s += 0.37) {
      const { pos } = p.at(s);
      expect(Math.abs(pos.y) <= 1 + 1e-6 || pos.x < 0 || pos.x > 4).toBe(true);
    }
  });

  it('runs on the outside of wheels of different sizes, in either click order', () => {
    const a = chainPath([wheel('a', 0, 0, 0.5), wheel('b', 5, 0, 1.5), wheel('c', 2, 4, 1)]) as ChainPath;
    const b = chainPath([wheel('c', 2, 4, 1), wheel('b', 5, 0, 1.5), wheel('a', 0, 0, 0.5)]) as ChainPath;
    expect(a.length).toBeCloseTo(b.length, 5);
    const centroid = new THREE.Vector3(7 / 3, 4 / 3, 0);
    for (let s = 0; s < a.length; s += 0.5) {
      const { pos, out } = a.at(s);
      expect(out.dot(pos.clone().sub(centroid))).toBeGreaterThan(0); // outward normal points away from the middle
    }
  });

  it('refuses wheels that are not side by side', () => {
    const tilted = { ...wheel('b', 4, 0, 1), axis: new THREE.Vector3(1, 0, 0) };
    expect('error' in chainPath([wheel('a', 0, 0, 1), tilted])).toBe(true);
  });

  it('spaces links evenly round the loop', () => {
    const p = chainPath([wheel('a', 0, 0, 1), wheel('b', 4, 0, 1)]) as ChainPath;
    const poses = linkPoses(p, 0.8);
    expect(poses.length).toBe(Math.round(p.length / 0.8));
  });

  it('a chain turns both wheels the same way, the big one slower', () => {
    // two separate beams with a vertical axle each; an 8T and a 24T gear 6 studs apart (too far to mesh)
    const build: Brick[] = [
      { id: 'beam1', part: '32523', color: 0, pos: [0, 0, 0], quat: I },
      { id: 'beam2', part: '32523', color: 0, pos: [0, 0, -6], quat: I },
      { id: 'ax1', part: '4519', color: 0, pos: [0, 0, 1], quat: q([0, 0, 1], 90) },
      { id: 'ax2', part: '4519', color: 0, pos: [0, 0, -5], quat: q([0, 0, 1], 90) },
      { id: 'g8', part: '3647', color: 7, pos: [0, 0.75, 1], quat: q([1, 0, 0], 90) },
      { id: 'g24', part: '3648b', color: 7, pos: [0, 0.75, -5], quat: q([1, 0, 0], 90) },
      { id: 'ch', part: 'chain', color: 72, pos: [0, 0, 0], quat: I, chain: { kind: 'chain', wheels: ['g8', 'g24'] } },
    ];
    const g = buildGraph(build, parts);
    expect(g.meshes).toHaveLength(1);
    const m = solve(g, 'ax1', 3);
    expect(m.jammed).toBe(false);
    expect(m.spin.get(g.bodyOf.get('ax2')!)!.omega).toBeCloseTo(1);
  });
});
