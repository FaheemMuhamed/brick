import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Blender-style selection outline: a constant-width silhouette drawn around the selected part.
// 1) the part writes 1 into the stencil buffer (invisible), 2) a copy pushed outward along averaged
// normals in screen space is drawn only where the stencil is NOT 1, leaving just the rim.

export const OUTLINE_ACTIVE = '#FFAA40'; // Blender's active-object orange
export const OUTLINE_SELECTED = '#E8762B'; // other selected objects

const smoothCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** Geometry with one averaged normal per position, so the pushed-out shell has no cracks at hard edges. */
function smoothShell(g: THREE.BufferGeometry) {
  let s = smoothCache.get(g);
  if (!s) {
    const tmp = new THREE.BufferGeometry();
    tmp.setAttribute('position', g.getAttribute('position'));
    s = mergeVertices(tmp, 1e-3);
    s.computeVertexNormals();
    smoothCache.set(g, s);
  }
  return s;
}

const maskMaterial = new THREE.MeshBasicMaterial({
  colorWrite: false, depthWrite: false, depthTest: false,
  stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
});

const shellCache = new Map<string, THREE.ShaderMaterial>();
function shellMaterial(color: string, px: number, size: THREE.Vector2) {
  const key = color + px;
  let m = shellCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uWidth: { value: px }, uRes: { value: size.clone() } },
      vertexShader: /* glsl */ `
        uniform float uWidth; uniform vec2 uRes;
        void main() {
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          vec4 clipN = projectionMatrix * vec4(n, 0.0);
          vec2 dir = normalize(clipN.xy + 1e-6);
          clip.xy += dir * uWidth * 2.0 / uRes * clip.w;   // constant width in pixels
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
      depthTest: false, depthWrite: false, transparent: true,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
    });
    shellCache.set(key, m);
  }
  m.uniforms.uRes.value.copy(size);
  return m;
}

export function SelectionOutline({ geometry, position, quaternion, active }: {
  geometry: THREE.BufferGeometry; position: THREE.Vector3Tuple; quaternion: THREE.Vector4Tuple; active: boolean;
}) {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const res = useMemo(() => new THREE.Vector2(size.width * dpr, size.height * dpr), [size, dpr]);
  const shell = useMemo(() => smoothShell(geometry), [geometry]);
  const mat = shellMaterial(active ? OUTLINE_ACTIVE : OUTLINE_SELECTED, 3 * dpr, res);
  return (
    <group position={position} quaternion={quaternion}>
      <mesh geometry={geometry} material={maskMaterial} renderOrder={20} raycast={() => null} />
      <mesh geometry={shell} material={mat} renderOrder={21} raycast={() => null} />
    </group>
  );
}

