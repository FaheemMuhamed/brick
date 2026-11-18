import { describe, expect, it } from 'vitest';
import type { Brick } from '../building/snap';
import { authorSteps, mergeWithPrevious, moveToStep, newStepAfter, shiftStep, stepsOf } from './steps';

const b = (id: string, y: number, step?: number): Brick => ({ id, part: '3001', color: 4, pos: [0, y, 0], quat: [0, 0, 0, 1], ...(step != null ? { step } : {}) });
const ids = (steps: Brick[][]) => steps.map((s) => s.map((x) => x.id).sort().join(','));

describe('step editor', () => {
  it('derives bottom-up steps until steps are authored', () => {
    const bricks = [b('top', 2.4), b('a', 1.2), b('c', 1.2), b('d', 1.2), b('e', 1.2)];
    expect(ids(stepsOf(bricks))).toEqual(['a,c,d,e', 'top']);
  });

  it('keeps authored order and packs unassigned parts at the end', () => {
    const bricks = [b('x', 1.2, 1), b('y', 1.2, 0), b('new', 3.6)];
    expect(ids(stepsOf(bricks))).toEqual(['y', 'x', 'new']);
  });

  it('moves parts between steps and drops steps that end up empty', () => {
    const bricks = authorSteps([b('a', 1.2, 0), b('b', 2.4, 1), b('c', 3.6, 2)]);
    const next = moveToStep(bricks, new Set(['b']), 0);
    expect(ids(stepsOf(next))).toEqual(['a,b', 'c']);
    expect(next.find((x) => x.id === 'c')!.step).toBe(1);
  });

  it('splits a selection into a new step, merges and reorders', () => {
    let bricks = [b('a', 1.2, 0), b('b', 1.2, 0), b('c', 2.4, 1)];
    bricks = newStepAfter(bricks, new Set(['b']), 0);
    expect(ids(stepsOf(bricks))).toEqual(['a', 'b', 'c']);
    bricks = shiftStep(bricks, 2, -1);
    expect(ids(stepsOf(bricks))).toEqual(['a', 'c', 'b']);
    bricks = mergeWithPrevious(bricks, 1);
    expect(ids(stepsOf(bricks))).toEqual(['a,c', 'b']);
  });
});
