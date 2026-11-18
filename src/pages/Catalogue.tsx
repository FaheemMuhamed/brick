import { useEffect, useMemo, useState } from 'react';
import { loadCatalog, loadInventory, setImage, type BrickColor, type Inventory, type Part, type SetRow, type Theme } from '../data/library';
import { partThumb } from '../data/thumbs';
import { useStudio } from '../store/studio';
import { Wordmark } from '../ui/Brand';
import { ExternalLink, ListOrdered, Loader2, Plus, Search } from 'lucide-react';
import { loadGuidedIndex, loadGuidedModel, officialInstructionsUrl, type GuidedRow } from '../guided/guided';
import { startGuided } from '../guided/actions';
import { startAlternate } from '../guided/alternate';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export default function Catalogue({ parts, colors, openSet }: { parts: Map<string, Part>; colors: Map<number, BrickColor>; openSet: string | null }) {
  const [data, setData] = useState<{ themes: Map<number, Theme>; sets: SetRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [theme, setTheme] = useState<number | null>(null);
  const [buildable, setBuildable] = useState(true);
  const [guidedOnly, setGuidedOnly] = useState(false);
  const [guidedIdx, setGuidedIdx] = useState<Map<string, GuidedRow>>(new Map());
  useEffect(() => { loadGuidedIndex().then(setGuidedIdx); }, []);
  const [limit, setLimit] = useState(60);
  useEffect(() => { loadCatalog().then(setData).catch((e) => setError(String(e.message))); }, []);

  const root = (id: number): number => { const t = data?.themes.get(id); return t?.parent ? root(t.parent) : id; };
  const topThemes = useMemo(() => {
    if (!data) return [];
    const counts = new Map<number, number>();
    for (const s of data.sets) if (s[4] >= 20) counts.set(root(s[3]), (counts.get(root(s[3])) || 0) + 1);
    return [...counts.entries()].filter(([, n]) => n >= 15).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: data.themes.get(id)!.name, n }));
  }, [data]); // eslint-disable-line

  const list = useMemo(() => {
    if (!data) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.sets.filter((s) => {
      if (s[4] < 20) return false; // skip polybag-sized promos and keychains
      if (guidedOnly && !guidedIdx.has(s[0])) return false;
      if (!guidedOnly && buildable && s[5] < 90) return false;
      if (theme != null && root(s[3]) !== theme) return false;
      const hay = `${s[0]} ${s[1]} ${s[2]}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [data, q, theme, buildable, guidedOnly, guidedIdx]); // eslint-disable-line

  useEffect(() => setLimit(60), [q, theme, buildable, guidedOnly]);
  const current = openSet && data ? data.sets.find((s) => s[0] === openSet) : null;

  return (
    <div className="h-full flex flex-col bg-steel">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b bg-background/70 px-6 py-3 backdrop-blur">
        <a href="#/"><Wordmark /></a>
        <div className="relative max-w-[520px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sets by name, number or year" className="pl-9" aria-label="Search sets" />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="buildable" checked={buildable} onCheckedChange={(v) => setBuildable(v === true)} />
          <Label htmlFor="buildable" className="text-[13px]">Buildable here</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="guided-only" checked={guidedOnly} onCheckedChange={(v) => setGuidedOnly(v === true)} />
          <Label htmlFor="guided-only" className="text-[13px]">Step-by-step guide{guidedIdx.size ? ` (${guidedIdx.size.toLocaleString()})` : ''}</Label>
        </div>
        <Button variant="black" className="ml-auto" asChild><a href="#/studio">Open studio</a></Button>
      </header>

      <div className="flex-1 flex min-h-0">
        <nav className="w-[240px] shrink-0 overflow-y-auto scroll-thin p-4 border-r border-line/70 hidden md:block">
          <ThemeButton on={theme == null} onClick={() => setTheme(null)} label="All themes" />
          {topThemes.map((t) => (
            <ThemeButton key={t.id} on={theme === t.id} onClick={() => setTheme(t.id)} label={t.name} count={t.n} />
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto scroll-thin p-6">
          {error && <p className="text-signal">Could not load the catalogue: {error}. Run <code>npm run data</code> to build it.</p>}
          {!data && !error && <p className="text-muted-foreground">Loading the catalogue…</p>}
          {data && (
            <>
              <p className="text-[13px] text-muted-foreground mb-4 tabular">{list.length.toLocaleString()} sets</p>
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
                {list.slice(0, limit).map((s) => <SetCard key={s[0]} s={s} theme={data.themes.get(s[3])?.name} guided={guidedIdx.has(s[0])} />)}
              </div>
              {list.length > limit && <div className="mt-8 flex justify-center"><Button variant="secondary" onClick={() => setLimit(limit + 120)}>Show more sets</Button></div>}
              {list.length === 0 && <p className="text-muted-foreground">No sets match. Try fewer words, or turn off “Buildable here”.</p>}
            </>
          )}
        </main>
      </div>
      {current && data && <SetDetail s={current} theme={data.themes.get(current[3])?.name} parts={parts} colors={colors} guide={guidedIdx.get(current[0])} />}
    </div>
  );
}

function SetCard({ s, theme, guided }: { s: SetRow; theme?: string; guided?: boolean }) {
  return (
    <a href={`#/sets/${encodeURIComponent(s[0])}`} className="tile !rounded-[18px] overflow-hidden flex flex-col">
      <div className="aspect-[4/3] bg-white grid place-items-center p-3">
        <img loading="lazy" src={setImage(s[0])} alt="" className="max-w-full max-h-full object-contain" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
      </div>
      <div className="border-t p-3 pt-2.5">
        <p className="font-semibold text-[14px] leading-snug line-clamp-2">{s[1]}</p>
        <p className="text-[12.5px] text-muted-foreground mt-1 tabular">{s[0].replace(/-1$/, '')} · {s[2]} · {s[4].toLocaleString()} pcs</p>
        {theme && <p className="text-[12px] text-muted-foreground truncate">{theme}</p>}
        {guided && <Badge variant="secondary" className="mt-1.5 gap-1 text-foreground/80"><ListOrdered className="h-3 w-3" /> Step-by-step</Badge>}
      </div>
    </a>
  );
}

function SetDetail({ s, theme, parts, colors, guide }: { s: SetRow; theme?: string; parts: Map<string, Part>; colors: Map<number, BrickColor>; guide?: GuidedRow }) {
  const [opening, setOpening] = useState(false);
  const openGuide = async () => {
    setOpening(true);
    try {
      startGuided(await loadGuidedModel(s[0], parts));
      location.hash = '#/studio';
    } catch (e) {
      setOpening(false);
      alert((e as Error).message);
    }
  };
  const [inv, setInv] = useState<Inventory | null>(null);
  useEffect(() => { setInv(null); loadInventory(s[0]).then(setInv).catch(() => setInv({ parts: [], minifigs: [] })); }, [s]);
  const rows = useMemo(() => (inv?.parts ?? []).slice().sort((a, b) => b[2] - a[2]), [inv]);
  const have = rows.filter((r) => parts.has(r[0]));
  const close = () => (location.hash = '#/sets');
  const build = () => {
    const budget: Record<string, number> = {};
    for (const [p, c, q] of have) budget[`${p}:${c}`] = (budget[`${p}:${c}`] || 0) + q;
    useStudio.getState().newBuild(s[1], { set: s[0], name: s[1], parts: budget });
    location.hash = '#/studio';
  };
  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="bg-[hsl(var(--page))] p-0">
        <div className="flex gap-5 border-b bg-background p-6 pb-4">
          <img src={setImage(s[0])} alt="" className="w-[180px] h-[140px] object-contain" />
          <div className="flex-1 min-w-0">
            <SheetDescription className="text-[13px] text-muted-foreground">{theme} · {s[2]}</SheetDescription>
            <SheetTitle className="display mt-1 pr-8 text-[24px] leading-tight">{s[1]}</SheetTitle>
            <p className="tabular mt-2 text-[13.5px] text-foreground/80">Set {s[0]} · {s[4].toLocaleString()} pieces{inv?.minifigs.length ? ` · ${inv.minifigs.reduce((a, m) => a + m[1], 0)} minifigures` : ''}</p>
            <div className="flex gap-2 mt-4">
              {guide && <Button variant="black" onClick={openGuide} disabled={opening}>{opening ? <Loader2 className="animate-spin" /> : <ListOrdered />} Build step by step</Button>}
              <Button variant={guide ? 'outline' : 'black'} onClick={build} disabled={!inv}><Plus /> {guide ? 'Free build with its parts' : 'Build with these parts'}</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" disabled={!inv} onClick={() => {
                if (!inv) return;
                if (startAlternate(s[0], s[1], inv.parts, parts, colors)) location.hash = '#/studio';
                else alert('This set has no plain bricks or plates to design an alternate build with.');
              }}><Sparkles /> Generate an alternate build</Button>
            </div>
            {guide && <p className="mt-2 text-[12.5px] text-muted-foreground">{guide[2]} steps · {guide[3].toLocaleString()} parts, from the LDraw official model.</p>}
            {inv && <p className="text-[12.5px] text-muted-foreground mt-1">{have.length} of {rows.length} part types are in the library.</p>}
            <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-[12.5px] text-muted-foreground" asChild>
              <a href={officialInstructionsUrl(s[0])} target="_blank" rel="noreferrer">Official instructions on lego.com <ExternalLink className="!h-3 !w-3" /></a>
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin p-5">
          <h3 className="wide font-semibold text-[15px] mb-3">Parts list</h3>
          {!inv && <p className="text-muted-foreground text-[13px]">Loading parts…</p>}
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {rows.map(([p, c, q], i) => <InvTile key={i} part={parts.get(p)} id={p} color={colors.get(c)} qty={q} />)}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InvTile({ part, id, color, qty }: { part?: Part; id: string; color?: BrickColor; qty: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { if (part) partThumb(part.id, color).then(setSrc).catch(() => {}); }, [part, color]);
  return (
    <div className="tile relative aspect-square p-1.5 grid place-items-center" title={`${part?.name ?? id} · ${color?.name ?? ''}`}>
      {src ? <img src={src} alt="" className="w-full h-full object-contain" /> : <span className="text-[11px] text-muted-foreground text-center leading-tight">{part ? '' : 'Not in library yet'}</span>}
      <Badge variant="secondary" className="absolute right-1 top-1 bg-background/90 text-foreground">×{qty}</Badge>
      <span className="absolute left-1.5 bottom-1 w-3 h-3 rounded-full" style={{ background: color?.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }} />
    </div>
  );
}

function ThemeButton({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button onClick={onClick} aria-pressed={on}
      className={cn('mb-0.5 flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on && 'bg-brand-black font-semibold text-white hover:bg-brand-black')}>
      <span className="truncate">{label}</span>
      {count != null && <span className={cn('tabular text-[12px]', on ? 'text-white/60' : 'text-muted-foreground')}>{count}</span>}
    </button>
  );
}
