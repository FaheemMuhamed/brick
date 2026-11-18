import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, Environment, Lightformer, Grid, PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, N8AO, Bloom, Vignette, ToneMapping, Noise } from '@react-three/postprocessing';
import { BackgroundBlurEffect } from './BackgroundBlur';
import { ToneMappingMode } from 'postprocessing';
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const PartsContext = createContext<Map<string, Part>>(new Map());
import { loadPartGeometry, type Part, type PartGeometry, type BrickColor } from '../data/library';
import { brickMaterial, invalidMaterial } from './materials';
import { useStudio, newId } from '../store/studio';
import { expandToGroups, follow, freshCopies } from '../building/groups';
import { collides, snapPlacement, worldBox, yaw90, tiltQuat, type Brick, type Placement } from '../building/snap';
import { STAGES, worldColors } from './stages';
import { SelectionOutline } from './Outline';
import Ruler, { snapPoint } from './Ruler';
import { stepsOf } from '../instructions/steps';
import ChainLoop from './ChainLoop';
import { finishChain } from '../mechanics/chainTool';
import { isVirtualPart, wheelOf } from '../mechanics/chain';
import { HOSE_PART, HosePreview, hoseAnchor, hoseGeometry, makeHose } from './Hose';
import PathTraced from './PathTraced';
import { bridge } from './bridge';
import { nearestTarget, type Target } from '../guided/guided';
import { placeTarget, setGuidedParts } from '../guided/actions';
import { analyse, live, startLive } from '../mechanics/live';
import { analyseStability } from '../mechanics/stability';
import { createSim, type Sim } from '../mechanics/physics';
import * as sfx from '../lib/sound';

interface Props { parts: Map<string, Part>; colors: Map<number, BrickColor> }

export default function Viewport({ parts, colors }: Props) {
  const stage = STAGES[useStudio((s) => s.stage)];
  const world = worldColors(stage, useStudio((s) => s.world));
  const quality = useStudio((s) => s.quality);
  const stillTrace = useStillTrace(); // always called (hooks must not be conditional)
  const photoTrace = useStudio((s) => s.photo && s.raytrace);
  const raytrace = photoTrace || stillTrace;
  const [dpr, setDpr] = useState(Math.min(window.devicePixelRatio, 2));
  return (
    <Canvas
      // variance shadow maps: soft, blurred edges and reliable brick-on-brick self-shadowing
      shadows="variance"
      dpr={dpr}
      camera={{ position: [14, 12, 16], fov: 32, near: 0.1, far: 600 }}
      gl={{ antialias: false, stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      onCreated={(state) => { state.gl.toneMapping = THREE.NoToneMapping; bridge.canvas = state.gl.domElement; if (import.meta.env.DEV) (window as any).__r3f = state; }}
      onPointerMissed={() => useStudio.getState().tool === 'select' && useStudio.getState().select([])}
    >
      <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(1, d - 0.5))} onIncline={() => setDpr((d) => Math.min(window.devicePixelRatio, d + 0.25))} />
      <color attach="background" args={[world.bg]} />
      <fog attach="fog" args={[world.bg, 60, 150]} />
      <Lights parts={parts} />
      <Scene parts={parts} colors={colors} />
      <Rig parts={parts} />
      {raytrace ? <PathTraced parts={parts} colors={colors} /> : <PartsContext.Provider value={parts}><Effects /></PartsContext.Provider>}
    </Canvas>
  );
}

/**
 * "Refine when still": after a moment without input the view hands over to the path tracer and keeps
 * refining; any pointer, wheel or key input (or a change to the build) returns to the real-time renderer.
 */
function useStillTrace() {
  // not during guided builds or step editing: the traced view can't show step targets or hide later steps
  const enabled = useStudio((s) => s.idleTrace && !s.heldPart && !s.guided && s.stepEdit == null && !s.playing && !s.sim && s.bricks.length > 0 && s.quality !== 'low');
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (!enabled) { setStill(false); return; }
    let t: ReturnType<typeof setTimeout> | undefined;
    const poke = () => { setStill(false); clearTimeout(t); t = setTimeout(() => setStill(true), 1300); };
    const evs = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const;
    evs.forEach((e) => window.addEventListener(e, poke, { passive: true }));
    const unsub = useStudio.subscribe((s, p) => { if (s.bricks !== p.bricks || s.selection !== p.selection || s.cameraRequest !== p.cameraRequest || s.world !== p.world || s.stage !== p.stage) poke(); });
    poke();
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, poke)); unsub(); };
  }, [enabled]);
  const on = enabled && still;
  useEffect(() => { useStudio.setState({ tracing: on }); }, [on]);
  return on;
}

