import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';

/** The live camera and canvas, shared with DOM overlays (box-select) that live outside the 3D tree. */
export const bridge: { camera: THREE.Camera | null; canvas: HTMLCanvasElement | null } = { camera: null, canvas: null };

/** Ids of visible parts whose on-screen footprint centre lies inside a client-space rectangle. */
export function bricksInRect(rect: { x0: number; y0: number; x1: number; y1: number }, bricks: Brick[], parts: Map<string, Part>): string[] {
  const { camera, canvas } = bridge;
  if (!camera || !canvas) return [];
  const r = canvas.getBoundingClientRect();
  const minX = Math.min(rect.x0, rect.x1), maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1), maxY = Math.max(rect.y0, rect.y1);
  const m = new THREE.Matrix4();
  const out: string[] = [];
  for (const b of bricks) {
    const part = parts.get(b.part);
    if (!part || b.hidden) continue;
    m.compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
    const c = part.box.getCenter(new THREE.Vector3()).applyMatrix4(m).project(camera);
    if (c.z > 1) continue; // behind the camera
    const x = r.left + ((c.x + 1) / 2) * r.width;
    const y = r.top + ((1 - c.y) / 2) * r.height;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) out.push(b.id);
  }
  return out;
}
