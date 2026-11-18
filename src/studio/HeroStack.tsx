import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import { usePartGeometry } from './Viewport';
import { brickMaterial } from './materials';
import type { BrickColor } from '../data/library';

// A small isometric stack of real LDraw bricks that glide down one after another, then rest.
// Positions are in studs; y in plates (3 plates = 1 brick). Brick origins sit at their top face.
const STACK: { part: string; color: number; x: number; y: number; z: number; turn?: boolean }[] = [
  { part: '3001', color: 4, x: 0, y: 3, z: 0 },                  // red 2x4
  { part: '3001', color: 1, x: 3, y: 3, z: 1, turn: true },      // blue 2x4
  { part: '3003', color: 14, x: -1, y: 6, z: 0 },                // yellow 2x2 on red
  { part: '3001', color: 15, x: 2, y: 6, z: 0, turn: true },     // white 2x4 bridging red + blue
  { part: '3039', color: 2, x: 2, y: 9, z: 0.5 },                // green slope on white (3039's origin is off-centre: z +0.5 lands it on studs)
  { part: '3004', color: 0, x: -1.5, y: 9, z: 0, turn: true },   // black 1x2 on yellow
  { part: '3062b', color: 14, x: -1.5, y: 12, z: -0.5 },         // yellow round 1x1 on black
];

const STEP = 0.28;   // seconds between bricks
const DUR = 0.9;     // seconds for one brick to glide into place
const LIFT = 1.6;    // how far above its resting spot a brick starts

// easeOutBack-lite: decelerates smoothly and settles with a barely visible overshoot
const ease = (k: number) => { const c = 1.15; const t = k - 1; return 1 + (c + 1) * t * t * t + c * t * t; };

export default function HeroStack({ colors }: { colors: Map<number, BrickColor> }) {
  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      // variance shadow maps give genuinely soft, blurred shadow edges (PCF edges look hard and stepped here)
      shadows="variance"
      camera={{ position: [10, 10, 10], zoom: 56, near: -100, far: 200 }}
      gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping }}
      onCreated={({ camera }) => camera.lookAt(0, 1.2, 0)}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[-8, 5, 6]} intensity={0.6} color="#E8EEFF" />
      <directionalLight position={[6, 12, 4]} intensity={1.3} castShadow shadow-mapSize={[1024, 1024]} shadow-radius={14} shadow-blurSamples={24} shadow-bias={-0.0006}>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.5, 40]} />
      </directionalLight>
      <Environment resolution={128} environmentIntensity={1}>
        <Lightformer form="rect" intensity={3} position={[5, 8, 5]} scale={[8, 6, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.6} position={[-6, 3, -4]} scale={[2, 8, 1]} target={[0, 0, 0]} />
      </Environment>
      <group position={[-1, 0, -0.5]}>
        {STACK.map((b, i) => <Gliding key={i} index={i} {...b} color={colors.get(b.color)} />)}
        {/* very soft ground shadow that grows and sharpens as bricks come down */}
        <ContactShadows position={[0, 0.001, 0]} scale={16} resolution={512} blur={3} far={5} opacity={0.55} color="#1B2130" />
      </group>
    </Canvas>
  );
}

function Gliding({ index, part, color, x, y, z, turn }: { index: number; part: string; color?: BrickColor; x: number; y: number; z: number; turn?: boolean }) {
  const geo = usePartGeometry(part);
  const ref = useRef<THREE.Group>(null!);
  const t0 = useRef<number | null>(null);
  const rest = y * 0.4;
  // own material copy so each brick can fade in independently
  const mat = useMemo(() => {
    const m = (brickMaterial(color) as THREE.MeshPhysicalMaterial).clone();
    m.transparent = true;
    m.opacity = 0;
    return m;
  }, [color]);
  useFrame(({ clock }) => {
    if (!geo || !ref.current) return;
    if (t0.current == null) t0.current = clock.elapsedTime + 0.3 + index * STEP;
    const k = Math.min(1, Math.max(0, (clock.elapsedTime - t0.current) / DUR));
    const g = ref.current;
    g.visible = k > 0;
    g.position.y = rest + LIFT * (1 - ease(k));
    mat.opacity = Math.min(1, k * 2.2);
    if (k >= 1 && mat.transparent) { mat.transparent = false; mat.opacity = 1; mat.needsUpdate = true; }
  });
  if (!geo?.main) return null;
  return (
    <group ref={ref} position={[x, rest + LIFT, z]} rotation-y={turn ? Math.PI / 2 : 0} visible={false}>
      <mesh geometry={geo.main} material={mat} castShadow receiveShadow />
    </group>
  );
}
