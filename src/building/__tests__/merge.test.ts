import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { mergeBricks, splitBrick } from '../merge';
import type { Brick } from '../snap';

const manifest = JSON.parse(fs.readFileSync('public/data/parts.json', 'utf8'));
const lib = await import('../../data/library');
const parts = new Map<string, any>(manifest.parts.map((p: any) => [p.id, (lib as any).__toPartForTest(p)]));
let n = 0;
const id = () => 'n' + n++;
const yaw90: Brick['quat'] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

describe('merge & split', () => {
  it('splits a 2x4 brick into eight 1x1 bricks on its studs', () => {
    const out = splitBrick({ id: 'a', part: '3001', color: 4, pos: [0, 1.2, 0], quat: [0, 0, 0, 1] }, parts, id)!;
    expect(out).toHaveLength(8);
    expect(out.every((b) => b.part === '3005' && b.color === 4)).toBe(true);
    expect(new Set(out.map((b) => b.pos[0])).size).toBe(4);
  });

  it('merges those eight 1x1s back into a 2x4', () => {
    const ones = splitBrick({ id: 'a', part: '3001', color: 4, pos: [0, 1.2, 0], quat: [0, 0, 0, 1] }, parts, id)!;
    const r = mergeBricks(ones, parts, id);
    expect('brick' in r && r.brick.part).toBe('3001');
    if ('brick' in r) { expect(r.brick.pos[0]).toBeCloseTo(0); expect(r.brick.pos[2]).toBeCloseTo(0); }
  });

  it('merges two 1x2 plates side by side into a 2x2 plate, turned to fit', () => {
    const r = mergeBricks([
      { id: 'p1', part: '3023', color: 1, pos: [0.5, 0.4, 0], quat: yaw90 },
      { id: 'p2', part: '3023', color: 1, pos: [1.5, 0.4, 0], quat: yaw90 },
    ], parts, id);
    expect('brick' in r && r.brick.part).toBe('3022');
  });

  it('refuses mixed colours or an L shape', () => {
    expect('error' in mergeBricks([
      { id: 'a', part: '3005', color: 4, pos: [0.5, 1.2, 0.5], quat: [0, 0, 0, 1] },
      { id: 'b', part: '3005', color: 1, pos: [1.5, 1.2, 0.5], quat: [0, 0, 0, 1] },
    ], parts, id)).toBe(true);
    expect('error' in mergeBricks([
      { id: 'a', part: '3005', color: 4, pos: [0.5, 1.2, 0.5], quat: [0, 0, 0, 1] },
      { id: 'b', part: '3005', color: 4, pos: [1.5, 1.2, 0.5], quat: [0, 0, 0, 1] },
      { id: 'c', part: '3005', color: 4, pos: [0.5, 1.2, 1.5], quat: [0, 0, 0, 1] },
    ], parts, id)).toBe(true);
  });
});

describe('instruction steps for a free build', async () => {
  const { stepsFromBuild } = await import('../../instructions/print');
  it('goes bottom up with a few parts per step', () => {
    const bricks: Brick[] = Array.from({ length: 20 }, (_, i) => ({ id: 'b' + i, part: '3001', color: 4, pos: [i % 5, 1.2 * (1 + Math.floor(i / 5)), 0], quat: [0, 0, 0, 1] }));
    const steps = stepsFromBuild(bricks.reverse());
    expect(steps.flat()).toHaveLength(20);
    expect(steps.every((s) => s.length <= 8)).toBe(true);
    const firstY = Math.max(...steps[0].map((b) => b.pos[1])), lastY = Math.min(...steps[steps.length - 1].map((b) => b.pos[1]));
    expect(firstY).toBeLessThanOrEqual(lastY);
  });
});
