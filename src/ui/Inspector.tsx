import { useEffect, useMemo, useState } from 'react';
import { hoseLength } from '../studio/Hose';
import { Download, Eye, Maximize, Palette, Pause, Play, Cog, TriangleAlert, X, ArrowDownToLine, Waves, RotateCcw, ListOrdered } from 'lucide-react';
import { loadAppears, type BrickColor, type Part } from '../data/library';
import { useStudio, type CameraPreset, type Quality, type StagePreset, toLDraw } from '../store/studio';
import { STAGES, WORLD_SWATCHES } from '../studio/stages';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import HingePanel from './HingePanel';
import ArrangePanel from './ArrangePanel';
import PartsListDialog from './PartsListDialog';
import InstructionsButton from './InstructionsButton';
import { openStepEditor } from './StepEditor';

const VIEWS: { id: CameraPreset; label: string; key: string }[] = [
  { id: 'persp', label: '3/4', key: '`' }, { id: 'front', label: 'Front', key: '0' }, { id: 'back', label: 'Back', key: '1' },
  { id: 'left', label: 'Left', key: '2' }, { id: 'right', label: 'Right', key: '3' }, { id: 'top', label: 'Top', key: '4' },
];

const Heading = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h3 className={cn('mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground', className)}>{children}</h3>
);

