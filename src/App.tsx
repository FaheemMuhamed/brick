import { useEffect, useState } from 'react';
import { loadColors, loadLibrary, type BrickColor, type Part } from './data/library';
import { restoreBuild } from './store/studio';
import Studio from './pages/Studio';
import Home from './pages/Home';
import Catalogue from './pages/Catalogue';
import { Mark } from './ui/Brand';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';

function useHash() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => setH(location.hash || '#/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

export default function App() {
  return (
    <TooltipProvider delayDuration={250}>
      <Routes />
      <Toaster position="bottom-center" toastOptions={{ className: 'font-sans', style: { borderRadius: 999 } }} />
    </TooltipProvider>
  );
}

function Routes() {
  const hash = useHash();
  const [lib, setLib] = useState<{ parts: Part[]; byId: Map<string, Part>; colors: Map<number, BrickColor>; colorList: BrickColor[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([loadLibrary(), loadColors(), restoreBuild()])
      .then(([l, c]) => setLib({ parts: l.parts, byId: l.byId, colors: c.byCode, colorList: c.list }))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <Center><p className="text-[15px]">The parts library could not be loaded ({error}).</p><p className="text-muted-foreground text-[14px] mt-1">Run <code>npm run data</code> to build it, then reload.</p></Center>;
  if (!lib) return <Center><Mark size={44} /><p className="text-muted-foreground text-[14px] mt-3">Sorting the bricks…</p></Center>;

  if (hash.startsWith('#/studio')) return <Studio parts={lib.parts} colors={lib.colors} colorList={lib.colorList} />;
  if (hash.startsWith('#/sets')) {
    const id = decodeURIComponent(hash.split('/')[2] ?? '') || null;
    return <Catalogue parts={lib.byId} colors={lib.colors} openSet={id} />;
  }
  return <Home colors={lib.colors} partCount={lib.parts.length} colorCount={lib.colorList.filter((c) => c.parts > 0).length} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full grid place-items-center text-center"><div className="flex flex-col items-center">{children}</div></div>;
}
