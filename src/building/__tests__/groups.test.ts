import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { expandToGroups, follow, freshCopies, groupBricks, ungroupBricks } from '../groups';
import type { Brick } from '../snap';

const B = (id: string, pos: [number, number, number], group?: string): Brick => ({ id, part: '3001', color: 4, pos, quat: [0, 0, 0, 1], group });

describe('groups', () => {
  const bricks = [B('a', [0, 1.2, 0]), B('b', [0, 2.4, 0]), B('c', [5, 1.2, 0])];

  it('groups a selection and expands clicks to the whole group', () => {
    const { bricks: g, group } = groupBricks(bricks, new Set(['a', 'b']));
    expect(group).toBeTruthy();
    expect(expandToGroups(['a'], g).sort()).toEqual(['a', 'b']);
    expect(expandToGroups(['c'], g)).toEqual(['c']);
  });

  it('ungroups every group the selection touches', () => {
    const { bricks: g } = groupBricks(bricks, new Set(['a', 'b']));
    const u = ungroupBricks(g, new Set(['b']));
    expect(u.every((b) => !b.group)).toBe(true);
  });

  it('a single part is not a group', () => {
    expect(groupBricks(bricks, new Set(['a'])).group).toBeNull();
  });

  it('followers keep their layout when the pivot moves and turns', () => {
    const pivot = bricks[0];
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const [moved] = follow(pivot, new THREE.Vector3(10, 1.2, 0), q, [B('x', [2, 2.4, 0])]);
    // (2,0) relative offset rotated 90° about Y → (0,-2)
    expect(moved.pos[0]).toBeCloseTo(10);
    expect(moved.pos[1]).toBeCloseTo(2.4);
    expect(moved.pos[2]).toBeCloseTo(-2);
  });

  it('copies get new ids and their own group', () => {
    const { bricks: g, group } = groupBricks(bricks, new Set(['a', 'b']));
    let n = 0;
    const copies = freshCopies(g.slice(0, 2), () => 'n' + n++);
    expect(copies.map((c) => c.id)).toEqual(['n0', 'n1']);
    expect(copies[0].group).toBe(copies[1].group);
    expect(copies[0].group).not.toBe(group);
  });
});
