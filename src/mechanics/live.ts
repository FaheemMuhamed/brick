import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';
import { buildGraph, solve, turned, type Graph, type Motion } from './mechanics';

/** The mechanism currently being played, read every frame by the renderer. */
export interface LiveMechanism {
  graph: Graph;
  motion: Motion;
  started: number;
  /** turned transform for a brick at clock time t (seconds), or null if it doesn't move */
  xform(b: Brick, t: number): { pos: THREE.Vector3; quat: THREE.Quaternion } | null;
}

export const live: { current: LiveMechanism | null; physics: { xform(b: Brick, t: number): { pos: THREE.Vector3; quat: THREE.Quaternion } | null } | null } = { current: null, physics: null };

export function analyse(bricks: Brick[], parts: Map<string, Part>, driver: string, rpm: number) {
  const graph = buildGraph(bricks, parts);
  const omega = (rpm * Math.PI * 2) / 60;
  const motion = solve(graph, driver, omega);
  return { graph, motion };
}

export function startLive(graph: Graph, motion: Motion, now: number): LiveMechanism {
  return {
    graph, motion, started: now,
    xform(b, t) {
      const body = graph.bodyOf.get(b.id);
      const s = body ? motion.spin.get(body) : undefined;
      if (!s || s.omega === 0) return null;
      return turned(b, s.axis, s.pivot, s.omega * (t - this.started));
    },
  };
}
