import { useEffect, useState } from 'react';
import { Mark, Wordmark } from '../ui/Brand';
import { Boxes, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStudio } from '../store/studio';
import { loadCatalog, type BrickColor } from '../data/library';
import HeroStack from '../studio/HeroStack';

export default function Home({ partCount, colorCount, colors }: { partCount: number; colorCount: number; colors: Map<number, BrickColor> }) {
  const name = useStudio((s) => s.name);
  const bricks = useStudio((s) => s.bricks.length);
  const [sets, setSets] = useState<number | null>(null);
  useEffect(() => { loadCatalog().then((c) => setSets(c.sets.length)).catch(() => {}); }, []);
  return (
    <div className="min-h-full flex flex-col" style={{ background: 'radial-gradient(1200px 600px at 75% 20%, #FFFFFF 0%, #EEF1F5 55%, #E3E8EF 100%)' }}>
      <header className="flex items-center justify-between px-6 md:px-10 py-6">
        <Wordmark />
        <nav className="flex gap-1">
          <Button variant="ghost" asChild><a href="#/sets">Official sets</a></Button>
          <Button variant="black" asChild><a href="#/studio">Open studio</a></Button>
        </nav>
      </header>

      <main className="flex-1 grid lg:grid-cols-[1.15fr_1fr] gap-10 items-center px-6 md:px-10 pb-12 max-w-[1320px] w-full mx-auto">
        <section>
          <h1 className="display text-[44px] md:text-[72px] leading-[0.95] text-foreground">Every brick.<br />Every set.<br />Your studio.</h1>
          <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed text-foreground/75">
            Build freely with {partCount.toLocaleString()} real parts in {colorCount} production colours, or pick any of {sets ? sets.toLocaleString() : 'nearly 20,000'} official sets and build it from its own parts list.
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Button size="lg" variant="brand" asChild><a href="#/studio" onClick={() => { if (bricks === 0) useStudio.getState().camera('persp'); }}><Plus /> Start a free build</a></Button>
            <Button size="lg" variant="outline" asChild><a href="#/sets"><Boxes /> Browse official sets</a></Button>
          </div>
          {bricks > 0 && (
            <a href="#/studio" className="mt-8 inline-flex items-center gap-3 rounded-2xl border bg-background/70 px-4 py-3 transition-colors hover:bg-background">
              <Mark size={26} />
              <span>
                <span className="block text-[12.5px] text-muted-foreground">Pick up where you left off</span>
                <span className="block font-semibold text-[14.5px]">{name} · {bricks.toLocaleString()} parts</span>
              </span>
            </a>
          )}
        </section>
        <section aria-hidden className="relative h-[380px] md:h-[560px]">
          <HeroStack colors={colors} />
        </section>
      </main>

      <footer className="px-6 md:px-10 py-5 text-[12px] text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 border-t border-line/70">
        <span>Part geometry from the LDraw™ Parts Library (CC BY 4.0).</span>
        <span>Set and inventory data from Rebrickable.</span>
        <span>Brick Atelier is an independent project, not affiliated with or endorsed by the LEGO Group. LEGO® is a trademark of the LEGO Group.</span>
      </footer>
    </div>
  );
}