// ---------------------------------------------------------------- lighting & stage
function Lights({ parts }: { parts: Map<string, Part> }) {
  const stage = STAGES[useStudio((s) => s.stage)];
  const world = worldColors(stage, useStudio((s) => s.world));
  const quality = useStudio((s) => s.quality);
  const bricks = useStudio((s) => s.bricks);
  const light = useRef<THREE.DirectionalLight>(null!);
  // Fit the shadow camera to the model so shadows stay crisp near contact.
  useLayoutEffect(() => {
    const box = modelBox(bricks, parts);
    const size = Math.max(12, box.getSize(new THREE.Vector3()).length() * 0.75);
    const center = box.getCenter(new THREE.Vector3());
    const l = light.current;
    // ~40° sun: low enough that taller bricks throw visible shadows across the tops and sides of their neighbours
    l.position.set(center.x + 18, center.y + 19, center.z + 12);
    l.target.position.copy(center);
    l.target.updateMatrixWorld();
    Object.assign(l.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 120 });
    l.shadow.camera.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }, [bricks, parts]);
  const mapSize = quality === 'ultra' ? 4096 : quality === 'low' ? 1024 : 2048;
  return (
    <>
      <directionalLight ref={light} castShadow color={stage.key} intensity={stage.keyIntensity} shadow-mapSize={[mapSize, mapSize]} shadow-bias={-0.0002} shadow-normalBias={0.01} shadow-radius={quality === 'ultra' ? 10 : 7} shadow-blurSamples={quality === 'ultra' ? 24 : 16} />
      <hemisphereLight args={[stage.fill, world.floor, 0.32]} />
      <Environment resolution={256} environmentIntensity={stage.envIntensity}>
        {/* softbox key, strip rim and a warm bounce: studio product-photo rig */}
        {/* The environment is for reflections, not fill: a dim surround keeps the key light's shadows readable
            (a bright surround lit bricks evenly from every side and washed every shadow out). */}
        <Lightformer form="rect" intensity={2.4} color={stage.key} position={[7, 8, 5]} scale={[8, 5, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.6} color={stage.rim} position={[-9, 4, -6]} scale={[2, 10, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.5} color={stage.fill} position={[-6, 3, 8]} scale={[8, 4, 1]} target={[0, 0, 0]} />
        <mesh scale={100}><sphereGeometry args={[1, 32, 16]} /><meshBasicMaterial color={new THREE.Color(world.bg).multiplyScalar(0.28)} side={THREE.BackSide} /></mesh>
      </Environment>
    </>
  );
}

function modelBox(bricks: Brick[], parts: Map<string, Part>) {
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const b of bricks) {
    const p = parts.get(b.part);
    if (!p || b.hidden) continue;
    m.compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
    box.union(p.box.clone().applyMatrix4(m));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 2, 4));
  return box;
}

// ---------------------------------------------------------------- post-processing
function Effects() {
  const quality = useStudio((s) => s.quality);
  const dof = useStudio((s) => s.dof);
  const ao = useStudio((s) => s.ao);
  const photo = useStudio((s) => s.photo);
  const dark = worldColors(STAGES[useStudio((s) => s.stage)], useStudio((s) => s.world)).dark;
  const gl = useThree((s) => s.gl);
  // the composer resizes its buffers on canvas size changes but not on pixel-ratio changes (PerformanceMonitor
  // lowers the ratio when frames drop): stale N8AO buffers then draw a grey, scaled copy of the model
  const pixelRatio = useThree((s) => s.viewport.dpr);
  const parts = useContext(PartsContext);
  const bricks = useStudio((s) => s.bricks);
  const model = useMemo(() => modelBox(bricks, parts), [bricks, parts]);
  const sphere = useMemo(() => model.getBoundingSphere(new THREE.Sphere()), [model]);
  const blur = useMemo(() => new BackgroundBlurEffect(), []);
  useEffect(() => () => (blur as any)?.dispose?.(), [blur]);
  useFrame(({ camera, size, viewport }) => {
    // Sharp up to the far side of the build (bounding sphere + margin), then blur ramps in with distance.
    // Zoomed far out the blur fades away completely, so an overview is always fully sharp.
    const dist = camera.position.distanceTo(sphere.center);
    const focusEnd = dist + sphere.radius * 1.1 + 0.6;
    const range = Math.max(4, dist * (photo ? 0.5 : 0.9));
    const fade = THREE.MathUtils.clamp((70 - dist) / 45, 0, 1);
    blur.set(focusEnd, range, (photo ? 16 : 9) * fade * viewport.dpr);
    blur.setSize(size.width * viewport.dpr, size.height * viewport.dpr);
  });
  useEffect(() => { gl.toneMapping = quality === 'low' ? THREE.NeutralToneMapping : THREE.NoToneMapping; }, [quality, gl]);
  if (quality === 'low') return null;
  return (
    // One convolution effect per pass: background blur when DoF is on, bloom otherwise.
    // No SMAA/MSAA: MSAA makes N8AO draw a ghost copy of the model; the 2x device pixel ratio smooths edges.
    <EffectComposer key={`${quality}-${dof}-${ao}-${photo}-${pixelRatio}`} multisampling={0} enableNormalPass={false} stencilBuffer>
      {/* blur first: it reads scene depth, and any depth-reading effect placed after N8AO gets a consumed depth buffer (blank frame) */}
      {dof ? <primitive object={blur} dispose={null} /> : <Bloom mipmapBlur intensity={dark ? 0.55 : 0.25} luminanceThreshold={0.92} luminanceSmoothing={0.1} />}
      {ao ? <N8AO aoRadius={0.9} distanceFalloff={0.6} intensity={quality === 'ultra' ? 2.4 : 2} quality={quality === 'ultra' ? 'high' : 'medium'} halfRes={false} /> : <></>}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.32} darkness={photo ? 0.55 : 0.32} />
      {photo ? <Noise opacity={0.025} premultiply /> : <></>}
    </EffectComposer>
  );
}

