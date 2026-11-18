import { memo, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Wand2, X, PartyPopper, Camera } from 'lucide-react';
import type { BrickColor, Part } from '../data/library';
import { partThumb } from '../data/thumbs';
import { useStudio } from '../store/studio';
import { calloutOf, officialInstructionsUrl } from '../guided/guided';
import { autoStep, exitGuided, gotoStep } from '../guided/actions';
import { DESIGNS, type Design } from '../guided/generate';
import { startAlternate, startPhotoMosaic } from '../guided/alternate';
import { Shuffle, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Left column in guided mode: this step's parts (like a manual's callout box) and a preview of the next step. */
export function GuidedSteps({ parts, colors }: { parts: Map<string, Part>; colors: Map<number, BrickColor> }) {
  const g = useStudio((s) => s.guided)!;
  const held = useStudio((s) => s.heldPart);
  const color = useStudio((s) => s.color);
  const total = g.model.steps.length;
  const done = g.step >= total;
  const step = g.model.steps[g.step] ?? [];
  const callout = calloutOf(step, g.placed);
  const next = g.model.steps[g.step + 1] ? calloutOf(g.model.steps[g.step + 1]) : [];

  return (
    <aside className="glass flex min-h-0 w-[300px] flex-col overflow-hidden rounded-[22px]">
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12.5px] text-muted-foreground">{g.model.alt ? 'Alternate build' : 'Step-by-step'} · {g.model.set}</p>
            <h2 className="wide truncate text-[16px] leading-tight">{g.model.name}</h2>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={exitGuided} aria-label="Leave the guide"><X /></Button>
            </TooltipTrigger>
            <TooltipContent>Leave the guide (keeps what you built)</TooltipContent>
          </Tooltip>
        </div>
        {g.model.alt && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DESIGNS.map((d) => (
              <button key={d.id} onClick={() => startAlternate(g.model.set, g.model.alt!.setName, g.model.alt!.inventory, parts, colors, { design: d.id as Design })}
                className={cn('rounded-full px-2.5 py-1 text-[12px] transition-colors', g.model.alt!.design === d.id ? 'bg-brand-black font-semibold text-white' : 'bg-secondary hover:bg-accent')}>
                {d.label}
              </button>
            ))}
            <label className={cn('inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-[12px] transition-colors focus-within:ring-2 focus-within:ring-ring', g.model.alt!.design === 'photo' ? 'bg-brand-black font-semibold text-white' : 'bg-secondary hover:bg-accent')}>
              <ImagePlus className="h-3.5 w-3.5" /> Photo mosaic
              <input type="file" accept="image/*" className="sr-only" onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f && !(await startPhotoMosaic(g.model.set, g.model.alt!.setName, g.model.alt!.inventory, parts, colors, f))) useStudio.getState().notify("This set doesn't have enough plates in different colours for a photo mosaic.");
              }} />
            </label>
            <Button variant="ghost" size="sm" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => startAlternate(g.model.set, g.model.alt!.setName, g.model.alt!.inventory, parts, colors)}>
              <Shuffle /> Try another
            </Button>
          </div>
        )}
        {!done && (
          <p className="display mt-3 text-[40px] leading-none">
            {g.step + 1}<span className="text-[18px] font-bold text-muted-foreground"> / {total}</span>
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 scroll-thin">
        {done ? (
          <div className="rounded-2xl bg-secondary p-4 text-center">
            <PartyPopper className="mx-auto h-8 w-8" />
            <p className="wide mt-2 text-[17px]">Model complete</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Every step is done. Take a photo, or keep building on it freely.</p>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="black" onClick={() => useStudio.setState({ photo: true })}><Camera /> Photo mode</Button>
              <Button variant="outline" onClick={exitGuided}>Free build from here</Button>
            </div>
          </div>
        ) : (
          <>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">This step</h3>
            <div className="rounded-2xl border bg-background/70 p-2">
              <div className="grid grid-cols-3 gap-2">
                {callout.map((c) => (
                  <CalloutTile key={c.part + ':' + c.color} part={parts.get(c.part)} color={colors.get(c.color)} left={c.left} total={c.total}
                    on={held === c.part && color === c.color}
                    onPick={() => { if (!c.left) return; useStudio.getState().setColor(c.color); useStudio.getState().hold(c.part); }} />
                ))}
              </div>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">Pick a part, then click the glowing spot. It snaps into place for you.</p>

            {next.length > 0 && (
              <>
                <Separator className="my-4" />
                <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Next step</h3>
                <div className="grid grid-cols-5 gap-1.5 opacity-75">
                  {next.slice(0, 10).map((c) => <MiniTile key={c.part + ':' + c.color} part={parts.get(c.part)} color={colors.get(c.color)} total={c.total} />)}
                </div>
                {next.length > 10 && <p className="mt-1 text-[12px] text-muted-foreground">+{next.length - 10} more kinds of parts</p>}
              </>
            )}
          </>
        )}
        <Separator className="my-4" />
        <Button variant="link" size="sm" className="h-auto px-0 text-[12.5px] text-muted-foreground" asChild>
          <a href={officialInstructionsUrl(g.model.set)} target="_blank" rel="noreferrer">Official instructions on lego.com <ExternalLink className="!h-3 !w-3" /></a>
        </Button>
      </div>
    </aside>
  );
}

