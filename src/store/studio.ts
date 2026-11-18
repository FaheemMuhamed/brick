import { create } from 'zustand';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { Brick } from '../building/snap';
import type { GuidedModel } from '../guided/guided';
import { syncSubmodels } from '../building/submodels';
import { authorSteps, stepsOf } from '../instructions/steps';

export type Tool = 'select' | 'place' | 'paint' | 'eyedropper' | 'hide' | 'clone' | 'ruler' | 'hose' | 'chain';
export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type StagePreset = 'daylight' | 'workshop' | 'night' | 'white';
export type CameraPreset = 'persp' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface SetBudget { set: string; name: string; parts: Record<string, number> } // key `${part}:${color}` → qty

interface StudioState {
  name: string;
  bricks: Brick[];
  past: Brick[][];
  future: Brick[][];
  selection: Set<string>;
  tool: Tool;
  heldPart: string | null;
  heldTurns: number;
  /** quarter turns of the held part about X (tilt) and Z (roll) */
  heldTilt: [number, number];
  color: number;
  quality: Quality;
  stage: StagePreset;
  dof: boolean;
  ao: boolean;
  /** X-ray: every part turns translucent except the selection */
  xray: boolean;
  /** Explode view: 0 = assembled, 1 = fully spread */
  explode: number;
  /** custom world (backdrop + floor) colour; null = the studio preset's own */
  world: string | null;
  /** Photo mode: progressive path-traced render */
  raytrace: boolean;
  /** switch to the path tracer automatically whenever the view has been still for a moment */
  idleTrace: boolean;
  /** true while the idle path tracer is showing */
  tracing: boolean;
  ptSamples: number;
  photo: boolean;
  onlyKnownColors: boolean;
  cameraRequest: { preset: CameraPreset | 'fit' | 'box'; t: number; box?: [number[], number[]] } | null;
  /** step-by-step build in progress */
  guided: { model: GuidedModel; step: number; placed: Set<string> } | null;
  /** a part driven like a motor (rpm, negative = reverse) */
  motor: { brick: string; rpm: number } | null;
  playing: boolean;
  /** what the mechanism solver found for the current motor */
  mech: { moving: number; meshes: number; jammed: boolean; canTurn: boolean } | null;
  /** stability heat-map on/off, and what it found */
  stabilityView: boolean;
  /** ruler tool: first point, second point, live end while measuring */
  ruler: { a: number[] | null; b: number[] | null; hover: number[] | null };
  /** hose tool: first end (position + outward direction), live cursor */
  hoseStart: { pos: number[]; dir: number[]; hover: number[] | null } | null;
  /** step editor: the step being shown/edited (later steps are hidden), or null when closed */
  stepEdit: number | null;
  /** chain tool: wheels picked so far, in loop order */
  chainPick: string[];
  stab: { weak: number; floating: number; worst: number } | null;
  /** physics test in progress (run increments to restart) */
  sim: { test: 'drop' | 'shake'; run: number } | null;
  simResult: { loose: number; total: number } | null;
  budget: SetBudget | null;
  hover: [number, number, number] | null;
  toast: string | null;

  commit: (next: Brick[], label?: string) => void;
  undo: () => void;
  redo: () => void;
  setTool: (t: Tool) => void;
  hold: (part: string | null) => void;
  rotateHeld: (dir?: 1 | -1) => void;
  tiltHeld: (axis: 'x' | 'z', dir?: 1 | -1) => void;
  setColor: (c: number) => void;
  select: (ids: string[], additive?: boolean) => void;
  set: (p: Partial<StudioState>) => void;
  camera: (preset: CameraPreset | 'fit') => void;
  notify: (msg: string) => void;
  newBuild: (name?: string, budget?: SetBudget | null) => void;
}

let uid = Date.now();
export const newId = () => (uid++).toString(36);

