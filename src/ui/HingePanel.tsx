import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';
import { useStudio } from '../store/studio';
import { buildGraph, turned } from '../mechanics/mechanics';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * Hinge tool (H): swing the selection around the joint that connects it to the rest of the build
 * (a pin, or an axle in a round hole). With no such joint, rotate it about X, Y or Z through its centre.
 */
export default function HingePanel({ parts }: { parts: Map<string, Part> }) {
  const selection = useStudio((s) => s.selection);
  const bricks = useStudio((s) => s.bricks);
  const [axisChoice, setAxisChoice] = useState<'x' | 'y' | 'z'>('y');
  const [angle, setAngle] = useState(0);
  const base = useRef<Brick[] | null>(null);

  const pivot = useMemo(() => {
    if (!selection.size || base.current) return null;
    const g = buildGraph(bricks, parts);
    const j = g.joints.find((j) => j.kind === 'revolute' && selection.has(j.a) !== selection.has(j.b));
    if (j) return { axis: j.axis.clone(), point: j.point.clone(), joint: true };
    const box = new THREE.Box3();
    const m = new THREE.Matrix4();
    for (const b of bricks) if (selection.has(b.id)) {
      const p = parts.get(b.part);
      if (!p) continue;
      m.compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
      box.union(p.box.clone().applyMatrix4(m));
    }
    const axis = new THREE.Vector3(axisChoice === 'x' ? 1 : 0, axisChoice === 'y' ? 1 : 0, axisChoice === 'z' ? 1 : 0);
    return { axis, point: box.getCenter(new THREE.Vector3()), joint: false };
  }, [selection, bricks, parts, axisChoice]);

  if (!selection.size || !pivot) return null;

  const preview = (deg: number) => {
    const s = useStudio.getState();
    base.current ??= s.bricks;
    const rad = (deg * Math.PI) / 180;
    useStudio.setState({
      bricks: base.current.map((b) => {
        if (!s.selection.has(b.id)) return b;
        const t = turned(b, pivot.axis, pivot.point, rad);
        return { ...b, pos: t.pos.toArray().map((v) => +v.toFixed(4)) as Brick['pos'], quat: t.quat.toArray() as Brick['quat'] };
      }),
    });
    setAngle(deg);
  };
  const commit = () => {
    const s = useStudio.getState();
    const from = base.current;
    base.current = null;
    if (!from || angle === 0) { setAngle(0); return; }
    // one undo step from the original pose
    const to = s.bricks;
    useStudio.setState({ bricks: from });
    s.commit(to);
    setAngle(0);
  };

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="-mb-0.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Hinge <span className="kbd ml-1 normal-case tracking-normal">H</span></h3>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {pivot.joint ? 'Swings the selection around its pin or axle.' : 'No joint found: rotate the selection about an axis through its centre.'}
      </p>
      {!pivot.joint && (
        <ToggleGroup type="single" value={axisChoice} onValueChange={(v) => v && setAxisChoice(v as 'x' | 'y' | 'z')}>
          {(['x', 'y', 'z'] as const).map((a) => <ToggleGroupItem key={a} value={a} className="uppercase">{a}</ToggleGroupItem>)}
        </ToggleGroup>
      )}
      <div>
        <div className="mb-2 flex justify-between text-[13.5px]"><Label>Angle</Label><span className="tabular text-muted-foreground">{angle}°</span></div>
        <Slider id="hinge-angle" min={-180} max={180} step={5} value={[angle]} aria-label="Hinge angle" onValueChange={([v]) => preview(v)} onValueCommit={commit} />
      </div>
    </section>
  );
}
