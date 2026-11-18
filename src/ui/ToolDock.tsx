import { MousePointer2, Copy, PaintBucket, Pipette, EyeOff, RotateCw, Rotate3d, Trash2, Undo2, Redo2, Group, Ungroup, Ruler, Spline, Link, type LucideIcon } from 'lucide-react';
import { groupBricks, ungroupBricks } from '../building/groups';
import { useStudio, type Tool } from '../store/studio';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import * as sfx from '../lib/sound';

const TOOLS: { id: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select and move', key: 'V' },
  { id: 'clone', icon: Copy, label: 'Clone', key: 'C' },
  { id: 'paint', icon: PaintBucket, label: 'Paint', key: 'P' },
  { id: 'eyedropper', icon: Pipette, label: 'Pick colour', key: 'I' },
  { id: 'hide', icon: EyeOff, label: 'Hide', key: 'L' },
  { id: 'ruler', icon: Ruler, label: 'Ruler', key: 'M' },
  { id: 'hose', icon: Spline, label: 'Flexible hose', key: 'O' },
  { id: 'chain', icon: Link, label: 'Chain / track', key: 'K' },
];

/** One round button in the black dock; the active tool turns brand red. */
function DockButton({ icon: I, label, shortcut, active, disabled, onClick }: { icon: LucideIcon; label: string; shortcut: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'grid h-10 w-10 place-items-center rounded-full text-white/70 transition-all hover:bg-white/10 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            active && 'bg-white text-brand-black shadow-[inset_0_-2px_0_rgba(0,0,0,.12)] hover:bg-white hover:text-brand-black',
          )}
        >
          <I className="h-[18px] w-[18px]" strokeWidth={2} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label} <span className="ml-1 opacity-60">{shortcut}</span></TooltipContent>
    </Tooltip>
  );
}

export default function ToolDock() {
  const tool = useStudio((s) => s.tool);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const held = useStudio((s) => s.heldPart);
  const selection = useStudio((s) => s.selection);
  const bricks = useStudio((s) => s.bricks);
  const selBricks = bricks.filter((b) => selection.has(b.id));
  const groupsInSel = new Set(selBricks.map((b) => b.group ?? '—'));
  // the selection is exactly one existing group → offer Ungroup; otherwise offer Group
  const grouped = selBricks.length > 1 && groupsInSel.size === 1 && !groupsInSel.has('—');
  const canGroup = selBricks.length > 1;
  return (
    <div className="flex items-center gap-1 rounded-full bg-brand-black p-1.5 shadow-[0_14px_30px_-12px_rgba(0,0,0,.6)]">
      {TOOLS.map((t) => (
        <DockButton key={t.id} icon={t.icon} label={t.label} shortcut={t.key} active={tool === t.id} onClick={() => useStudio.getState().setTool(t.id)} />
      ))}
      <Separator orientation="vertical" className="mx-1 h-6 bg-white/15" />
      <DockButton icon={RotateCw} label="Rotate 90°" shortcut="R" onClick={() => (held ? useStudio.getState().rotateHeld() : rotateSelection())} />
      <DockButton icon={Rotate3d} label="Tilt onto its side (part in hand)" shortcut="T" disabled={!held} onClick={() => useStudio.getState().tiltHeld('x')} />
      <DockButton icon={Trash2} label="Delete" shortcut="⌫" onClick={deleteSelection} />
      <DockButton icon={grouped ? Ungroup : Group} label={grouped ? 'Ungroup' : 'Group'} shortcut={grouped ? '⇧⌘G' : '⌘G'} disabled={!canGroup && !grouped} onClick={() => (grouped ? ungroupSelection() : groupSelection())} />
      <Separator orientation="vertical" className="mx-1 h-6 bg-white/15" />
      <DockButton icon={Undo2} label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={() => useStudio.getState().undo()} />
      <DockButton icon={Redo2} label="Redo" shortcut="⇧⌘Z" disabled={!canRedo} onClick={() => useStudio.getState().redo()} />
    </div>
  );
}

export function deleteSelection() {
  const s = useStudio.getState();
  if (!s.selection.size) return;
  sfx.clack();
  s.commit(s.bricks.filter((b) => !s.selection.has(b.id)));
  s.select([]);
}

/** Rotate the selection a quarter turn about its centre, keeping it on the stud grid. */
export function rotateSelection(dir: 1 | -1 = 1) {
  const s = useStudio.getState();
  const sel = s.bricks.filter((b) => s.selection.has(b.id));
  if (!sel.length) return;
  const cx = sel.reduce((a, b) => a + b.pos[0], 0) / sel.length;
  const cz = sel.reduce((a, b) => a + b.pos[2], 0) / sel.length;
  const ox = Math.round(cx * 2) / 2, oz = Math.round(cz * 2) / 2;
  const ang = (dir * Math.PI) / 2;
  const qy = [0, Math.sin(ang / 2), 0, Math.cos(ang / 2)];
  const mulq = (a: number[], b: number[]) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  s.commit(s.bricks.map((b) => {
    if (!s.selection.has(b.id)) return b;
    const dx = b.pos[0] - ox, dz = b.pos[2] - oz;
    const c = Math.cos(ang), sn = Math.sin(ang);
    return { ...b, pos: [ox + dx * c + dz * sn, b.pos[1], oz - dx * sn + dz * c], quat: mulq(qy, b.quat) as any };
  }));
}

export function nudgeSelection(dx: number, dy: number, dz: number) {
  const s = useStudio.getState();
  if (!s.selection.size) return;
  s.commit(s.bricks.map((b) => (s.selection.has(b.id) ? { ...b, pos: [b.pos[0] + dx, Math.max(0, b.pos[1] + dy), b.pos[2] + dz] } : b)));
}

export function groupSelection() {
  const s = useStudio.getState();
  const { bricks, group } = groupBricks(s.bricks, s.selection);
  if (!group) return s.notify('Select two or more parts to group them.');
  s.commit(bricks);
  s.notify(`Grouped ${bricks.filter((b) => b.group === group).length} parts`);
}

export function ungroupSelection() {
  const s = useStudio.getState();
  const next = ungroupBricks(s.bricks, s.selection);
  if (next === s.bricks) return s.notify('Nothing to ungroup.');
  s.commit(next);
  s.notify('Ungrouped');
}
