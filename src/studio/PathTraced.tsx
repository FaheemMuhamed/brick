import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { WebGLPathTracer, GradientEquirectTexture } from 'three-gpu-pathtracer';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { loadPartGeometry, type BrickColor, type Part } from '../data/library';
import { brickMaterial } from './materials';
import { useStudio } from '../store/studio';
import { STAGES, worldColors } from './stages';
import type { Brick } from '../building/snap';

RectAreaLightUniformsLib.init();

/**
 * Progressive path tracer for Photo mode: true soft area-light shadows, light bouncing between bricks,
 * glossy reflections and real refraction through transparent parts. Builds its own plain-mesh copy of
 * the build (the tracer doesn't take instanced meshes) and takes over rendering while mounted.
 */
export default function PathTraced({ parts, colors }: { parts: Map<string, Part>; colors: Map<number, BrickColor> }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const bricks = useStudio((s) => s.bricks);
  const stage = STAGES[useStudio((s) => s.stage)];
  const world = worldColors(stage, useStudio((s) => s.world));
  const ready = useRef(false);
  const lastCam = useRef(new THREE.Matrix4());

  const pt = useMemo(() => getTracer(gl), [gl]);

  useEffect(() => {
    const prev = gl.toneMapping;
    gl.toneMapping = THREE.NeutralToneMapping;
    pt.reset();
    return () => { gl.toneMapping = prev; useStudio.setState({ ptSamples: 0 }); };
  }, [gl, pt]);

  // (Re)build the traced scene whenever the build or the world changes.
  useEffect(() => {
    let live = true;
    ready.current = false;
    (async () => {
      const scene = await buildScene(bricks.filter((b) => !b.hidden), parts, colors, world, stage.key);
      if (!live) return;
      pt.setScene(scene, camera); // synchronous BVH build (setSceneAsync needs a web worker)
      if (!live) return;
      lastCam.current.copy(camera.matrixWorld);
      ready.current = true;
    })().catch((e) => console.warn('path tracer setup failed', e));
    return () => { live = false; };
  }, [bricks, parts, colors, world.bg, world.floor, stage.key, pt, camera]); // eslint-disable-line

  // priority 1: R3F stops its own render; the tracer draws every frame (a sample per frame).
  useFrame(() => {
    if (!ready.current) { gl.render(new THREE.Scene(), camera); return; }
    camera.updateMatrixWorld();
    if (!lastCam.current.equals(camera.matrixWorld)) {
      lastCam.current.copy(camera.matrixWorld);
      pt.updateCamera();
    }
    pt.renderSample();
    const n = Math.floor(pt.samples);
    if (n % 4 === 0 && n !== useStudio.getState().ptSamples) useStudio.setState({ ptSamples: n });
  }, 1);

  return null;
}

async function buildScene(bricks: Brick[], parts: Map<string, Part>, colors: Map<number, BrickColor>, world: { bg: string; floor: string }, key: string) {
  const scene = new THREE.Scene();
  // backdrop matches the floor so the horizon dissolves instead of drawing a hard line
  scene.background = new THREE.Color(world.floor);
  // soft studio sky for image-based light: bright overhead, world-tinted towards the horizon
  const env = new GradientEquirectTexture(256);
  env.topColor.set('#ffffff');
  env.bottomColor.set(world.floor).multiplyScalar(0.55);
  env.exponent = 1.6;
  env.update();
  scene.environment = env;
  scene.environmentIntensity = 0.32;

  const box = new THREE.Box3();
  for (const b of bricks) {
    const part = parts.get(b.part);
    if (!part) continue;
    const g = await loadPartGeometry(b.part);
    const add = (geometry: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.Mesh(withUv(geometry), tracedMaterial(mat));
      m.position.set(...b.pos);
      m.quaternion.set(...b.quat);
      scene.add(m);
    };
    if (g.main) add(g.main, brickMaterial(colors.get(b.color)));
    for (const f of g.fixed) add(f.geometry, brickMaterial(colors.get(f.color)));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
    box.union(part.box.clone().applyMatrix4(m));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 2, 4));
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(6, box.getSize(new THREE.Vector3()).length());

  // the floor: a matte studio sweep in the world colour
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: world.floor, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // big softbox key (area light = genuinely soft, physically correct shadows) + a dim opposite fill
  const keyLight = new THREE.RectAreaLight(key, 11, r * 1.1, r * 1.1);
  keyLight.position.set(c.x + r * 0.9, c.y + r * 1.3, c.z + r * 0.7);
  keyLight.lookAt(c);
  scene.add(keyLight);
  const fill = new THREE.RectAreaLight('#dfe8ff', 1.4, r, r);
  fill.position.set(c.x - r * 1.1, c.y + r * 0.5, c.z - r * 0.2);
  fill.lookAt(c);
  scene.add(fill);
  scene.updateMatrixWorld(true);
  return scene;
}

// The tracer merges every mesh into one buffer, so all geometries need the same attribute set (uv included).
const uvCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function withUv(g: THREE.BufferGeometry) {
  if (g.getAttribute('uv')) return g;
  let c = uvCache.get(g);
  if (!c) {
    c = g.clone();
    c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    uvCache.set(g, c);
  }
  return c;
}

// Double-sided copy of the brick material: LDraw parts include open/inner faces the tracer would otherwise see as black backfaces.
const matCache = new WeakMap<THREE.Material, THREE.Material>();
function tracedMaterial(m: THREE.Material) {
  let c = matCache.get(m);
  if (!c) {
    c = m.clone();
    c.side = THREE.DoubleSide;
    matCache.set(m, c);
  }
  return c;
}

const tracers = new WeakMap<THREE.WebGLRenderer, WebGLPathTracer>();
function getTracer(gl: THREE.WebGLRenderer) {
  let p = tracers.get(gl);
  if (!p) {
    p = new WebGLPathTracer(gl);
    p.renderDelay = 0;
    p.minSamples = 6;            // keep the raster frame until the trace is past its noisiest first samples
    p.fadeDuration = 350;          // the first traced samples fade in over the real-time frame
    p.bounces = 6;
    p.transmissiveBounces = 10;
    p.filterGlossyFactor = 0.35;
    p.tiles.set(2, 2);
    p.dynamicLowRes = true;        // quick low-res preview while the camera moves
    tracers.set(gl, p);
  }
  return p;
}