// ---------------------------------------------------------------- camera
function Rig({ parts }: { parts: Map<string, Part> }) {
  const ref = useRef<CameraControls>(null!);
  const cam = useThree((s) => s.camera);
  const glEl = useThree((s) => s.gl.domElement);
  useEffect(() => { bridge.camera = cam; bridge.canvas = glEl; }, [cam, glEl]);
  const req = useStudio((s) => s.cameraRequest);
  const photo = useStudio((s) => s.photo);
  const held = useStudio((s) => s.heldPart);
  // Camera vs building input:
  //  - right-drag orbits, Shift+right-drag or middle-drag pans, wheel / pinch zooms (always)
  //  - left-drag orbits only on empty space and only while nothing is in hand;
  //    with a part in hand the left button is reserved for placing, so a drag can never drop a part
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ROTATE = 1, TRUCK = 2, DOLLY = 16, NONE = 0;
    const apply = (shift: boolean) => {
      // Shift+left is box-select, so it never orbits
      c.mouseButtons.left = held || shift ? NONE : ROTATE;
      c.mouseButtons.right = shift ? TRUCK : ROTATE;
      c.mouseButtons.middle = TRUCK;
      c.mouseButtons.wheel = DOLLY;
    };
    apply(false);
    const kd = (e: KeyboardEvent) => e.key === 'Shift' && apply(true);
    const ku = (e: KeyboardEvent) => e.key === 'Shift' && apply(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [held]);
  useEffect(() => {
    if (!req || !ref.current) return;
    const c = ref.current;
    const box = modelBox(useStudio.getState().bricks, parts);
    const ctr = box.getCenter(new THREE.Vector3());
    const r = Math.max(16, box.getSize(new THREE.Vector3()).length() * 2.2);
    const at = (x: number, y: number, z: number) => c.setLookAt(ctr.x + x * r, ctr.y + y * r, ctr.z + z * r, ctr.x, ctr.y, ctr.z, true);
    switch (req.preset) {
      case 'front': at(0, 0.05, 1); break;
      case 'back': at(0, 0.05, -1); break;
      case 'left': at(-1, 0.05, 0); break;
      case 'right': at(1, 0.05, 0); break;
      case 'top': at(0, 1, 0.001); break;
      case 'bottom': at(0, -1, 0.001); break;
      case 'persp': at(0.62, 0.55, 0.72); break;
      case 'fit': c.fitToBox(box, true, { paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 }); break;
      case 'box': {
        // guided step: keep the current viewing angle, frame the step's parts
        // frame the step from a friendly 3/4 angle, close enough to see the new parts clearly
        const b = new THREE.Box3(new THREE.Vector3(...req.box![0]), new THREE.Vector3(...req.box![1]));
        const bc = b.getCenter(new THREE.Vector3());
        const d = Math.max(9, b.getSize(new THREE.Vector3()).length() * 1.9);
        const dir = new THREE.Vector3(0.62, 0.62, 0.72).normalize();
        c.setLookAt(bc.x + dir.x * d, bc.y + dir.y * d, bc.z + dir.z * d, bc.x, bc.y, bc.z, true);
        break;
      }
    }
  }, [req, parts]);
  const raytrace = useStudio((s) => s.raytrace);
  useFrame((_, dt) => { if (photo && !raytrace && ref.current) ref.current.azimuthAngle += dt * 0.15; });
  return <CameraControls ref={ref} makeDefault smoothTime={0.22} minDistance={2} maxDistance={160} maxPolarAngle={Math.PI * 0.49} />;
}

// ---------------------------------------------------------------- bricks & interaction
interface Pointer { down: { x: number; y: number; id: string | null; alt: boolean } | null }

