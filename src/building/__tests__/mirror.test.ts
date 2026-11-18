import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import { mirrorBricks } from '../mirror';
import type { Brick } from '../snap';

const manifest = JSON.parse(fs.readFileSync('public/data/parts.json', 'utf8'));
const lib = await import('../../data/library');
const parts = new Map<string, any>(['3039', '43722', '43723', '3001'].map((id) => [id, (lib as any).__toPartForTest(manifest.parts.find((p: any) => p.id === id))]));
const yaw = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (deg * Math.PI) / 180).toArray() as Brick['quat'];

describe('mirror', () => {
  it('a slope facing east faces west after mirroring across X', () => {
    // 3039 falls toward local +z; turned 90° it falls toward world +x
    const b: Brick = { id: 's', part: '3039', color: 4, pos: [2, 1.2, 0], quat: yaw(90) };
    const [m] = mirrorBricks([b], parts, 'x', 0);
    expect(m.pos[0]).toBeCloseTo(-2);
    const down = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...m.quat));
    expect(down.x).toBeCloseTo(-1);
    expect(down.y).toBeCloseTo(0);
  });

  it('a right wedge plate becomes the left one', () => {
    const [m] = mirrorBricks([{ id: 'w', part: '43722', color: 1, pos: [1, 0.4, 0], quat: [0, 0, 0, 1] }], parts, 'x', 3);
    expect(m.part).toBe('43723');
    expect(m.pos[0]).toBeCloseTo(5);
  });

  it('mirroring twice gives back the original', () => {
    const b: Brick = { id: 'b', part: '3039', color: 4, pos: [1, 2.4, 3], quat: yaw(180) };
    const [m2] = mirrorBricks(mirrorBricks([b], parts, 'z', 1), parts, 'z', 1);
    expect(m2.pos).toEqual(b.pos);
    const q1 = new THREE.Quaternion(...b.quat), q2 = new THREE.Quaternion(...m2.quat);
    expect(Math.abs(q1.dot(q2))).toBeCloseTo(1);
  });
});