/** Bottom bar in guided mode: back / scrub / place for me / next. */
export function StepBar() {
  const g = useStudio((s) => s.guided)!;
  const total = g.model.steps.length;
  const done = g.step >= total;
  const [scrub, setScrub] = useState(g.step);
  useEffect(() => setScrub(Math.min(g.step, total - 1)), [g.step, total]);
  const placed = g.placed.size;
  const all = g.model.steps.reduce((a, s) => a + s.length, 0);
  return (
    <div className="glass drop-in flex w-[min(640px,calc(100vw-700px))] min-w-[420px] items-center gap-2 rounded-full p-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full" disabled={g.step === 0} onClick={() => gotoStep(Math.min(g.step, total) - 1)} aria-label="Previous step"><ChevronLeft /></Button>
        </TooltipTrigger>
        <TooltipContent>Previous step <span className="ml-1 opacity-60">[</span></TooltipContent>
      </Tooltip>
      <div className="flex-1 px-2">
        <Slider min={0} max={Math.max(0, total - 1)} step={1} value={[scrub]} aria-label="Jump to step"
          onValueChange={([v]) => setScrub(v)} onValueCommit={([v]) => gotoStep(v)} />
        <p className="tabular mt-1.5 text-center text-[11.5px] text-muted-foreground">{placed.toLocaleString()} of {all.toLocaleString()} parts placed</p>
      </div>
      {!done && <Button variant="secondary" className="rounded-full" onClick={autoStep}><Wand2 /> Place for me</Button>}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="black" size="icon" className="rounded-full" disabled={done} onClick={() => gotoStep(g.step + 1)} aria-label="Next step"><ChevronRight /></Button>
        </TooltipTrigger>
        <TooltipContent>Next step <span className="ml-1 opacity-60">]</span></TooltipContent>
      </Tooltip>
    </div>
  );
}

function useThumb(part?: Part, color?: BrickColor) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (part) partThumb(part.id, color).then((u) => live && setSrc(u)).catch(() => {});
    return () => { live = false; };
  }, [part?.id, color?.code]);
  return src;
}

const CalloutTile = memo(function CalloutTile({ part, color, left, total, on, onPick }: { part?: Part; color?: BrickColor; left: number; total: number; on: boolean; onPick: () => void }) {
  const src = useThumb(part, color);
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button onClick={onPick} data-on={on} disabled={!left} aria-label={`${part?.name ?? 'part'} (${left} left)`}
          className={cn('tile relative grid aspect-square place-items-center p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', !left && 'opacity-35')}>
          {src ? <img src={src} alt="" className="drop-in h-full w-full object-contain" /> : <span className="h-8 w-8 animate-pulse rounded-full bg-muted" />}
          <Badge variant={left ? 'default' : 'secondary'} className="absolute right-1 top-1">×{left || total}</Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[220px] whitespace-normal">{part?.name}{color ? <span className="ml-1 opacity-60">· {color.name}</span> : null}</TooltipContent>
    </Tooltip>
  );
});

const MiniTile = memo(function MiniTile({ part, color, total }: { part?: Part; color?: BrickColor; total: number }) {
  const src = useThumb(part, color);
  return (
    <div className="relative aspect-square rounded-lg border bg-background/70 p-0.5" title={`${part?.name ?? ''} ×${total}`}>
      {src && <img src={src} alt="" className="h-full w-full object-contain" />}
      <span className="tabular absolute -right-1 -top-1 rounded-full bg-background px-1 text-[10px] font-bold shadow-sm">{total}</span>
    </div>
  );
});
