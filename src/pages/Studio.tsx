import { Fragment, useEffect, useMemo, useState } from 'react';
import Viewport from '../studio/Viewport';
import PartsPanel from '../ui/PartsPanel';
import ColorPanel from '../ui/ColorPanel';
import ToolDock, { deleteSelection, nudgeSelection, rotateSelection } from '../ui/ToolDock';
import Inspector, { animateExplode } from '../ui/Inspector';
import { Wordmark } from '../ui/Brand';
import { Boxes, Camera, Keyboard, Volume2, VolumeX } from 'lucide-react';
import { toast as sonner } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStudio, type CameraPreset } from '../store/studio';
import type { BrickColor, Part } from '../data/library';
import { PLATE } from '../lib/units';
import BoxSelect from '../ui/BoxSelect';
import { GuidedSteps, StepBar } from '../ui/GuidedPanel';
import { gotoStep } from '../guided/actions';
import { finishChain } from '../mechanics/chainTool';
import StepEditor, { gotoEditStep } from '../ui/StepEditor';
import { groupSelection, ungroupSelection } from '../ui/ToolDock';
import { isMuted, setMuted } from '../lib/sound';

const CAM_KEYS: Record<string, CameraPreset> = { '`': 'persp', '0': 'front', '1': 'back', '2': 'left', '3': 'right', '4': 'top', '5': 'bottom' };

