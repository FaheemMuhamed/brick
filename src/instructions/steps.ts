import type { Brick } from '../building/snap';
import { stepsFromBuild } from './print';

// Building steps for your own builds. Each part can carry an explicit `step` (0-based). Parts without one
// (added outside the step editor) are packed into extra steps after the authored ones, bottom up.

const visible = (bricks: Brick[]) => bricks.filter((b) => !b.hidden);

/** True when the build has authored steps. */
export const hasSteps = (bricks: Brick[]) => bricks.some((b) => b.step != null);

/** The build as an ordered list of steps: authored steps first, then auto-steps for anything unassigned. */
export function stepsOf(bricks: Brick[]): Brick[][] {
  const live = visible(bricks);
  if (!hasSteps(live)) return stepsFromBuild(live);
  const by = new Map<number, Brick[]>();
  for (const b of live) if (b.step != null) (by.get(b.step) ?? by.set(b.step, []).get(b.step)!).push(b);
  const authored = [...by.keys()].sort((a, b) => a - b).map((k) => by.get(k)!);
  const loose = live.filter((b) => b.step == null);
  return [...authored, ...(loose.length ? stepsFromBuild(loose) : [])];
}

/** Write a step list back onto the parts (step = its index). Parts in no step keep no step. */
export function withSteps(bricks: Brick[], steps: Brick[][]): Brick[] {
  const idx = new Map<string, number>();
  steps.forEach((s, i) => s.forEach((b) => idx.set(b.id, i)));
  return bricks.map((b) => {
    const k = idx.get(b.id);
    if (k === b.step) return b;
    if (k == null) { const { step: _, ...rest } = b; return rest; }
    return { ...b, step: k };
  });
}

/** Make every step explicit (entering the editor), dropping empty steps. */
export const authorSteps = (bricks: Brick[]) => withSteps(bricks, stepsOf(bricks));

/** Re-derive steps from scratch, bottom up. */
export const autoSteps = (bricks: Brick[], perStep = 8) => withSteps(bricks.map(({ step: _, ...b }) => b), stepsFromBuild(visible(bricks), perStep));

/** Move parts into step k (they leave whatever step they were in; empty steps disappear). */
export function moveToStep(bricks: Brick[], ids: Set<string>, k: number): Brick[] {
  const steps = stepsOf(bricks);
  const moving = steps.flat().filter((b) => ids.has(b.id));
  const target = steps[k];
  if (!target || !moving.length) return bricks;
  const next = steps.map((s) => (s === target ? [...s.filter((b) => !ids.has(b.id)), ...moving] : s.filter((b) => !ids.has(b.id))));
  return withSteps(bricks, next.filter((s) => s.length));
}

/** Put parts into a brand-new step right after step k. */
export function newStepAfter(bricks: Brick[], ids: Set<string>, k: number): Brick[] {
  const steps = stepsOf(bricks).map((s) => s.filter((b) => !ids.has(b.id)));
  const moving = stepsOf(bricks).flat().filter((b) => ids.has(b.id));
  if (!moving.length) return bricks;
  steps.splice(Math.min(k + 1, steps.length), 0, moving);
  return withSteps(bricks, steps.filter((s) => s.length));
}

/** Merge step k into the one before it. */
export function mergeWithPrevious(bricks: Brick[], k: number): Brick[] {
  const steps = stepsOf(bricks);
  if (k <= 0 || k >= steps.length) return bricks;
  steps[k - 1] = [...steps[k - 1], ...steps[k]];
  steps.splice(k, 1);
  return withSteps(bricks, steps);
}

/** Swap step k with its neighbour (dir −1 earlier, +1 later). */
export function shiftStep(bricks: Brick[], k: number, dir: -1 | 1): Brick[] {
  const steps = stepsOf(bricks);
  const j = k + dir;
  if (j < 0 || j >= steps.length || k < 0 || k >= steps.length) return bricks;
  [steps[k], steps[j]] = [steps[j], steps[k]];
  return withSteps(bricks, steps);
}