export const useStudio = create<StudioState>((set, get) => ({
  name: 'Untitled build',
  bricks: [],
  past: [],
  future: [],
  selection: new Set(),
  tool: 'select',
  heldPart: null,
  heldTurns: 0,
  heldTilt: [0, 0],
  color: 4,
  quality: 'high',
  stage: 'daylight',
  dof: true,
  ao: true,
  xray: false,
  explode: 0,
  world: null,
  raytrace: false,
  idleTrace: true,
  tracing: false,
  ptSamples: 0,
  photo: false,
  onlyKnownColors: true,
  cameraRequest: null,
  guided: null,
  motor: null,
  playing: false,
  mech: null,
  stabilityView: false,
  ruler: { a: null, b: null, hover: null },
  hoseStart: null,
  stepEdit: null,
  chainPick: [],
  stab: null,
  sim: null,
  simResult: null,
  budget: null,
  hover: null,
  toast: null,

  // every edit passes through the submodel sync, so linked copies follow per-part changes
  commit: (next) => set((s) => {
    let bricks = syncSubmodels(s.bricks, next, newId);
    let stepEdit = s.stepEdit;
    if (stepEdit != null) {
      // while editing steps, new parts join the step on screen; steps stay numbered 0..n-1
      const had = new Set(s.bricks.map((b) => b.id));
      bricks = authorSteps(bricks.map((b) => (had.has(b.id) || b.step != null ? b : { ...b, step: stepEdit! })));
      stepEdit = Math.max(0, Math.min(stepEdit, stepsOf(bricks).length - 1));
    }
    return { bricks, stepEdit, past: [...s.past.slice(-199), s.bricks], future: [] };
  }),
  undo: () => set((s) => (s.past.length ? { bricks: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.bricks, ...s.future], selection: new Set() } : s)),
  redo: () => set((s) => (s.future.length ? { bricks: s.future[0], future: s.future.slice(1), past: [...s.past, s.bricks], selection: new Set() } : s)),
  setTool: (tool) => set({ tool, heldPart: tool === 'place' ? get().heldPart : null, ruler: { a: null, b: null, hover: null }, hoseStart: null, chainPick: [] }),
  hold: (heldPart) => set({ heldPart, heldTilt: [0, 0], tool: heldPart ? 'place' : 'select', selection: new Set() }),
  rotateHeld: (dir = 1) => set((s) => ({ heldTurns: (s.heldTurns + dir + 4) % 4 })),
  tiltHeld: (axis, dir = 1) => set((s) => {
    const t = [...s.heldTilt] as [number, number];
    const i = axis === 'x' ? 0 : 1;
    t[i] = (t[i] + dir + 4) % 4;
    return { heldTilt: t };
  }),
  setColor: (color) => set({ color }),
  select: (ids, additive) => set((s) => {
    if (!additive) return { selection: new Set(ids) };
    const n = new Set(s.selection);
    for (const id of ids) n.has(id) ? n.delete(id) : n.add(id);
    return { selection: n };
  }),
  set: (p) => set(p as any),
  camera: (preset) => set({ cameraRequest: { preset, t: performance.now() } }),
  notify: (toast) => {
    set({ toast });
    setTimeout(() => get().toast === toast && set({ toast: null }), 2600);
  },
  newBuild: (name = 'Untitled build', budget = null) => set({ name, bricks: [], past: [], future: [], selection: new Set(), budget, heldPart: null, tool: 'select', guided: null, motor: null, playing: false, sim: null, simResult: null, stepEdit: null }),
}));

// ---------- autosave ----------
const KEY = 'brick-atelier:current';
/** ?sandbox in the URL: a throwaway session that never reads or writes the saved build (used for testing). */
const SANDBOX = typeof location !== 'undefined' && new URLSearchParams(location.search).has('sandbox');
export async function restoreBuild() {
  if (SANDBOX) return;
  try {
    const saved = await idbGet(KEY);
    if (saved?.bricks) useStudio.setState({ name: saved.name, bricks: saved.bricks, budget: saved.budget ?? null });
  } catch { /* storage unavailable: start empty */ }
}
let t: ReturnType<typeof setTimeout> | undefined;
useStudio.subscribe((s, prev) => {
  if (SANDBOX || (s.bricks === prev.bricks && s.name === prev.name && s.budget === prev.budget)) return;
  clearTimeout(t);
  t = setTimeout(() => idbSet(KEY, { name: s.name, bricks: s.bricks, budget: s.budget }).catch(() => {}), 400);
});

/** How many of each part:color the current build uses. */
export function usage(bricks: Brick[]) {
  const m = new Map<string, number>();
  for (const b of bricks) m.set(`${b.part}:${b.color}`, (m.get(`${b.part}:${b.color}`) || 0) + 1);
  return m;
}

/** Export as an LDraw .ldr file (positions converted back to LDU, Y-down). */
export function toLDraw(name: string, bricks: Brick[]) {
  const lines = [`0 ${name}`, '0 Name: ' + name.replace(/\s+/g, '_') + '.ldr', '0 Author: Brick Atelier', ''];
  for (const b of bricks) {
    if (b.part === 'hose' || b.part === 'chain') continue; // hoses and chain loops have no single LDraw part
    const [x, y, z, w] = b.quat;
    // rotation matrix from quaternion, then conjugate by diag(1,-1,-1) to go back to LDraw axes
    const m = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
    const s = [1, -1, -1];
    const r = m.map((v, i) => +(v * s[Math.floor(i / 3)] * s[i % 3]).toFixed(5));
    lines.push(`1 ${b.color} ${+(b.pos[0] * 20).toFixed(2)} ${+(-b.pos[1] * 20).toFixed(2)} ${+(-b.pos[2] * 20).toFixed(2)} ${r.join(' ')} ${b.part}.dat`);
  }
  return lines.join('\n') + '\n';
}

if (import.meta.env.DEV && typeof window !== 'undefined') (window as any).studio = useStudio; // console access while developing
