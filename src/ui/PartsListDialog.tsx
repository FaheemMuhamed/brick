import { memo, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Download } from 'lucide-react';
import type { BrickColor, Part } from '../data/library';
import { partThumb } from '../data/thumbs';
import { useStudio } from '../store/studio';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Every part, colour and quantity in the build, with a Rebrickable CSV export (importable as a BrickLink wanted list via Rebrickable). */
export default function PartsListDialog({ parts, colors }: { parts: Map<string, Part>; colors: Map<number, BrickColor> }) {
  const [open, setOpen] = useState(false);
  const bricks = useStudio((s) => s.bricks);
  const name = useStudio((s) => s.name);
  const rows = useMemo(() => {
    const m = new Map<string, { part: string; color: number; qty: number }>();
    for (const b of bricks) {
      const k = `${b.part}:${b.color}`;
      const r = m.get(k) ?? { part: b.part, color: b.color, qty: 0 };
      r.qty++;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty || a.part.localeCompare(b.part));
  }, [bricks]);

  const download = () => {
    // Rebrickable "Part,Color,Quantity" CSV: Rebrickable colour ids match ours
    const csv = ['Part,Color,Quantity', ...rows.map((r) => `${r.part},${r.color},${r.qty}`)].join('\n') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${name.replace(/[^\w-]+/g, '_') || 'build'}-parts.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={!bricks.length}><ClipboardList /> Parts list</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-[560px] flex-col">
          <DialogHeader>
            <DialogTitle>Parts list</DialogTitle>
            <DialogDescription>
              {bricks.length.toLocaleString()} parts · {rows.length} different part and colour combinations.
              The CSV imports into Rebrickable, which can turn it into a BrickLink wanted list.
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 scroll-thin">
            <ul className="divide-y">
              {rows.map((r) => <Row key={r.part + ':' + r.color} part={parts.get(r.part)} id={r.part} color={colors.get(r.color)} qty={r.qty} />)}
            </ul>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="black" onClick={download}><Download /> Download CSV</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const Row = memo(function Row({ part, id, color, qty }: { part?: Part; id: string; color?: BrickColor; qty: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let live = true; if (part) partThumb(part.id, color).then((u) => live && setSrc(u)).catch(() => {}); return () => { live = false; }; }, [part?.id, color?.code]);
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border bg-background">{src && <img src={src} alt="" className="h-10 w-10 object-contain" />}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{part?.name ?? (id === 'hose' ? 'Flexible hose (cut to length)' : id === 'chain' ? 'Chain / track loop (links counted separately)' : id)}</p>
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ background: color?.hex }} />
          {color?.name ?? 'Unknown colour'} · {id}
        </p>
      </div>
      <span className="tabular text-[15px] font-bold">×{qty}</span>
    </li>
  );
});
