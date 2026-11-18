import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { calloutOf, nearestTarget, officialInstructionsUrl, type Target } from '../guided';

const T = (id: string, part: string, color: number, x: number): Target => ({ id, part, color, pos: [x, 0, 0], quat: [0, 0, 0, 1], step: 0 });

describe('guided steps', () => {
  const step = [T('a', '3001', 4, 0), T('b', '3001', 4, 4), T('c', '3003', 1, 8)];

  it('groups a step into a callout with counts left to place', () => {
    const c = calloutOf(step, new Set(['a']));
    expect(c[0]).toMatchObject({ part: '3001', color: 4, total: 2, left: 1 });
    expect(c[1]).toMatchObject({ part: '3003', total: 1, left: 1 });
  });

  it('snaps to the nearest open target with the same part and colour', () => {
    const near4 = new THREE.Vector3(3.6, 0, 0);
    expect(nearestTarget(step, new Set(), '3001', 4, near4)?.id).toBe('b');
    expect(nearestTarget(step, new Set(['b']), '3001', 4, near4)?.id).toBe('a');
    expect(nearestTarget(step, new Set(), '3001', 1, near4)).toBeNull(); // wrong colour: no target
  });

  it('links to the official instructions by set number', () => {
    expect(officialInstructionsUrl('10294-1')).toBe('https://www.lego.com/service/building-instructions/10294');
  });
});
