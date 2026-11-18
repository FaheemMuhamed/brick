import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Combine, ListOrdered, Pause, Play, Plus, Sparkles, SquareArrowDown } from 'lucide-react';
import { useStudio } from '../store/studio';
import { authorSteps, autoSteps, hasSteps, mergeWithPrevious, moveToStep, newStepAfter, shiftStep, stepsOf } from '../instructions/steps';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import * as sfx from '../lib/sound';

/** Open the step editor: make the build's steps explicit and show the finished model. */
export function openStepEditor() {
  const s = useStudio.getState();
  if (!s.bricks.length) return;
  const authored = authorSteps(s.bricks);
  if (authored.some((b, i) => b !== s.bricks[i])) s.commit(authored);
  const n = stepsOf(useStudio.getState().bricks).length;
  useStudio.setState({ stepEdit: n - 1, heldPart: null, tool: 'select' });
  s.notify(hasSteps(s.bricks) ? 'Editing your steps' : `Split into ${n} steps, bottom up. Rearrange them however you like.`);
}

export function gotoEditStep(k: number) {
  const s = useStudio.getState();
  if (s.stepEdit == null) return;
  const n = stepsOf(s.bricks).length;
  const next = Math.max(0, Math.min(n - 1, k));
  if (next !== s.stepEdit) { useStudio.setState({ stepEdit: next }); sfx.tick(); }
}

/** Bottom bar: scrub through the steps of your own build and move parts between them. */
export default function StepEditor() {
  const step = useStudio((s) => s.stepEdit)!;
  const bricks = useStudio((s) => s.bricks);
  const selCount = useStudio((s) => s.selection.size);
  const steps = useMemo(() => stepsOf(bricks), [bricks]);
  const total = steps.length;
  const k = Math.min(step, total - 1);
  const [playing, setPlaying] = useState(false);

  // play through the build, one step at a time
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const s = useStudio.getState();
      if (s.stepEdit == null || s.stepEdit >= stepsOf(s.bricks).length - 1) { setPlaying(false); return; }
      gotoEditStep(s.stepEdit + 1);
    }, 900);
    return () => clearInterval(t);
  }, [playing]);

  const apply = (next: typeof bricks, to: number, msg?: string) => {
    const s = useStudio.getState();
    s.commit(next);
    useStudio.setState({ stepEdit: Math.max(0, Math.min(to, stepsOf(next).length - 1)) });
    if (msg) s.notify(msg);
    sfx.snap(2);
  };
  const sel = () => useStudio.getState().selection;

  const act = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false, tip?: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 rounded-full px-2.5 text-[12.5px]" disabled={disabled} onClick={onClick}>{icon} {label}</Button>
      </TooltipTrigger>
      {tip && <TooltipContent>{tip}</TooltipContent>}
    </Tooltip>
  );

  return (
    <div className="glass drop-in flex w-[min(760px,calc(100vw-680px))] min-w-[520px] flex-col gap-1 rounded-[22px] p-1.5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="rounded-full" disabled={k === 0} onClick={() => gotoEditStep(k - 1)} aria-label="Previous step"><ChevronLeft /></Button>
        <div className="w-[118px] shrink-0">
          <p className="tabular text-[14px] font-semibold leading-tight">Step {k + 1} <span className="font-normal text-muted-foreground">of {total}</span></p>
          <p className="tabular text-[11.5px] text-muted-foreground">{steps[k]?.length ?? 0} {steps[k]?.length === 1 ? 'part' : 'parts'} in this step</p>
        </div>
        <div className="flex-1 px-1">
          <Slider min={0} max={Math.max(0, total - 1)} step={1} value={[k]} aria-label="Jump to step" onValueChange={([v]) => gotoEditStep(v)} />
        </div>
        <Button variant="ghost" size="icon" className="rounded-full" disabled={k >= total - 1} onClick={() => gotoEditStep(k + 1)} aria-label="Next step"><ChevronRight /></Button>
        <Button variant="secondary" size="icon" className="rounded-full" aria-label={playing ? 'Pause' : 'Play through the steps'}
          onClick={() => { if (!playing && k >= total - 1) gotoEditStep(0); setPlaying(!playing); }}>{playing ? <Pause /> : <Play />}</Button>
        <Button variant="black" className="rounded-full" onClick={() => { setPlaying(false); useStudio.setState({ stepEdit: null }); }}>Done</Button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-0.5 border-t pt-1">
        {act('Move here', <SquareArrowDown />, () => apply(moveToStep(bricks, sel(), k), k), !selCount, 'Put the selected parts into this step')}
        {act('New step', <Plus />, () => apply(newStepAfter(bricks, sel(), k), k + 1, 'New step from the selection'), !selCount, 'Move the selected parts into a new step after this one')}
        {act('Merge', <Combine />, () => apply(mergeWithPrevious(bricks, k), k - 1), k === 0, 'Join this step with the one before it')}
        {act('Earlier', <ArrowLeft />, () => apply(shiftStep(bricks, k, -1), k - 1), k === 0, 'Swap with the step before')}
        {act('Later', <ArrowRight />, () => apply(shiftStep(bricks, k, 1), k + 1), k >= total - 1, 'Swap with the step after')}
        {act('Select step', <ListOrdered />, () => useStudio.getState().select((steps[k] ?? []).map((b) => b.id)), false, "Select this step's parts")}
        {act('Auto-arrange', <Sparkles />, () => apply(autoSteps(bricks), total, 'Steps rebuilt bottom up'), false, 'Throw away your steps and split the build bottom up again')}
      </div>
    </div>
  );
}
