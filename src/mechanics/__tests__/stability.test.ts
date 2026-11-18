import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { analyseStability, connections } from '../stability';
import type { Brick } from '../../building/snap';

const manifest = JSON.parse(fs.readFileSync('public/data/parts.json', 'utf8'));
const lib = await import('../../data/library');
const part = (id: string) => (lib as any).__toPartForTest(manifest.parts.find((p: any) => p.id === id));
// 3001 brick 2x4 · 3005 brick 1x1 · 3008 brick 1x8 · 3460 plate 1x8
const parts = new Map(['3001', '3005', '3008', '3460'].map((id) => [id, part(id)]));
const I: Brick['quat'] = [0, 0, 0, 1];
const B = (id: string, p: string, pos: [number, number, number]): Brick => ({ id, part: p, color: 4, pos, quat: I });

describe('stability', () => {
  it('counts clutching studs between stacked bricks', () => {
    const e = connections([B('a', '3001', [0, 1.2, 0]), B('b', '3001', [0, 2.4, 0])], parts);
    expect(e).toHaveLength(1);
    expect(e[0].studs).toBe(8);
  });

  it('a straight stack is comfortable', () => {
    const s = analyseStability([B('a', '3001', [0, 1.2, 0]), B('b', '3001', [0, 2.4, 0]), B('c', '3001', [0, 3.6, 0])], parts);
    expect(s.weak).toHaveLength(0);
    expect(s.floating).toHaveLength(0);
    expect(Math.max(...s.stress.values())).toBeLessThan(0.5);
  });

  it('a long beam held by one stud at its end is overloaded', () => {
    // 1x1 pillar, then a 1x8 brick resting on it by its last stud only, sticking out 7 studs
    const s = analyseStability([B('post', '3005', [0.5, 1.2, 0.5]), B('arm', '3008', [4, 2.4, 0.5])], parts);
    expect(s.stress.get('arm')!).toBeGreaterThan(1);
    expect(s.weak).toHaveLength(1);
  });

  it('a part in mid-air is floating', () => {
    const s = analyseStability([B('a', '3001', [0, 1.2, 0]), B('fly', '3005', [10.5, 6, 0.5])], parts);
    expect(s.floating).toEqual(['fly']);
  });
});