function Scene({ parts, colors }: Props) {
  const bricks = useStudio((s) => s.bricks);
  const selection = useStudio((s) => s.selection);
  const tool = useStudio((s) => s.tool);
  const heldPart = useStudio((s) => s.heldPart);
  const heldTurns = useStudio((s) => s.heldTurns);
  const color = useStudio((s) => s.color);
  const moving = useRef<{ pivot: Brick; others: Brick[]; copy: boolean } | null>(null);
  const [followers, setFollowers] = useState<{ bricks: Brick[]; valid: boolean } | null>(null);
  const guidedTarget = useRef<Target | null>(null);
  const guided = useStudio((s) => s.guided);
  useEffect(() => setGuidedParts(parts), [parts]);
  const motor = useStudio((s) => s.motor);
  const playing = useStudio((s) => s.playing);
  const clock = useThree((s) => s.clock);
  useEffect(() => {
    if (!motor || !bricks.some((b) => b.id === motor.brick)) { live.current = null; useStudio.setState({ mech: null, ...(motor ? { motor: null, playing: false } : {}) }); return; }
    const { graph, motion } = analyse(bricks, parts, motor.brick, motor.rpm);
    useStudio.setState({ mech: { moving: motion.moving, meshes: graph.meshes.filter((m) => motion.spin.has(graph.bodyOf.get(m.a)!)).length, jammed: motion.jammed, canTurn: motion.spin.size > 0 } });
    live.current = playing && motion.spin.size ? startLive(graph, motion, clock.elapsedTime) : null;
  }, [bricks, parts, motor, playing, clock]);
  const pointer = useRef<Pointer>({ down: null });
  const [ghost, setGhost] = useState<Placement | null>(null);
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const stage = STAGES[useStudio((s) => s.stage)];
  const world = worldColors(stage, useStudio((s) => s.world));

  const stepEdit = useStudio((s) => s.stepEdit);
  // step editor: parts of later steps are not built yet; the current step's parts are tinted
  const stepView = useMemo(() => {
    if (stepEdit == null) return null;
    const steps = stepsOf(bricks);
    return { later: new Set(steps.slice(stepEdit + 1).flat().map((b) => b.id)), current: steps[stepEdit] ?? [] };
  }, [bricks, stepEdit]);
  const groups = useMemo(() => {
    const g = new Map<string, Brick[]>();
    for (const b of bricks) {
      if (b.hidden || isVirtualPart(b.part) || stepView?.later.has(b.id)) continue;
      const k = `${b.part}|${b.color}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(b);
    }
    return g;
  }, [bricks, stepView]);
  const byId = useMemo(() => new Map(bricks.map((b) => [b.id, b])), [bricks]);
  const explode = useStudio((s) => s.explode);
  const xray = useStudio((s) => s.xray);
  const explodeFn = useMemo(() => {
    if (explode <= 0) return null;
    const box = modelBox(bricks, parts);
    const c = box.getCenter(new THREE.Vector3());
    const e = explode * explode * (3 - 2 * explode); // smoothstep: gentle start and end
    return (p: [number, number, number]): [number, number, number] => [
      p[0] + (p[0] - c.x) * e * 0.9,
      p[1] + (p[1] - box.min.y) * e * 1.6,
      p[2] + (p[2] - c.z) * e * 0.9,
    ];
  }, [explode, bricks, parts]);

  const heldTilt = useStudio((s) => s.heldTilt);
  const heldQuat = useMemo(() => {
    const q = new THREE.Quaternion(...((moving.current?.pivot.quat ?? [0, 0, 0, 1]) as [number, number, number, number]));
    q.premultiply(tiltQuat(heldTilt));
    for (let i = 0; i < heldTurns; i++) q.premultiply(yaw90);
    return q;
  }, [heldTurns, heldTilt, heldPart]);

  useEffect(() => { if (!heldPart) { setGhost(null); setFollowers(null); } }, [heldPart]);
  // Escape while moving puts everything back where it was.
  useEffect(() => {
    if (!heldPart && moving.current) {
      const m = moving.current;
      moving.current = null;
      if (m.copy) return;
      const s = useStudio.getState();
      const back = [m.pivot, ...m.others].filter((b) => !s.bricks.some((x) => x.id === b.id));
      if (back.length) useStudio.setState({ bricks: [...s.bricks, ...back] });
    }
  }, [heldPart]);

  const movingIds = () => new Set(moving.current && !moving.current.copy ? [moving.current.pivot.id, ...moving.current.others.map((b) => b.id)] : []);
  /** Followers placed relative to the pivot's ghost, and whether all of them fit. */
  const placeFollowers = (pl: Placement, rest: Brick[]) => {
    const m = moving.current;
    if (!m || !m.others.length) return null;
    const moved = follow(m.pivot, pl.pos, pl.quat, m.others);
    const valid = moved.every((b) => {
      const part = parts.get(b.part);
      return part && !collides({ parts, bricks: rest }, part, new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat));
    });
    return { bricks: moved, valid };
  };

  const resolve = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const obj = e.object as THREE.InstancedMesh & { userData: { ids?: string[]; ground?: boolean } };
    const brick = obj.userData.brickId ? byId.get(obj.userData.brickId) ?? null : obj.userData.ids && e.instanceId != null ? byId.get(obj.userData.ids[e.instanceId]) ?? null : null;
    const normal = e.face ? e.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    if (brick) normal.applyQuaternion(new THREE.Quaternion(...brick.quat));
    return { brick, normal, point: e.point.clone() };
  };

  const updateGhost = (e: ThreeEvent<PointerEvent>) => {
    const s = useStudio.getState();
    const { brick, normal, point } = resolve(e);
    if (s.tool === 'ruler' && s.ruler.a && !s.ruler.b) s.set({ ruler: { ...s.ruler, hover: snapPoint(point).toArray() } });
    if (s.tool === 'hose' && s.hoseStart) s.set({ hoseStart: { ...s.hoseStart, hover: hoseAnchor(point, normal, brick, brick ? parts.get(brick.part) : undefined).pos.toArray() } });
    s.set({ hover: brick ? [point.x, point.y, point.z] : null });
    if (!s.heldPart) return;
    const held = parts.get(s.heldPart);
    if (!held) return;
    if (s.guided && !moving.current) {
      const step = s.guided.model.steps[s.guided.step] ?? [];
      const t = nearestTarget(step, s.guided.placed, s.heldPart, s.color, point);
      guidedTarget.current = t;
      const pl: Placement = t
        ? { pos: new THREE.Vector3(...t.pos), quat: new THREE.Quaternion(...t.quat), valid: true, snapped: true }
        : { ...snapPlacement({ parts, bricks: s.bricks }, held, heldQuat, point, normal, brick), valid: false };
      setFollowers(null);
      setGhost((prev) => { if (!prev || !prev.pos.equals(pl.pos)) sfx.tick(); return pl; });
      return;
    }
    const ids = movingIds();
    const rest = s.bricks.filter((b) => !ids.has(b.id));
    const next = snapPlacement({ parts, bricks: rest }, held, heldQuat, point, normal, brick, s.heldTurns);
    const f = placeFollowers(next, rest);
    if (f && !f.valid) next.valid = false;
    setFollowers(f);
    setGhost((prev) => {
      if (!prev || !prev.pos.equals(next.pos)) sfx.tick();
      return next;
    });
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const { brick } = resolve(e);
    pointer.current.down = { x: e.clientX, y: e.clientY, id: brick?.id ?? null, alt: e.altKey };
    // grabbing a brick should not orbit the camera
    if (brick && controls) controls.enabled = false;
  };
  const onUp = () => {
    if (controls) controls.enabled = true;
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation(); // nearest hit only: the baseplate behind a brick must not move the ghost
    const d = pointer.current.down;
    const s = useStudio.getState();
    if (d && d.id && s.tool === 'select' && !s.heldPart && !e.shiftKey && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      // drag to pick up (Studio-style move). Dragging a selected part carries the whole selection;
      // dragging a grouped part carries its group. Alt-drag leaves the originals and drops a copy.
      const b = byId.get(d.id);
      // a hose can ride along with a selection but is not a part you can hold by itself
      if (b && !isVirtualPart(b.part)) {
        const ids = new Set(expandToGroups(s.selection.has(b.id) ? s.selection : [b.id], s.bricks));
        const others = s.bricks.filter((x) => ids.has(x.id) && x.id !== b.id);
        const copy = d.alt || e.altKey; // read at press time: some pointers drop modifier state on move events
        moving.current = { pivot: b, others, copy };
        pointer.current.down = null;
        useStudio.setState({
          bricks: copy ? s.bricks : s.bricks.filter((x) => !ids.has(x.id)),
          heldPart: b.part, heldTurns: 0, heldTilt: [0, 0], color: b.color, tool: 'place', selection: new Set(),
        });
      }
    }
    updateGhost(e);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const d = pointer.current.down;
    pointer.current.down = null;
    if (controls) controls.enabled = true;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // was an orbit drag
    const s = useStudio.getState();
    const { brick } = resolve(e);
    switch (s.tool) {
      case 'place': {
        if (!ghost || !s.heldPart) return;
        if (s.guided && !moving.current) {
          const t = guidedTarget.current;
          if (!t || !ghost.valid) { sfx.bump(); return s.notify("This step doesn't use that part here. Pick one from the step's parts."); }
          sfx.snap(parts.get(t.part)?.connectors.filter((c) => c.kind === 'anti').length || 2);
          guidedTarget.current = null;
          placeTarget(t);
          return;
        }
        // re-check at click time: the ghost may be stale if the previous click placed a part right here
        const held = parts.get(s.heldPart);
        const ids = movingIds();
        const rest = s.bricks.filter((b) => !ids.has(b.id));
        const f = placeFollowers(ghost, rest);
        if (!ghost.valid || (f && !f.valid) || (held && collides({ parts, bricks: rest }, held, ghost.pos, ghost.quat))) { sfx.bump(); return s.notify(held && worldBox(held, ghost.pos, ghost.quat).min.y < -0.05 ? 'That would go through the floor. Build it higher, or turn it with R / T / Y.' : 'That spot is taken — try another stud.'); }
        sfx.snap(held ? held.connectors.filter((c) => c.kind === 'anti').length || 1 : 2);
        const m = moving.current;
        const nb: Brick = { ...(m?.pivot ?? {}), id: m && !m.copy ? m.pivot.id : newId(), part: s.heldPart, color: s.color, pos: ghost.pos.toArray() as Brick['pos'], quat: ghost.quat.toArray() as Brick['quat'] } as Brick;
        if (m) {
          let placed = [nb, ...(f?.bricks ?? [])];
          if (m.copy) placed = freshCopies(placed, newId);
          const placedIds = new Set(placed.map((b) => b.id));
          moving.current = null;
          // one undo step: originals → their new place (or originals + copies)
          const before = m.copy ? s.bricks : [...s.bricks, m.pivot, ...m.others];
          useStudio.setState({ bricks: before });
          s.commit([...before.filter((b) => !placedIds.has(b.id)), ...placed]);
          useStudio.setState({ heldPart: null, tool: 'select', selection: placedIds });
          setFollowers(null);
        } else {
          s.commit([...s.bricks, nb]);
        }
        return;
      }
      case 'select':
        // clicking a grouped part selects its whole group; Alt-click picks the single part
        if (brick) s.select(e.altKey ? [brick.id] : expandToGroups([brick.id], s.bricks), e.shiftKey || e.metaKey);
        else if (!e.shiftKey) s.select([]);
        return;
      case 'paint':
        if (brick && brick.color !== s.color) sfx.pop(), s.commit(s.bricks.map((b) => (b.id === brick.id ? { ...b, color: s.color } : b)));
        return;
      case 'eyedropper':
        if (brick) { sfx.pop(); s.setColor(brick.color); s.set({ tool: 'paint' }); s.notify(`Picked ${colors.get(brick.color)?.name ?? 'colour'}`); }
        return;
      case 'hide':
        if (brick) { sfx.clack(); s.commit(s.bricks.map((b) => (b.id === brick.id ? { ...b, hidden: true } : b))); }
        return;
      case 'chain': {
        if (!brick) return;
        if (!wheelOf(brick, parts.get(brick.part))) { sfx.bump(); return s.notify('Click gears or tread sprockets to run a chain around them.'); }
        const pick = s.chainPick;
        if (pick.length >= 2 && pick[0] === brick.id) return finishChain(parts);
        if (pick.includes(brick.id)) return;
        const next = [...pick, brick.id];
        s.set({ chainPick: next });
        s.select(next);
        sfx.tick();
        s.notify(next.length === 1 ? 'Now click the next wheel along the loop.' : 'Add more wheels, or click the first one again (or press Enter) to close the loop.');
        return;
      }
      case 'hose': {
        const { normal } = resolve(e);
        const end = hoseAnchor(e.point.clone(), normal, brick, brick ? parts.get(brick.part) : undefined);
        if (!s.hoseStart) { s.set({ hoseStart: { pos: end.pos.toArray(), dir: end.dir.toArray(), hover: null } }); sfx.tick(); return; }
        const a = new THREE.Vector3(...s.hoseStart.pos), na = new THREE.Vector3(...s.hoseStart.dir);
        if (a.distanceTo(end.pos) < 0.3) return;
        s.commit([...s.bricks, makeHose(newId(), s.color, a, na, end.pos, end.dir)]);
        s.set({ hoseStart: null });
        sfx.snap(2);
        return;
      }
      case 'ruler': {
        const p = snapPoint(e.point.clone()).toArray();
        const r = s.ruler;
        // first click starts, second click finishes; a third click starts a new measurement
        s.set({ ruler: !r.a || r.b ? { a: p, b: null, hover: p } : { ...r, b: p } });
        return;
      }
      case 'clone':
        if (brick) { s.setColor(brick.color); s.hold(brick.part); }
        return;
    }
  };

  const handlers = { onPointerDown: onDown, onPointerUp: onUp, onPointerMove: onMove, onClick };
  const ghostPart = heldPart ? parts.get(heldPart) : null;

  return (
    <group>
      {[...groups.entries()].map(([k, list]) => {
        const [part, c] = k.split('|');
        const p = parts.get(part);
        return p ? <PartInstances key={k} part={p} color={colors.get(Number(c))} colors={colors} bricks={list} handlers={handlers} offset={explodeFn} xray={xray} /> : null;
      })}
      {[...selection].map((id, i, all) => {
        const b = byId.get(id);
        // the most recently picked part is "active" (bright orange), like Blender
        return b && !b.hidden ? <Highlight key={id} brick={b} offset={explodeFn} active={i === all.length - 1} solid={xray ? colors.get(b.color) : undefined} /> : null;
      })}
      {ghostPart && ghost && !explodeFn && <Ghost part={ghostPart} placement={ghost} color={colors.get(color)} />}
      {ghost && followers && !explodeFn && followers.bricks.map((b) => <FollowerGhost key={b.id} brick={b} valid={ghost.valid} color={colors.get(b.color)} />)}
      {guided && !explodeFn && (guided.model.steps[guided.step] ?? []).filter((t) => !guided.placed.has(t.id)).map((t) => <TargetGhost key={t.id} target={t} color={colors.get(t.color)} />)}
      <StabilityOverlay parts={parts} />
      <Ruler />
      {stepView?.current.map((b) => <StepShell key={b.id} brick={b} color={colors.get(b.color)} />)}
      {bricks.filter((b) => b.part === HOSE_PART && !b.hidden && b.hose && !stepView?.later.has(b.id)).map((b) => (
        <mesh key={b.id} geometry={hoseGeometry(b.hose!)} material={brickMaterial(colors.get(b.color), xray ? 'xray' : 'normal')} position={b.pos} quaternion={b.quat} castShadow receiveShadow userData={{ brickId: b.id }} {...handlers} />
      ))}
      <HoseStartPreview />
      {bricks.filter((b) => b.chain && !b.hidden && !stepView?.later.has(b.id)).map((b) => (
        <ChainLoop key={b.id} chain={b} byId={byId} parts={parts} color={colors.get(b.color)} xray={xray} handlers={handlers} />
      ))}
      <PhysicsRunner parts={parts} />
      {/* ground: an endless baseplate */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow userData={{ ground: true }} {...handlers}>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={world.floor} roughness={0.92} />
      </mesh>
      <Grid position={[0, 0.002, 0]} args={[400, 400]} cellSize={1} cellThickness={0.6} cellColor={world.grid} sectionSize={8} sectionThickness={1.1} sectionColor={world.grid} fadeDistance={70} fadeStrength={1.6} infiniteGrid />
    </group>
  );
}

type Offset = ((p: [number, number, number]) => [number, number, number]) | null;
const PartInstances = memo(function PartInstances({ part, color, colors, bricks, handlers, offset, xray }: {
  part: Part; color?: BrickColor; colors: Map<number, BrickColor>; bricks: Brick[]; handlers: Record<string, (e: any) => void>; offset: Offset; xray: boolean;
}) {
  const geo = usePartGeometry(part.id);
  if (!geo) return null;
  return (
    <>
      {geo.main && <Instances geometry={geo.main} material={brickMaterial(color, xray ? 'xray' : 'normal')} bricks={bricks} handlers={handlers} offset={offset} shadows={!xray} />}
      {geo.fixed.map((f, i) => <Instances key={i} geometry={f.geometry} material={brickMaterial(colors.get(f.color), xray ? 'xray' : 'normal')} bricks={bricks} handlers={handlers} offset={offset} shadows={!xray} />)}
    </>
  );
});

function Instances({ geometry, material, bricks, handlers, offset, shadows = true }: { geometry: THREE.BufferGeometry; material: THREE.Material; bricks: Brick[]; handlers: Record<string, (e: any) => void>; offset: Offset; shadows?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const animating = useRef(false);
  useFrame(({ clock }) => {
    const L = live.physics ?? live.current;
    const mesh = ref.current;
    if (!mesh) return;
    if (!L) {
      if (animating.current) {
        // put everything back where the build says it is
        const m = new THREE.Matrix4();
        bricks.forEach((b, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...(offset ? offset(b.pos) : b.pos)), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1))));
        mesh.instanceMatrix.needsUpdate = true;
        animating.current = false;
      }
      return;
    }
    const m = new THREE.Matrix4();
    let any = false;
    bricks.forEach((b, i) => {
      const x = L.xform(b, clock.elapsedTime);
      if (!x) return;
      any = true;
      mesh.setMatrixAt(i, m.compose(x.pos, x.quat, new THREE.Vector3(1, 1, 1)));
    });
    if (any) { mesh.instanceMatrix.needsUpdate = true; animating.current = true; }
  });
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    bricks.forEach((b, i) => ref.current.setMatrixAt(i, m.compose(new THREE.Vector3(...(offset ? offset(b.pos) : b.pos)), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1))));
    ref.current.count = bricks.length;
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
    ref.current.userData.ids = bricks.map((b) => b.id);
  }, [bricks, offset]);
  return <instancedMesh ref={ref} key={bricks.length > 64 ? Math.ceil(bricks.length / 64) : 0} args={[geometry, material, Math.max(64, Math.ceil(bricks.length / 64) * 64)]} castShadow={shadows} receiveShadow {...handlers} />;
}

export function usePartGeometry(id: string | null) {
  const [geo, setGeo] = useState<PartGeometry | null>(null);
  useEffect(() => {
    let live = true;
    setGeo(null);
    if (id && !isVirtualPart(id)) loadPartGeometry(id).then((g) => live && setGeo(g)).catch((e) => console.warn('part failed', id, e));
    return () => { live = false; };
  }, [id]);
  return geo;
}

function Highlight({ brick, offset, solid, active }: { brick: Brick; offset: Offset; solid?: BrickColor; active: boolean }) {
  if (brick.chain) return null;
  if (brick.part === HOSE_PART && brick.hose) return <SelectionOutline geometry={hoseGeometry(brick.hose)} position={brick.pos} quaternion={brick.quat} active={active} />;
  return <PartHighlight brick={brick} offset={offset} solid={solid} active={active} />;
}
function PartHighlight({ brick, offset, solid, active }: { brick: Brick; offset: Offset; solid?: BrickColor; active: boolean }) {
  const geo = usePartGeometry(brick.part);
  if (!geo?.main) return null;
  const pos = offset ? offset(brick.pos) : brick.pos;
  return (
    <>
      {/* in X-ray the selection stays solid so it reads clearly through the shell */}
      {solid && <mesh geometry={geo.main} material={brickMaterial(solid)} position={pos} quaternion={brick.quat} raycast={() => null} />}
      <SelectionOutline geometry={geo.main} position={pos} quaternion={brick.quat} active={active} />
    </>
  );
}

function Ghost({ part, placement, color }: { part: Part; placement: Placement; color?: BrickColor }) {
  const geo = usePartGeometry(part.id);
  const ref = useRef<THREE.Group>(null!);
  // spring the ghost toward its snapped spot for a tactile feel
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 28);
    g.position.lerp(placement.pos, k);
    g.quaternion.slerp(placement.quat, k);
  });
  useLayoutEffect(() => { ref.current?.position.copy(placement.pos); ref.current?.quaternion.copy(placement.quat); }, [part.id]); // eslint-disable-line
  if (!geo?.main) return null;
  return (
    <group ref={ref}>
      <mesh geometry={geo.main} material={placement.valid ? brickMaterial(color, 'ghost') : invalidMaterial} raycast={() => null} castShadow={placement.valid} />
    </group>
  );
}

/** Ghost for a part carried along with the one under the cursor (multi-part move / copy). */
function FollowerGhost({ brick, valid, color }: { brick: Brick; valid: boolean; color?: BrickColor }) {
  const geo = usePartGeometry(brick.part === HOSE_PART ? null : brick.part);
  if (brick.hose) return <mesh geometry={hoseGeometry(brick.hose)} material={valid ? brickMaterial(color, 'ghost') : invalidMaterial} position={brick.pos} quaternion={brick.quat} raycast={() => null} />;
  if (!geo?.main) return null;
  return <mesh geometry={geo.main} material={valid ? brickMaterial(color, 'ghost') : invalidMaterial} position={brick.pos} quaternion={brick.quat} raycast={() => null} />;
}

/** Where this step's parts go: a softly breathing translucent copy, like the highlight in a paper manual. */
const targetMats = new Map<number, THREE.MeshPhysicalMaterial>();
function targetMaterial(c?: BrickColor) {
  const key = c?.code ?? -1;
  let m = targetMats.get(key);
  if (!m) {
    m = (brickMaterial(c) as THREE.MeshPhysicalMaterial).clone();
    Object.assign(m, { transparent: true, opacity: 0.35, depthWrite: false, transmission: 0 });
    m.emissive = new THREE.Color(c?.hex ?? '#ffffff');
    m.emissiveIntensity = 0.15;
    targetMats.set(key, m);
  }
  return m;
}
function TargetGhost({ target, color }: { target: Target; color?: BrickColor }) {
  const geo = usePartGeometry(target.part);
  const mat = targetMaterial(color);
  useFrame(({ clock }) => { mat.opacity = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3)); });
  if (!geo?.main) return null;
  return <mesh geometry={geo.main} material={mat} position={target.pos} quaternion={target.quat} raycast={() => null} renderOrder={2} />;
}

/** Stability heat-map: parts tinted by how hard the joint holding them works (amber → red), floating parts red. */
function StabilityOverlay({ parts }: { parts: Map<string, Part> }) {
  const on = useStudio((s) => s.stabilityView);
  const bricks = useStudio((s) => s.bricks);
  const result = useMemo(() => (on ? analyseStability(bricks, parts) : null), [on, bricks, parts]);
  useEffect(() => {
    if (!result) { useStudio.setState({ stab: null }); return; }
    const finite = [...result.stress.values()].filter(Number.isFinite);
    useStudio.setState({ stab: { weak: result.weak.length, floating: result.floating.length, worst: finite.length ? Math.max(...finite) : 0 } });
  }, [result]);
  if (!result) return null;
  return (
    <>
      {bricks.filter((b) => !b.hidden && (result.stress.get(b.id) ?? 0) > 0.35).map((b) => (
        <StressShell key={b.id} brick={b} stress={result.stress.get(b.id)!} />
      ))}
    </>
  );
}
const stressMats = new Map<number, THREE.MeshBasicMaterial>();
function stressMaterial(stress: number) {
  // 4 bands: working (amber), hard (orange), overloaded (red), floating (deep red)
  const band = !Number.isFinite(stress) ? 3 : stress > 1 ? 2 : stress > 0.65 ? 1 : 0;
  let m = stressMats.get(band);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: ['#F2B33D', '#EE7A26', '#E0392F', '#B5121B'][band], transparent: true, opacity: [0.35, 0.45, 0.6, 0.7][band], depthWrite: false });
    stressMats.set(band, m);
  }
  return m;
}
function StressShell({ brick, stress }: { brick: Brick; stress: number }) {
  const geo = usePartGeometry(brick.part);
  if (!geo?.main) return null;
  return <mesh geometry={geo.main} material={stressMaterial(stress)} position={brick.pos} quaternion={brick.quat} scale={1.01} renderOrder={4} raycast={() => null} />;
}

/** Runs a drop / shake test with Rapier and drives the instanced meshes from the simulated bodies. */
function PhysicsRunner({ parts }: { parts: Map<string, Part> }) {
  const sim = useStudio((s) => s.sim);
  const ref = useRef<Sim | null>(null);
  const reported = useRef(false);
  useEffect(() => {
    if (!sim) return;
    let live_ = true;
    reported.current = false;
    useStudio.setState({ simResult: null, playing: false });
    const bricks = useStudio.getState().bricks;
    createSim(bricks, parts, sim.test).then((s) => {
      if (!live_) { s.dispose(); return; }
      ref.current = s;
      live.physics = { xform: (b) => s.xform(b) };
    }).catch((e) => { console.warn('physics failed', e); useStudio.getState().notify('The physics engine could not start.'); });
    return () => {
      live_ = false;
      ref.current?.dispose();
      ref.current = null;
      live.physics = null;
    };
  }, [sim, parts]);
  useFrame((_, dt) => {
    const s = ref.current;
    if (!s) return;
    if (!s.done()) { s.step(dt); return; }
    if (!reported.current) {
      reported.current = true;
      const loose = s.loose();
      const total = useStudio.getState().bricks.filter((b) => !b.hidden).length;
      useStudio.setState({ simResult: { loose, total } });
      useStudio.getState().notify(loose === 0 ? 'Solid! Nothing came loose.' : `${loose} of ${total} parts came loose.`);
    }
  });
  return null;
}

function HoseStartPreview() {
  const h = useStudio((s) => (s.tool === 'hose' ? s.hoseStart : null));
  if (!h) return null;
  return (
    <>
      <mesh position={h.pos as [number, number, number]} renderOrder={31}><sphereGeometry args={[0.12, 16, 12]} /><meshBasicMaterial color="#111" depthTest={false} /></mesh>
      {h.hover && <HosePreview a={h.pos} b={h.hover} />}
    </>
  );
}

/** The step being edited: its parts breathe with a glow of their own colour, so the hue stays true. */
const stepMats = new Map<string, THREE.MeshBasicMaterial>();
function stepMaterial(hex = '#ffffff') {
  let m = stepMats.get(hex);
  if (!m) stepMats.set(hex, (m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));
  return m;
}
function StepShell({ brick, color }: { brick: Brick; color?: BrickColor }) {
  const geo = usePartGeometry(brick.part === HOSE_PART ? null : brick.part);
  // adding black glows nothing, so dark parts glow a soft grey instead
  const dark = new THREE.Color(color?.hex ?? '#fff').getHSL({ h: 0, s: 0, l: 0 }).l < 0.25;
  const mat = stepMaterial(dark ? '#5a5a5a' : color?.hex);
  useFrame(({ clock }) => { mat.opacity = 0.35 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 3)); });
  const g = brick.hose ? hoseGeometry(brick.hose) : geo?.main;
  if (!g) return null;
  return <mesh geometry={g} material={mat} position={brick.pos} quaternion={brick.quat} renderOrder={5} raycast={() => null} />;
}
