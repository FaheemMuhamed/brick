import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hoseAnchor, hoseCurve, makeHose } from './Hose';
import type { Part } from '../data/library';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('flexible hose', () => {
  it('runs from start to end, leaving along the start direction', () => {
    const h = makeHose('h1', 0, v(1, 2, 3), v(1, 0, 0), v(6, 2, 3), v(-1, 0, 0));
    expect(h.pos).toEqual([1, 2, 3]);
    const c = hoseCurve(h.hose!);
    expect(c.getPoint(0).toArray()).toEqual([0, 0, 0]);
    expect(c.getPoint(1).distanceTo(v(5, 0, 0))).toBeLessThan(1e-6);
    expect(c.getTangent(0).x).toBeGreaterThan(0.5); // leaves straight out of the hole
    expect(c.getPoint(0.5).y).toBeLessThan(0); // sags in the middle
  });

  it('snaps an end to the near side of a Technic hole', () => {
    const part = { connectors: [{ kind: 'pinhole', pos: v(0, -0.5, 0), axis: v(0, 0, 1), len: 1 }] } as unknown as Part;
    const brick = { id: 'b', part: 'beam', color: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1] } as never;
    const a = hoseAnchor(v(0.1, -0.4, -0.5), v(0, 0, -1), brick, part);
    expect(a.snapped).toBe(true);
    expect(a.pos.toArray()).toEqual([0, -0.5, -0.5]);
    expect(a.dir.z).toBe(-1);
  });
});
