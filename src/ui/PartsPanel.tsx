import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { BrickColor, Part } from '../data/library';
import { partThumb } from '../data/thumbs';
import { useStudio, usage } from '../store/studio';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import * as sfx from '../lib/sound';

/**
 * Progressive disclosure: open on a curated Starter drawer, then category drawers, then the full library.
 * A drawer is either a hand-picked id list, a set of Rebrickable categories, or a name pattern.
 */
export interface Drawer { label: string; ids?: string[]; cats?: number[]; match?: RegExp; all?: boolean }
const STARTER = (
  '3005 3004 3622 3010 3009 3008 3003 3002 3001 2456 ' +          // bricks 1x1 → 2x6
  '3024 3023 3623 3710 3666 3460 3022 3021 3020 3795 3034 3958 3036 ' + // plates
  '3070b 3069b 63864 2431 3068b 98138 ' +                           // tiles
  '3040b 3039 3665 54200 3298 ' +                                    // slopes
  '3062b 6141 4032a ' +                                              // round
  '87087 11211 99781 ' +                                             // SNOT basics
  '3937 3938 3700 3701'                                              // hinge + Technic bricks
).split(' ');
export const GROUPS: Drawer[] = [
  { label: 'Starter', ids: STARTER },
  { label: 'Bricks', cats: [11, 5, 6] },
  { label: 'Plates', cats: [14, 9, 49] },
  { label: 'Slopes', cats: [3, 37] },
  { label: 'Tiles', cats: [19, 15, 67] },
  { label: 'SNOT', match: /Stud on Side|Studs on Side|Studs? on \d Sides?|Bracket|Headlight/i },
  { label: 'Round', cats: [20, 21] },
  { label: 'Technic', cats: [8, 12, 46, 51, 52, 53, 54, 55, 40] },
  { label: 'Hinges', cats: [18] },
  { label: 'Wheels', cats: [29] },
  { label: 'Windows & panels', cats: [16, 23] },
  { label: 'Bars & plants', cats: [32, 76] },
  { label: 'Baseplates', cats: [1] },
  { label: 'All parts', all: true },
];

function inDrawer(p: Part, d: Drawer) {
  if (d.all) return true;
  if (d.ids) return d.ids.includes(p.id);
  if (d.match) return d.match.test(p.name);
  return !!d.cats?.includes(p.cat);
}

/** Studio-style search: part number ("3004"), size ("2x4", "2x"), or words ("slope 45"). */
export function matchPart(p: Part, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if (/^\d+[a-z]?\d*$/.test(s) && p.id.toLowerCase().startsWith(s)) return true;
  const size = /^(\d+)\s*x\s*(\d+)?$/.exec(s);
  if (size) {
    const [a, b] = p.size.split('x').map(Number);
    const x = Number(size[1]), y = size[2] ? Number(size[2]) : null;
    return y == null ? a === x || b === x : (a === Math.min(x, y) && b === Math.max(x, y));
  }
  const name = p.name.toLowerCase();
  return s.split(/\s+/).every((w) => name.includes(w) || p.id.toLowerCase() === w);
}

