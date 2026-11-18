import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { BrickColor, Part } from '../data/library';
import type { Brick } from '../building/snap';
import { LINK, chainPath, chainWheels, linkPoses, type ChainPath } from '../mechanics/chain';
import { live } from '../mechanics/live';
import { brickMaterial } from './materials';
import { usePartGeometry } from './Viewport';

/** One chain or track: real link parts laid round the wheels, running while the mechanism plays. */
export default function ChainLoop({ chain, byId, parts, color, xray, handlers }: {
  chain: Brick; byId: Map<string, Brick>; parts: Map<string, Part>; color?: BrickColor; xray: boolean; handlers: object;
}) {
  const link = LINK[chain.chain?.kind ?? 'chain'];
  const geo = usePartGeometry(link.part);
  const path = useMemo<ChainPath | null>(() => {
    const ws = chainWheels(chain, byId, parts);
    if (!ws) return null;
    const p = chainPath(ws);
    return 'error' in p ? null : p;
  }, [chain, byId, parts]);
  const count = path ? Math.max(3, Math.round(path.length / link.pitch)) : 0;
  const ref = useRef<THREE.InstancedMesh>(null);
  const last = useRef<{ path: ChainPath | null; offset: number }>({ path: null, offset: NaN });

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || !path) return;
    // links slide along the loop at the surface speed of the first wheel
    let offset = 0;
    const L = live.current;
    if (L) {
      const w = path.wheels[0];
      const body = L.graph.bodyOf.get(w.id);
      const spin = body ? L.motion.spin.get(body) : undefined;
      if (spin) offset = spin.omega * Math.sign(spin.axis.dot(path.normal)) * w.r * (clock.elapsedTime - L.started);
    }
    if (last.current.path === path && last.current.offset === offset) return;
    last.current = { path, offset };
    linkPoses(path, link.pitch, offset).forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });

  if (!geo?.main || !path) return null;
  return (
    <instancedMesh ref={ref} key={`${count}-${geo.main.uuid}`} args={[geo.main, brickMaterial(color, xray ? 'xray' : 'normal'), count]}
      castShadow receiveShadow userData={{ brickId: chain.id }} {...(handlers as object)}
      onUpdate={() => { last.current.offset = NaN; }} />
  );
}
