import { useMemo, useState } from 'react';
import type { BrickColor, Part } from '../data/library';
import { useStudio } from '../store/studio';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const FINISH_LABEL: Record<string, string> = { solid: 'Solid', trans: 'Transparent', chrome: 'Chrome', metal: 'Metallic', pearl: 'Pearl', rubber: 'Rubber', glitter: 'Glitter', speckle: 'Speckle', glow: 'Glow' };

/** Colour palette: by default only shows colours the selected/held part was actually produced in. */
export default function ColorPanel({ colors, parts }: { colors: BrickColor[]; parts: Map<string, Part> }) {
  const color = useStudio((s) => s.color);
  const held = useStudio((s) => s.heldPart);
  const selection = useStudio((s) => s.selection);
  const bricks = useStudio((s) => s.bricks);
  const only = useStudio((s) => s.onlyKnownColors);
  const [open, setOpen] = useState(false);

  const focusParts = useMemo(() => {
    if (held) return [held];
    return bricks.filter((b) => selection.has(b.id)).map((b) => b.part);
  }, [held, selection, bricks]);

  const shown = useMemo(() => {
    let list = colors.filter((c) => c.parts > 0 && c.code < 10000);
    if (only && focusParts.length) {
      // colours shared by every focused part
      const sets = focusParts.map((id) => new Set(parts.get(id)?.colors ?? []));
      const shared = list.filter((c) => sets.every((s) => s.size === 0 || s.has(c.code)));
      if (shared.length) list = shared;
    }
    list.sort((a, b) => b.parts - a.parts);
    return open ? list : list.slice(0, 27);
  }, [colors, only, focusParts, parts, open]);

  const current = colors.find((c) => c.code === color);
  const apply = (code: number) => {
    const s = useStudio.getState();
    s.setColor(code);
    if (s.selection.size && !s.heldPart) s.commit(s.bricks.map((b) => (s.selection.has(b.id) ? { ...b, color: code } : b)));
  };

  return (
    <section className="glass w-[300px] rounded-[22px] p-3">
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="min-w-0">
          <h2 className="wide text-[16px] leading-tight">Colour</h2>
          <p className="truncate text-[12.5px] text-muted-foreground">{current ? `${current.name} · ${FINISH_LABEL[current.finish]}` : 'Pick a colour'}</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              <Checkbox id="made-in" checked={only} onCheckedChange={(v) => useStudio.setState({ onlyKnownColors: v === true })} />
              <Label htmlFor="made-in" className="text-[12px] text-muted-foreground">Made in</Label>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">Only colours this part was really produced in</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid grid-cols-9 gap-1.5">
        {shown.map((c) => (
          <Tooltip key={c.code} delayDuration={300}>
            <TooltipTrigger asChild>
              <button onClick={() => apply(c.code)} aria-label={c.name}
                className={cn('aspect-square rounded-full shadow-[inset_0_-2px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.35)] transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  c.code === color && 'ring-2 ring-brand-black ring-offset-2')}
                style={{ background: swatch(c) }} />
            </TooltipTrigger>
            <TooltipContent>{c.name}{c.y1 ? <span className="ml-1 opacity-60">{c.y1}–{c.y2}</span> : null}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Button variant="link" size="sm" className="mt-1 h-auto px-1 text-[12.5px]" onClick={() => setOpen(!open)}>{open ? 'Fewer colours' : 'All colours'}</Button>
    </section>
  );
}

export function swatch(c: BrickColor) {
  if (c.finish === 'trans') return `linear-gradient(135deg, ${c.hex}cc, ${c.hex}55)`;
  if (c.finish === 'chrome' || c.finish === 'metal') return `linear-gradient(135deg, #fff 0%, ${c.hex} 45%, #000a 100%)`;
  if (c.finish === 'pearl') return `linear-gradient(135deg, #ffffffaa, ${c.hex} 50%)`;
  return c.hex;
}
