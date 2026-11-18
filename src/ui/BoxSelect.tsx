import { useEffect, useRef, useState } from 'react';
import type { Part } from '../data/library';
import { useStudio } from '../store/studio';
import { bricksInRect, bridge } from '../studio/bridge';
import { expandToGroups } from '../building/groups';

/**
 * Shift-drag on the viewport draws a selection box. Parts whose centre falls inside are added to the
 * selection (groups come along whole). Hold ⌥ as well to remove them from the selection instead.
 */
export default function BoxSelect({ parts }: { parts: Map<string, Part> }) {
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const start = useRef<{ x: number; y: number; subtract: boolean } | null>(null);
  const live = useRef<typeof rect>(null); // mirror of rect for the window listeners (no side effects in setState)

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const s = useStudio.getState();
      if (!e.shiftKey || e.button !== 0 || e.target !== bridge.canvas || s.heldPart || s.tool !== 'select') return;
      start.current = { x: e.clientX, y: e.clientY, subtract: e.altKey };
    };
    const move = (e: PointerEvent) => {
      const st = start.current;
      if (!st) return;
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 5 && !live.current) return; // still a click
      live.current = { x0: st.x, y0: st.y, x1: e.clientX, y1: e.clientY };
      setRect(live.current);
    };
    const up = () => {
      const st = start.current;
      start.current = null;
      const r = live.current;
      live.current = null;
      setRect(null);
      {
        if (r && st) {
          const s = useStudio.getState();
          const hit = expandToGroups(bricksInRect(r, s.bricks, parts), s.bricks);
          const next = new Set(s.selection);
          for (const id of hit) st.subtract ? next.delete(id) : next.add(id);
          s.set({ selection: next });
          // swallow the click that ends the drag so it doesn't deselect
          const swallow = (ev: Event) => ev.stopPropagation();
          window.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        }
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
    };
  }, [parts]);

  if (!rect) return null;
  const left = Math.min(rect.x0, rect.x1), top = Math.min(rect.y0, rect.y1);
  return (
    <div
      className="pointer-events-none fixed z-40 rounded-[3px] border border-foreground/70 bg-foreground/[0.06]"
      style={{ left, top, width: Math.abs(rect.x1 - rect.x0), height: Math.abs(rect.y1 - rect.y0), backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 6px, hsl(240 6% 6% / .04) 6px 7px)' }}
    />
  );
}
