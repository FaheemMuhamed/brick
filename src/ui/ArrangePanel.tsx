import { useState } from 'react';
import { FlipHorizontal2, Copy, Combine, Grid2x2, Boxes, Link2, Unlink2, PackageOpen } from 'lucide-react';
import { linkedCopy, makeSubmodel, releaseSubmodel, unlinkCopy } from '../building/submodels';
import type { Part } from '../data/library';
import { useStudio, newId } from '../store/studio';
import { boundsOf, mirrorBricks, type MirrorAxis } from '../building/mirror';
import { mergeBricks, splitBrick } from '../building/merge';
import { freshCopies } from '../building/groups';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import * as sfx from '../lib/sound';

/** Mirror copy / flip / split / merge for the current selection. */
export default function ArrangePanel({ parts }: { parts: Map<string, Part> }) {
  const [axis, setAxis] = useState<MirrorAxis>('x');
  const count = useStudio((s) => s.selection.size);
  // a primitive key keeps the selector stable between renders: "def|inst|copies" or ""
  const subKey = useStudio((s) => {
    const sel = s.bricks.filter((b) => s.selection.has(b.id));
    const link = sel[0]?.link;
    if (!link || !sel.every((b) => b.link?.inst === link.inst)) return "";
    const copies = new Set(s.bricks.filter((b) => b.link?.def === link.def).map((b) => b.link!.inst)).size;
    return `${link.def}|${link.inst}|${copies}`;
  });
  const sub = subKey ? (() => { const [def, inst, copies] = subKey.split("|"); return { def, inst, copies: Number(copies) }; })() : null;
  if (!count) return null;
  const selected = () => { const s = useStudio.getState(); return s.bricks.filter((b) => s.selection.has(b.id)); };

  const mirror = (copy: boolean) => {
    const s = useStudio.getState();
    const sel = selected();
    const box = boundsOf(sel, parts);
    // copy: mirror across the selection's far edge so the copy sits right beside it; flip: across its centre
    const plane = copy ? (axis === 'x' ? box.max.x : box.max.z) : (axis === 'x' ? (box.min.x + box.max.x) / 2 : (box.min.z + box.max.z) / 2);
    const snapped = Math.round(plane * 2) / 2;
    let out = mirrorBricks(sel, parts, axis, snapped);
    if (copy) {
      // a mirrored copy has swapped / flipped parts, so it can't stay linked to the submodel
      out = freshCopies(out.map((b) => ({ ...b, link: undefined })), newId);
      s.commit([...s.bricks, ...out]);
    } else {
      const byId = new Map(out.map((b) => [b.id, b]));
      s.commit(s.bricks.map((b) => byId.get(b.id) ?? b));
    }
    s.select(out.map((b) => b.id));
    sfx.snap(out.length);
    const swapped = out.filter((b, i) => b.part !== sel[i].part).length;
    s.notify(copy ? `Mirrored copy of ${out.length} ${out.length === 1 ? 'part' : 'parts'}${swapped ? ` · ${swapped} swapped for left/right versions` : ''}` : 'Flipped');
  };

  const split = () => {
    const s = useStudio.getState();
    const made: string[] = [];
    let changed = false;
    const next = s.bricks.flatMap((b) => {
      if (!s.selection.has(b.id)) return [b];
      const pieces = splitBrick(b, parts, newId);
      if (!pieces) return [b];
      changed = true;
      made.push(...pieces.map((p) => p.id));
      return pieces;
    });
    if (!changed) return s.notify('Only plain bricks and plates bigger than 1×1 can be split.');
    s.commit(next);
    s.select(made);
    sfx.clack();
    s.notify(`Split into ${made.length} 1×1s`);
  };

  const merge = () => {
    const s = useStudio.getState();
    const r = mergeBricks(selected(), parts, newId);
    if ('error' in r) return s.notify(r.error);
    s.commit([...s.bricks.filter((b) => !s.selection.has(b.id)), r.brick]);
    s.select([r.brick.id]);
    sfx.snap(4);
    s.notify(`Merged into ${parts.get(r.brick.part)?.name ?? 'one part'}`);
  };

  const makeSub = () => {
    const s = useStudio.getState();
    const next = makeSubmodel(s.bricks, s.selection);
    s.commit(next);
    s.notify('Made a submodel. Copies you make of it stay linked.');
  };
  const copySub = () => {
    const s = useStudio.getState();
    const box = boundsOf(selected(), parts);
    const copy = linkedCopy(s.bricks, sub!.inst, [Math.ceil(box.max.x - box.min.x) + 1, 0, 0], newId);
    s.commit([...s.bricks, ...copy]);
    s.select(copy.map((b) => b.id));
    sfx.snap(copy.length);
    s.notify('Linked copy: edit a part in any copy and they all follow');
  };

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="-mb-0.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Arrange</h3>
      {sub ? (
        <div className="rounded-xl border bg-background/60 p-2.5">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Boxes className="h-3.5 w-3.5" /> Submodel · {sub.copies} linked {sub.copies === 1 ? 'copy' : 'copies'}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground"><span className="kbd">⌥</span>-click a single part to edit it; every copy follows.</p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Button variant="secondary" size="sm" onClick={copySub}><Link2 /> Copy</Button>
            <Button variant="secondary" size="sm" onClick={() => { const s = useStudio.getState(); s.commit(unlinkCopy(s.bricks, sub.inst)); s.notify('This copy is on its own now'); }}><Unlink2 /> Unlink</Button>
            <Button variant="secondary" size="sm" onClick={() => { const s = useStudio.getState(); s.commit(releaseSubmodel(s.bricks, sub.def).map((b) => (b.group && s.bricks.some((x) => x.link?.def === sub.def && x.group === b.group) ? { ...b, group: undefined } : b))); s.notify('Submodel released: all its copies are plain parts again'); }}><PackageOpen /> Release</Button>
          </div>
        </div>
      ) : count > 1 ? (
        <Button variant="secondary" size="sm" onClick={makeSub}><Boxes /> Make submodel</Button>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Mirror</span>
        <ToggleGroup type="single" value={axis} onValueChange={(v) => v && setAxis(v as MirrorAxis)} className="flex-1">
          <ToggleGroupItem value="x">Left ↔ right</ToggleGroupItem>
          <ToggleGroupItem value="z">Front ↔ back</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => mirror(true)}><Copy /> Mirror copy</Button>
        <Button variant="secondary" size="sm" onClick={() => mirror(false)}><FlipHorizontal2 /> Flip</Button>
        <Button variant="secondary" size="sm" onClick={split}><Grid2x2 /> Split</Button>
        <Button variant="secondary" size="sm" disabled={count < 2} onClick={merge}><Combine /> Merge</Button>
      </div>
    </section>
  );
}