export default function PartsPanel({ parts, colors }: { parts: Part[]; colors: Map<number, BrickColor> }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(0);
  const [limit, setLimit] = useState(120);
  useEffect(() => setLimit(120), [group, q]);
  const heldPart = useStudio((s) => s.heldPart);
  const color = useStudio((s) => s.color);
  const budget = useStudio((s) => s.budget);
  const bricks = useStudio((s) => s.bricks);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  const byId = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  // Set mode: the palette is exactly that set's inventory, with what's left to place.
  const budgetItems = useMemo(() => {
    if (!budget) return null;
    const used = usage(bricks);
    return Object.entries(budget.parts)
      .map(([k, qty]) => { const [part, c] = k.split(':'); return { part: byId.get(part), color: Number(c), left: qty - (used.get(k) || 0), qty }; })
      .filter((x) => x.part && matchPart(x.part, q)) as { part: Part; color: number; left: number; qty: number }[];
  }, [budget, bricks, byId, q]);

  const list = useMemo(() => {
    if (budgetItems) return [];
    const d = GROUPS[group];
    const found = parts.filter((p) => (q ? true : !p.hidden && inDrawer(p, d)) && matchPart(p, q));
    // the Starter drawer keeps its hand-picked order (small to large); everything else is by popularity
    if (d.ids && !q) found.sort((x, y) => d.ids!.indexOf(x.id) - d.ids!.indexOf(y.id));
    return found;
  }, [parts, group, q, budgetItems]);

  return (
    <aside className="glass flex min-h-0 w-[300px] flex-col overflow-hidden rounded-[22px]">
      <div className="p-3 pb-2">
        <div className="flex items-center justify-between px-1 pb-2">
          <h2 className="wide text-[16px] leading-tight">{budget ? budget.name : 'Parts'}</h2>
          {budget && <Button variant="link" size="sm" className="h-auto px-0 text-[12.5px]" onClick={() => useStudio.setState({ budget: null })}>Show all parts</Button>}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 3001, 2x4 or “slope”" className="pl-9 pr-12" aria-label="Search parts" />
          <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">⌘F</span>
        </div>
        {!budget && !q && (
          <ScrollArea className="-mx-1 mt-2.5 px-1 pb-2" type="hover">
            <ToggleGroup type="single" value={String(group)} onValueChange={(v) => { if (!v) return; const i = Number(v); if (i !== group) sfx.rustle(); setGroup(i); }}
              className="w-max gap-1.5 bg-transparent p-0">
              {GROUPS.map((g, i) => (
                <ToggleGroupItem key={g.label} value={String(i)}
                  className="h-7 flex-none rounded-full bg-secondary px-3 text-[12.5px] text-foreground/75 data-[state=on]:bg-brand-black data-[state=on]:text-white data-[state=on]:shadow-none">
                  {g.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 scroll-thin">
        {!budget && !q && GROUPS[group].all && <p className="px-1 pb-2 text-[12.5px] text-muted-foreground">The full library: {parts.length.toLocaleString()} parts, most used first.</p>}
        <div className="grid grid-cols-3 gap-2">
          {budgetItems
            ? budgetItems.map((x) => (
              <PartTile key={x.part.id + ':' + x.color} part={x.part} color={colors.get(x.color)} on={heldPart === x.part.id && color === x.color} badge={x.left} dim={x.left <= 0}
                onPick={() => { useStudio.getState().setColor(x.color); useStudio.getState().hold(x.part.id); }} />
            ))
            : list.slice(0, limit).map((p) => (
              <PartTile key={p.id} part={p} color={colors.get(color)} on={heldPart === p.id} onPick={() => useStudio.getState().hold(p.id)} />
            ))}
        </div>
        {!budgetItems && list.length > limit && (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => setLimit(limit + 240)}>
            Show more ({(list.length - limit).toLocaleString()} left)
          </Button>
        )}
        {!budgetItems && list.length === 0 && <p className="p-3 text-[13px] text-muted-foreground">No parts match “{q}”. Try a part number like 3001 or a size like 2x4.</p>}
        {budgetItems && budgetItems.length === 0 && <p className="p-3 text-[13px] text-muted-foreground">None of this set's parts match “{q}”.</p>}
      </div>
    </aside>
  );
}

const PartTile = memo(function PartTile({ part, color, on, onPick, badge, dim }: {
  part: Part; color?: BrickColor; on: boolean; onPick: () => void; badge?: number; dim?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { partThumb(part.id, color).then((u) => live && setSrc(u)).catch(() => {}); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [part.id, color?.code]);
  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <button ref={ref} className={cn('tile relative flex aspect-square flex-col items-center justify-center p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', dim && 'opacity-45')} data-on={on} onClick={onPick} aria-label={`${part.name} (${part.id})`}>
          {src ? <img src={src} alt="" className="drop-in h-full w-full object-contain" draggable={false} /> : <span className="h-8 w-8 animate-pulse rounded-full bg-muted" />}
          <span className="tabular absolute bottom-1 left-1.5 text-[10.5px] text-muted-foreground">{part.id}</span>
          {badge != null && <Badge variant={badge > 0 ? 'default' : 'secondary'} className="absolute right-1.5 top-1.5">{badge}</Badge>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[220px] whitespace-normal">{part.name}</TooltipContent>
    </Tooltip>
  );
});
