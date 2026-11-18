import * as THREE from 'three';

/** World units: 1 = one stud pitch (20 LDU). LDraw is Y-down; we rotate π about X (y→-y, z→-z). */
export const LDU = 1 / 20;
export const PLATE = 8 * LDU; // 0.4
export const BRICK = 24 * LDU; // 1.2

export const ldrawToWorld = new THREE.Matrix4().makeRotationX(Math.PI).multiply(new THREE.Matrix4().makeScale(LDU, LDU, LDU));

export function ldPoint(p: number[]): THREE.Vector3 {
  return new THREE.Vector3(p[0] * LDU, -p[1] * LDU, -p[2] * LDU);
}
export function ldDir(a: number[]): THREE.Vector3 {
  return new THREE.Vector3(a[0], -a[1], -a[2]).normalize();
}