export default function Studio({ parts, colors, colorList }: { parts: Part[]; colors: Map<number, BrickColor>; colorList: BrickColor[] }) {
  const partMap = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const name = useStudio((s) => s.name);
  const count = useStudio((s) => s.bricks.length);
  const toast = useStudio((s) => s.toast);
  // studio notices go through the shared Sonner toaster
  useEffect(() => { if (toast) sonner(toast); }, [toast]);
  const photo = useStudio((s) => s.photo);
  const guided = useStudio((s) => !!s.guided);
  const stepEdit = useStudio((s) => s.stepEdit != null && !s.guided);
  const [help, setHelp] = useState(false);
  const [muted, setMutedState] = useState(isMuted());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [role=dialog]')) return;
      const s = useStudio.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
      if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return; }
      if (mod && k === 'a') { e.preventDefault(); s.select(s.bricks.filter((b) => !b.hidden).map((b) => b.id)); return; }
      if (mod && k === '0') { e.preventDefault(); s.camera('fit'); return; }
      if (mod && k === 'l') { e.preventDefault(); s.commit(s.bricks.map((b) => (e.shiftKey ? { ...b, hidden: false } : s.selection.has(b.id) ? { ...b, hidden: true } : b))); return; }
      if (mod) return;
      if (CAM_KEYS[e.key]) { s.camera(CAM_KEYS[e.key]); return; }
      switch (k) {
        case 'escape': if (s.tool === 'ruler' || s.tool === 'hose' || s.tool === 'chain') s.setTool('select'); else s.heldPart ? s.hold(null) : s.select([]); break;
        case 'v': s.setTool('select'); break;
        case 'c': s.setTool('clone'); break;
        case 'p': s.setTool('paint'); break;
        case 'i': s.setTool('eyedropper'); break;
        case 'l': s.setTool('hide'); break;
        case 'm': s.setTool('ruler'); break;
        case 'o': s.setTool('hose'); break;
        case 'k': s.setTool('chain'); break;
        case 'enter': if (s.tool === 'chain') finishChain(partMap); break;
        case 'r': s.heldPart ? s.rotateHeld(e.shiftKey ? -1 : 1) : rotateSelection(e.shiftKey ? -1 : 1); break;
        case 't': if (s.heldPart) s.tiltHeld('x', e.shiftKey ? -1 : 1); else s.notify('Pick a part up (or drag one) to tilt it with T / Y'); break;
        case 'y': if (s.heldPart) s.tiltHeld('z', e.shiftKey ? -1 : 1); else s.notify('Pick a part up (or drag one) to tilt it with T / Y'); break;
        case 'delete': case 'backspace': deleteSelection(); break;
        case 'arrowup': case 'w': e.preventDefault(); e.shiftKey ? nudgeSelection(0, PLATE, 0) : nudgeSelection(0, 0, -1); break;
        case 'arrowdown': case 's': e.preventDefault(); e.shiftKey ? nudgeSelection(0, -PLATE, 0) : nudgeSelection(0, 0, 1); break;
        case 'arrowleft': case 'a': e.preventDefault(); nudgeSelection(-1, 0, 0); break;
        case 'arrowright': case 'd': e.preventDefault(); nudgeSelection(1, 0, 0); break;
        case 'x': s.set({ xray: !s.xray }); break;
        case 'e': if (!s.heldPart) animateExplode(s.explode > 0.01 ? 0 : 0.8); break;
        case '[': if (s.guided) gotoStep(s.guided.step - 1); else if (s.stepEdit != null) gotoEditStep(s.stepEdit - 1); break;
        case ']': if (s.guided) gotoStep(s.guided.step + 1); else if (s.stepEdit != null) gotoEditStep(s.stepEdit + 1); break;
        case 'h': if (s.selection.size) document.getElementById('hinge-angle')?.querySelector<HTMLElement>('[role=slider]')?.focus(); break;
        case ' ': if (s.motor) { e.preventDefault(); s.set({ playing: !s.playing }); } break;
        case '?': setHelp((h) => !h); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`fixed inset-0 ${guided || stepEdit ? "guided" : ""}`}>
      <div className="absolute inset-0"><Viewport parts={partMap} colors={colors} /></div>

      {/* top bar */}
      <header className={`absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none transition-opacity ${photo ? 'opacity-0' : ''}`}>
        <div className="glass pointer-events-auto flex items-center gap-2 rounded-2xl py-1.5 pl-3 pr-1.5">
          <a href="#/" aria-label="Home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Wordmark /></a>
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Input value={name} onChange={(e) => useStudio.setState({ name: e.target.value })} aria-label="Build name"
            className="h-8 w-[190px] border-transparent bg-transparent px-2 font-medium shadow-none hover:bg-secondary focus-visible:bg-background" />
          <Button variant="ghost" size="sm" asChild><a href="#/sets"><Boxes /> Sets</a></Button>
        </div>
        <div className="pointer-events-auto"><ToolDock /></div>
        <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => { setMuted(!muted); setMutedState(!muted); }} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>
                {muted ? <VolumeX /> : <Volume2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{muted ? 'Sound off' : 'Sound on'}</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" onClick={() => setHelp(!help)}><Keyboard /> Shortcuts</Button>
          <Button variant="black" size="sm" onClick={() => useStudio.setState({ photo: true, dof: true })}><Camera /> Photo</Button>
        </div>
      </header>

      {!photo && (
        <>
          <div className="absolute left-3 top-[84px] bottom-3 flex flex-col gap-3 min-h-0">
            {guided ? <GuidedSteps parts={partMap} colors={colors} /> : (
              <>
                <PartsPanel parts={parts} colors={colors} />
                <ColorPanel colors={colorList} parts={partMap} />
              </>
            )}
          </div>
          <div className="absolute right-3 top-[84px] bottom-14 flex min-h-0"><Inspector parts={partMap} colors={colors} /></div>
          <footer className="glass tabular absolute bottom-3 right-3 rounded-xl px-3 py-1.5 text-[12.5px] text-muted-foreground">{count.toLocaleString()} {count === 1 ? 'part' : 'parts'}</footer>
          {count === 0 && !guided && !stepEdit && <EmptyHint />}
          {guided && <div className="absolute bottom-4 left-1/2 -translate-x-1/2"><StepBar /></div>}
          {stepEdit && <div className="absolute bottom-4 left-1/2 -translate-x-1/2"><StepEditor /></div>}
        </>
      )}

      {photo && <PhotoBar />}
      {!photo && <TracingPill />}
      <Shortcuts open={help} onOpenChange={setHelp} />
      {!photo && <BoxSelect parts={partMap} />}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="absolute left-1/2 top-[42%] -translate-x-1/2 text-center pointer-events-none drop-in">
      <p className="display text-[30px] text-foreground/85">Start with a brick.</p>
      <p className="mt-2 text-[14.5px] text-muted-foreground">Choose a part on the left, then click anywhere on the baseplate.</p>
    </div>
  );
}

