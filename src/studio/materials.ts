import * as THREE from 'three';
import type { BrickColor } from '../data/library';

const cache = new Map<string, THREE.Material>();

/** Physically-based ABS plastic, with special finishes for trans / chrome / metal / pearl / rubber / glow. */
export function brickMaterial(c: BrickColor | undefined, variant: 'normal' | 'ghost' | 'xray' = 'normal'): THREE.Material {
  const key = `${c?.code ?? -1}:${variant}`;
  let m = cache.get(key);
  if (m) return m;
  const color = new THREE.Color(c?.hex ?? '#A0A5A9');
  const p = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22, specularIntensity: 0.6, ior: 1.46 });
  switch (c?.finish) {
    case 'trans':
      Object.assign(p, { transmission: 0.96, thickness: 0.6, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05, attenuationColor: color, attenuationDistance: 1.4 });
      p.transparent = false;
      break;
    case 'chrome': Object.assign(p, { metalness: 1, roughness: 0.12, clearcoat: 1 }); break;
    case 'metal': Object.assign(p, { metalness: 0.85, roughness: 0.32 }); break;
    case 'pearl': Object.assign(p, { metalness: 0.45, roughness: 0.28, iridescence: 0.35, iridescenceIOR: 1.3 }); break;
    case 'rubber': Object.assign(p, { roughness: 0.82, clearcoat: 0, specularIntensity: 0.25 }); break;
    case 'glow': Object.assign(p, { emissive: color, emissiveIntensity: 0.6 }); break;
    case 'glitter': case 'speckle': Object.assign(p, { metalness: 0.2, roughness: 0.35, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') }); break;
  }
  if (variant === 'xray') {
    // see-through shell: keeps the part's colour so you can still read the model
    p.transparent = true; p.opacity = 0.16; p.transmission = 0; p.depthWrite = false; p.clearcoat = 0;
  }
  if (variant === 'ghost') {
    p.transparent = true; p.opacity = 0.55; p.transmission = 0; p.depthWrite = false;
  }
  cache.set(key, (m = p));
  return m;
}

export const selectionMaterial = new THREE.MeshBasicMaterial({ color: '#3D7BFF', transparent: true, opacity: 0.28, depthWrite: false });
export const invalidMaterial = new THREE.MeshBasicMaterial({ color: '#E0392F', transparent: true, opacity: 0.5, depthWrite: false });
