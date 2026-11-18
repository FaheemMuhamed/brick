import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { useStudio } from '../store/studio';

// Ruler (M): click two points; shows the distance in studs, plates and millimetres.
// Points snap to half-studs across and to plate heights up, so edges and stud centres both land exactly.

export const STUD_MM = 8;
export const PLATE_MM = 3.2;

export function snapPoint(p: THREE.Vector3) {
  return new THREE.Vector3(Math.round(p.x * 2) / 2, Math.round(p.y / 0.4) * 0.4, Math.round(p.z * 2) / 2);
}

/** Human-readable measurement between two snapped points. */
export function measure(a: THREE.Vector3, b: THREE.Vector3) {
  const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z), dy = Math.abs(b.y - a.y);
  const across = Math.hypot(dx, dz);
  const plates = Math.round(dy / 0.4);
  const mm = Math.hypot(across * STUD_MM, plates * PLATE_MM);
  const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(1));
  const parts: string[] = [];
  if (across > 0.01) parts.push(dx > 0.01 && dz > 0.01 ? `${fmt(dx)} × ${fmt(dz)} studs` : `${fmt(across)} studs`);
  if (plates) parts.push(`${plates} ${plates === 1 ? 'plate' : 'plates'}${plates % 3 === 0 ? ` (${plates / 3} ${plates === 3 ? 'brick' : 'bricks'})` : ''}`);
  return { label: parts.join(' · ') || '0', mm: Math.round(mm * 10) / 10 };
}

export default function Ruler() {
  const tool = useStudio((s) => s.tool);
  const ruler = useStudio((s) => s.ruler);
  if (tool !== 'ruler' || !ruler.a) return null;
  const a = new THREE.Vector3(...ruler.a);
  const b = new THREE.Vector3(...(ruler.b ?? ruler.hover ?? ruler.a));
  const { label, mm } = measure(a, b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return (
    <group renderOrder={30}>
      <Line points={[a, b]} color="#111" lineWidth={2.5} depthTest={false} dashed={!ruler.b} dashSize={0.25} gapSize={0.15} />
      {[a, b].map((p, i) => (
        <mesh key={i} position={p} renderOrder={31}>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshBasicMaterial color="#111" depthTest={false} />
        </mesh>
      ))}
      <Html position={mid} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 10]}>
        <div className="whitespace-nowrap rounded-full bg-brand-black px-3 py-1 text-[12px] font-semibold text-white shadow-lg tabular">
          {label} <span className="font-normal opacity-60">· {mm} mm</span>
        </div>
      </Html>
    </group>
  );
}