function TracingPill() {
  const tracing = useStudio((s) => s.tracing);
  const samples = useStudio((s) => s.ptSamples);
  if (!tracing) return null;
  return (
    <div className="glass tabular drop-in pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 [.guided_&]:bottom-[118px] py-1.5 text-[12.5px] text-muted-foreground">
      <span className="h-2 w-2 animate-pulse rounded-full bg-foreground/60" /> Ray tracing · {samples} samples · move to keep building
    </div>
  );
}

function PhotoBar() {
  const raytrace = useStudio((s) => s.raytrace);
  const samples = useStudio((s) => s.ptSamples);
  const shoot = () => {
    const c = document.querySelector('canvas');
    if (!c) return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${useStudio.getState().name || 'build'}.png`;
    a.click();
  };
  return (
    <div className="glass drop-in absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full p-1.5 pl-4">
      <div className="flex items-center gap-2">
        <Switch id="raytrace" checked={raytrace} onCheckedChange={(v) => useStudio.setState({ raytrace: v })} />
        <Label htmlFor="raytrace">Ray traced</Label>
      </div>
      <span className="tabular min-w-[160px] px-2 text-[13px] text-muted-foreground">{raytrace ? (samples < 2 ? 'Preparing the scene…' : `Refining · ${samples} samples`) : 'The camera turns slowly'}</span>
      <Button onClick={shoot}><Camera /> Save image</Button>
      <Button variant="ghost" onClick={() => useStudio.setState({ photo: false })}>Done</Button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Select / move', 'V'], ['Clone', 'C'], ['Paint', 'P'], ['Pick colour', 'I'], ['Hide', 'L'], ['Ruler (click two points)', 'M'], ['Previous / next step (guide or step editor)', '[ / ]'], ['Flexible hose (click both ends)', 'O'], ['Chain / track (click gears or sprockets, Enter to close)', 'K'], ['Rotate 90°', 'R'], ['Tilt forward / sideways (part in hand)', 'T / Y'],
  ['Delete', '⌫'], ['X-ray', 'X'], ['Hinge: focus the angle slider (then ← →)', 'H'], ['Play / pause mechanism', 'Space'], ['Explode / reassemble', 'E'], ['Put part back / deselect', 'Esc'], ['Move a stud', '← ↑ → ↓'], ['Move a plate up / down', '⇧ ↑ / ⇧ ↓'],
  ['Undo / redo', '⌘Z / ⇧⌘Z'], ['Select all', '⌘A'], ['Box select (add / remove)', '⇧ drag / ⇧⌥ drag'], ['Group / ungroup', '⌘G / ⇧⌘G'], ['Edit one part of a submodel (all copies follow)', '⌥ click'], ['Pick one part inside a group', '⌥ click'], ['Move selection / drop a copy', 'Drag / ⌥ drag'], ['Hide selection / show all', '⌘L / ⇧⌘L'], ['Search parts', '⌘F'],
  ['Zoom to fit', '⌘0'], ['Step-by-step: previous / next step', '[ / ]'], ['Views: 3/4, front, back, left, right, top', '` 0 1 2 3 4'], ['Orbit (or left-drag with empty hands)', 'Right-drag'], ['Pan', '⇧ right-drag · middle-drag'], ['Zoom', 'Scroll · pinch'],
];
function Shortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Shortcuts</DialogTitle>
          <DialogDescription>Press ? any time to open this.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[13.5px]">
          {SHORTCUTS.map(([a, b]) => <Fragment key={a}><dt>{a}</dt><dd className="text-right"><span className="kbd !text-[12px]">{b}</span></dd></Fragment>)}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