export default function Inspector({ parts, colors }: { parts: Map<string, Part>; colors: Map<number, BrickColor> }) {
  const selection = useStudio((s) => s.selection);
  const bricks = useStudio((s) => s.bricks);
  const held = useStudio((s) => s.heldPart);
  const hasHidden = useStudio((s) => s.bricks.some((b) => b.hidden));
  const guided = useStudio((s) => !!s.guided);
  const stepEdit = useStudio((s) => s.stepEdit != null);
  const sel = useMemo(() => bricks.filter((b) => selection.has(b.id)), [bricks, selection]);
  const focusId = held ?? (sel.length === 1 ? sel[0].part : null);
  const focus = focusId ? parts.get(focusId) : null;
  const [appears, setAppears] = useState<Record<string, [number, string[]]> | null>(null);
  useEffect(() => { loadAppears().then(setAppears).catch(() => {}); }, []);
  const ap = focus && appears?.[focus.id];

  return (
    <aside className="glass flex min-h-0 w-[280px] flex-col gap-5 overflow-y-auto rounded-[22px] p-4 scroll-thin">
      <section>
        {focus ? (
          <>
            <p className="text-[12.5px] text-muted-foreground">{held ? 'In hand' : 'Selected'} · {focus.id}</p>
            <h2 className="wide mt-0.5 text-[17px] leading-snug">{focus.name}</h2>
            {ap && <p className="mt-1.5 text-[13px] text-foreground/80">Found in <b className="tabular">{ap[0].toLocaleString()}</b> official sets</p>}
            {sel.length === 1 && !held && (
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: colors.get(sel[0].color)?.hex }} />
                {colors.get(sel[0].color)?.name}
              </p>
            )}
            {held && <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">Click to place · <span className="kbd">R</span> rotate · <span className="kbd">T</span> <span className="kbd">Y</span> tilt · <span className="kbd">Esc</span> put back</p>}
          </>
        ) : sel.length === 1 && sel[0].hose ? (
          <>
            <p className="text-[12.5px] text-muted-foreground">Selected · cut to length</p>
            <h2 className="wide mt-0.5 text-[17px] leading-snug">Flexible hose</h2>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className="h-3 w-3 rounded-full ring-1 ring-black/10" style={{ background: colors.get(sel[0].color)?.hex }} />
              {colors.get(sel[0].color)?.name} · <span className="tabular">{hoseLength(sel[0].hose).toFixed(1)}</span> studs long
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">Paint it any colour. Delete it and draw it again with <span className="kbd">O</span> to re-route.</p>
          </>
        ) : sel.length > 1 ? (
          <>
            <h2 className="wide text-[17px]">{sel.length} parts selected</h2>
            {sel.every((b) => b.group && b.group === sel[0].group) && <p className="mt-1 text-[13px] text-foreground/80">One group · <span className="kbd">⇧⌘G</span> to ungroup</p>}
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">Drag to move together, <span className="kbd">⌥</span>-drag to copy, <span className="kbd">⌘G</span> to group. Arrows nudge by a stud, <span className="kbd">R</span> rotates.</p>
          </>
        ) : (
          <>
            <h2 className="wide text-[17px]">Nothing selected</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">Pick a part on the left, then click a stud to place it. Drag a placed part to move it, or <span className="kbd">⇧</span>-drag to box-select.</p>
          </>
        )}
      </section>

      <Separator />

      <section>
        <Heading>View</Heading>
        <div className="grid grid-cols-3 gap-1.5">
          {VIEWS.map((v) => (
            <Tooltip key={v.id}>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="sm" onClick={() => useStudio.getState().camera(v.id)}>{v.label}</Button>
              </TooltipTrigger>
              <TooltipContent>Shortcut {v.key}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-1.5 w-full" onClick={() => useStudio.getState().camera('fit')}>
          <Maximize /> Zoom to fit <span className="kbd ml-1">⌘0</span>
        </Button>
      </section>

      <MotorPanel parts={parts} />

      {sel.length > 0 && !held && <ArrangePanel parts={parts} />}

      {sel.length > 0 && !held && <HingePanel parts={parts} />}

      <SeeInside />

      <PhysicsPanel />

      <Separator />

      <RenderSettings />

      <section className="mt-auto flex flex-col gap-2">
        <PartsListDialog parts={parts} colors={colors} />
        {!guided && <Button variant="outline" onClick={openStepEditor} disabled={!bricks.length || stepEdit}><ListOrdered /> Edit steps</Button>}
        <InstructionsButton parts={parts} colors={colors} />
        <Button variant="outline" onClick={() => exportLdr()}><Download /> Export LDraw (.ldr)</Button>
        {hasHidden && <Button variant="outline" onClick={showAll}><Eye /> Show hidden parts</Button>}
      </section>
    </aside>
  );
}

function Row({ id, label, hint, checked, onChange }: { id: string; label: React.ReactNode; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const row = (
    <div className="flex items-center justify-between">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
  if (!hint) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="left" className="max-w-[220px] whitespace-normal font-medium">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Drive a part like a motor and play the mechanism. */
function MotorPanel({ parts }: { parts: Map<string, Part> }) {
  const motor = useStudio((s) => s.motor);
  const playing = useStudio((s) => s.playing);
  const mech = useStudio((s) => s.mech);
  const selection = useStudio((s) => s.selection);
  const bricks = useStudio((s) => s.bricks);
  const sel = selection.size === 1 ? bricks.find((b) => selection.has(b.id)) : undefined;
  const selPart = sel ? parts.get(sel.part) : undefined;
  const technic = !!selPart?.connectors.some((c) => c.kind === 'axle' || c.kind === 'axlehole' || c.kind === 'pinhole' || c.kind === 'pin');
  if (!motor && !(sel && technic)) return null;
  const motorPart = motor ? parts.get(bricks.find((b) => b.id === motor.brick)?.part ?? '') : undefined;
  return (
    <section className="flex flex-col gap-3">
      <Heading className="-mb-0.5">Mechanism</Heading>
      {!motor && sel && (
        <Button variant="outline" onClick={() => useStudio.setState({ motor: { brick: sel.id, rpm: 30 }, playing: true })}><Cog /> Drive this part</Button>
      )}
      {motor && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[13px]"><span className="text-muted-foreground">Motor on</span> {motorPart?.name ?? 'part'}</p>
            <Button variant="ghost" size="icon-sm" aria-label="Remove motor" onClick={() => useStudio.setState({ motor: null, playing: false })}><X /></Button>
          </div>
          <div>
            <div className="mb-2 flex justify-between text-[13.5px]"><Label>Speed</Label><span className="tabular text-muted-foreground">{Math.abs(motor.rpm)} rpm{motor.rpm < 0 ? ' · reverse' : ''}</span></div>
            <Slider min={-120} max={120} step={5} value={[motor.rpm]} aria-label="Motor speed" onValueChange={([v]) => useStudio.setState({ motor: { ...motor, rpm: v || 5 } })} />
          </div>
          <Button variant={playing ? 'secondary' : 'black'} onClick={() => useStudio.setState({ playing: !playing })}>
            {playing ? <><Pause /> Pause</> : <><Play /> Play</>} <span className="kbd ml-1">Space</span>
          </Button>
          {mech?.jammed ? (
            <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-destructive"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> These gears lock against each other, so nothing can turn. Remove one gear from the loop.</p>
          ) : mech && !mech.canTurn ? (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">This part has nothing to turn around. Put it on an axle that runs through a round hole.</p>
          ) : mech ? (
            <p className="text-[12.5px] text-muted-foreground">Turning {mech.moving} {mech.moving === 1 ? 'part' : 'parts'}{mech.meshes ? ` · ${mech.meshes} gear ${mech.meshes === 1 ? 'mesh' : 'meshes'}` : ''}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Stability heat-map and drop / shake tests. */
function PhysicsPanel() {
  const view = useStudio((s) => s.stabilityView);
  const stab = useStudio((s) => s.stab);
  const sim = useStudio((s) => s.sim);
  const result = useStudio((s) => s.simResult);
  const count = useStudio((s) => s.bricks.length);
  if (!count) return null;
  const run = (test: 'drop' | 'shake') => useStudio.setState((s) => ({ sim: { test, run: (s.sim?.run ?? 0) + 1 }, heldPart: null, selection: new Set() }));
  return (
    <section className="flex flex-col gap-3">
      <Heading className="-mb-0.5">Physics</Heading>
      <Row id="stability" label="Stability" checked={view} onChange={(v) => useStudio.setState({ stabilityView: v })}
        hint="Tints parts by how hard the joint holding them works: amber is working hard, red would come apart." />
      {view && stab && (
        stab.weak || stab.floating ? (
          <p className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-foreground/80">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{[stab.weak && `${stab.weak} weak ${stab.weak === 1 ? 'joint' : 'joints'}`, stab.floating && `${stab.floating} floating ${stab.floating === 1 ? 'part' : 'parts'}`].filter(Boolean).join(' · ')}. Add more studs under the red parts or support them from below.</span>
          </p>
        ) : <p className="text-[12.5px] text-muted-foreground">Everything is well supported.</p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => run('drop')}><ArrowDownToLine /> Drop test</Button>
        <Button variant="secondary" size="sm" onClick={() => run('shake')}><Waves /> Shake test</Button>
      </div>
      {sim && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] text-muted-foreground">{result ? (result.loose ? `${result.loose} of ${result.total} parts came loose` : 'Nothing came loose') : 'Testing…'}</p>
          <Button variant="outline" size="sm" onClick={() => useStudio.setState({ sim: null, simResult: null })}><RotateCcw /> Reset</Button>
        </div>
      )}
    </section>
  );
}

function SeeInside() {
  const xray = useStudio((s) => s.xray);
  const explode = useStudio((s) => s.explode);
  return (
    <section className="flex flex-col gap-3">
      <Heading className="-mb-0.5">See inside</Heading>
      <Row id="xray" label={<>X-ray <span className="kbd ml-1">X</span></>} checked={xray} onChange={(v) => useStudio.setState({ xray: v })} />
      <div>
        <div className="mb-2 flex justify-between text-[13.5px]"><Label>Explode <span className="kbd ml-1">E</span></Label><span className="tabular text-muted-foreground">{Math.round(explode * 100)}%</span></div>
        <Slider min={0} max={1} step={0.01} value={[explode]} aria-label="Explode view" onValueChange={([v]) => useStudio.setState({ explode: v, heldPart: null })} />
      </div>
      {explode > 0 && <Button variant="link" size="sm" className="-mt-1 h-auto self-start px-0 text-[12.5px]" onClick={() => animateExplode(0)}>Put it back together</Button>}
    </section>
  );
}

/** Ease the explode slider to a target value (used by the shortcut and the reset link). */
export function animateExplode(to: number) {
  const from = useStudio.getState().explode;
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 600);
    const e = 1 - Math.pow(1 - k, 3);
    useStudio.setState({ explode: from + (to - from) * e });
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function RenderSettings() {
  const stage = useStudio((s) => s.stage);
  const quality = useStudio((s) => s.quality);
  const dof = useStudio((s) => s.dof);
  const idleTrace = useStudio((s) => s.idleTrace);
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Heading>Studio light</Heading>
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(STAGES) as StagePreset[]).map((k) => (
            <Tooltip key={k}>
              <TooltipTrigger asChild>
                <button aria-label={STAGES[k].label} onClick={() => useStudio.setState({ stage: k })}
                  className={cn('h-9 rounded-lg ring-1 ring-black/10 transition-transform hover:scale-105', stage === k && 'ring-2 ring-brand-black ring-offset-2')}
                  style={{ background: `linear-gradient(160deg, ${STAGES[k].key}, ${STAGES[k].bg})` }} />
              </TooltipTrigger>
              <TooltipContent>{STAGES[k].label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      <WorldColor />
      <div>
        <Heading>Quality</Heading>
        <ToggleGroup type="single" value={quality} onValueChange={(v) => v && useStudio.setState({ quality: v as Quality })}>
          {(['low', 'medium', 'high', 'ultra'] as Quality[]).map((q) => <ToggleGroupItem key={q} value={q} className="capitalize">{q}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <Row id="idle-trace" label="Ray trace when still" checked={idleTrace} onChange={(v) => useStudio.setState({ idleTrace: v })}
        hint="When you pause for a moment the view switches to path tracing and keeps refining. Touch anything to go back." />
      <Row id="dof" label="Depth of field" checked={dof} onChange={(v) => useStudio.setState({ dof: v })}
        hint="Softens the floor and backdrop behind your build. The build itself always stays sharp." />
    </section>
  );
}

function WorldColor() {
  const world = useStudio((s) => s.world);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Heading className="mb-0">World colour</Heading>
        {world && <Button variant="link" size="sm" className="h-auto px-0 text-[12px]" onClick={() => useStudio.setState({ world: null })}>Reset</Button>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {WORLD_SWATCHES.map((c) => (
          <button key={c} aria-label={`World colour ${c}`} onClick={() => useStudio.setState({ world: c })}
            className={cn('h-7 w-7 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110', world?.toLowerCase() === c.toLowerCase() && 'ring-2 ring-brand-black ring-offset-2')}
            style={{ background: c }} />
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <label className="relative grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-secondary text-muted-foreground ring-1 ring-black/10 hover:text-foreground">
              <Palette className="h-3.5 w-3.5" />
              <input type="color" value={world ?? '#dce1e8'} onChange={(e) => useStudio.setState({ world: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom world colour" />
            </label>
          </TooltipTrigger>
          <TooltipContent>Any colour</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function showAll() {
  const s = useStudio.getState();
  s.commit(s.bricks.map((b) => (b.hidden ? { ...b, hidden: false } : b)));
}

export function exportLdr() {
  const s = useStudio.getState();
  const blob = new Blob([toLDraw(s.name, s.bricks)], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${s.name.replace(/[^\w-]+/g, '_') || 'build'}.ldr`;
  a.click();
  URL.revokeObjectURL(a.href);
}
