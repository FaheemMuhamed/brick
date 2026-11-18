import { useStudio } from '../store/studio';
import type { Brick } from '../building/snap';
import type { Part } from '../data/library';
import { targetsBox, type GuidedModel, type Target } from './guided';
import * as sfx from '../lib/sound';

const strip = (t: Target): Brick => ({ id: t.id, part: t.part, color: t.color, pos: t.pos, quat: t.quat });

let partsRef: Map<string, Part> = new Map();
export const setGuidedParts = (p: Map<string, Part>) => { partsRef = p; };

/** Point the camera at a step's new parts, with the finished parts around them for context. */
export function frameStep(step = useStudio.getState().guided?.step ?? 0) {
  const g = useStudio.getState().guided;
  if (!g) return;
  const targets = g.model.steps[step] ?? [];
  const box = targetsBox(targets, partsRef);
  if (box.isEmpty()) return;
  box.expandByScalar(2.5);
  useStudio.setState({ cameraRequest: { preset: 'box', t: performance.now(), box: [box.min.toArray(), box.max.toArray()] } });
}

export function startGuided(model: GuidedModel) {
  const s = useStudio.getState();
  s.newBuild(model.name, null);
  useStudio.setState({ guided: { model, step: 0, placed: new Set() }, tool: 'select', explode: 0 });
  setTimeout(() => frameStep(0), 50);
}

export function exitGuided() {
  useStudio.setState({ guided: null, heldPart: null });
}

function advanceIfDone() {
  const s = useStudio.getState();
  const g = s.guided!;
  const step = g.model.steps[g.step];
  if (!step.every((t) => g.placed.has(t.id))) return;
  if (g.step >= g.model.steps.length - 1) {
    sfx.snap(8);
    useStudio.setState({ heldPart: null, guided: { ...g, step: g.model.steps.length } });
    s.notify(`Finished! ${g.model.name} is complete.`);
    return;
  }
  sfx.rustle();
  useStudio.setState({ heldPart: null, guided: { ...g, step: g.step + 1 } });
  frameStep(g.step + 1);
}

/** The builder placed a part on one of this step's targets. */
export function placeTarget(t: Target) {
  const s = useStudio.getState();
  const g = s.guided;
  if (!g || g.placed.has(t.id)) return;
  const placed = new Set(g.placed).add(t.id);
  s.commit([...s.bricks, strip(t)]);
  useStudio.setState({ guided: { ...g, placed } });
  const left = g.model.steps[g.step].filter((x) => !placed.has(x.id) && x.part === t.part && x.color === t.color).length;
  if (!left) useStudio.setState({ heldPart: null });
  advanceIfDone();
}

/** "Place for me": finish the current step in one go. */
export function autoStep() {
  const s = useStudio.getState();
  const g = s.guided;
  if (!g || g.step >= g.model.steps.length) return;
  const todo = g.model.steps[g.step].filter((t) => !g.placed.has(t.id));
  const placed = new Set(g.placed);
  todo.forEach((t) => placed.add(t.id));
  sfx.snap(todo.length);
  s.commit([...s.bricks, ...todo.map(strip)]);
  useStudio.setState({ guided: { ...g, placed } });
  advanceIfDone();
}

/** Jump to any step: everything before it is built, everything from it on is not. */
export function gotoStep(k: number) {
  const s = useStudio.getState();
  const g = s.guided;
  if (!g) return;
  const step = Math.max(0, Math.min(k, g.model.steps.length - 1));
  const before = g.model.steps.slice(0, step).flat();
  const keepIds = new Set(before.map((t) => t.id));
  const targetIds = new Set(g.model.steps.flat().map((t) => t.id));
  // parts the builder added on their own (not part of the guide) stay where they are
  const own = s.bricks.filter((b) => !targetIds.has(b.id));
  s.commit([...own, ...before.map(strip)]);
  useStudio.setState({ guided: { ...g, step, placed: keepIds }, heldPart: null });
  frameStep(step);
}
