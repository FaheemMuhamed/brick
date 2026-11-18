import { describe, expect, it } from 'vitest';
import { linkedCopy, makeSubmodel, syncSubmodels, unlinkCopy, type Linked } from '../submodels';

let n = 0;
const id = () => 'n' + n++;
const B = (id: string, color: number, pos: [number, number, number]): Linked => ({ id, part: '3001', color, pos, quat: [0, 0, 0, 1] });
const yaw90: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

function setup() {
  let bricks: Linked[] = [B('a', 4, [0, 1.2, 0]), B('b', 14, [0, 2.4, 0])];
  bricks = makeSubmodel(bricks, new Set(['a', 'b']));
  const inst = bricks[0].link!.inst;
  const copy = linkedCopy(bricks, inst, [10, 0, 0], id);
  return { bricks: [...bricks, ...copy], inst, copyInst: copy[0].link!.inst };
}

describe('submodels', () => {
  it('recolouring a part in one copy recolours it in every copy', () => {
    const { bricks } = setup();
    const next = bricks.map((b) => (b.id === 'b' ? { ...b, color: 1 } : b));
    const out = syncSubmodels(bricks, next, id);
    const yellows = out.filter((b) => b.color === 14);
    expect(yellows).toHaveLength(0);
    expect(out.filter((b) => b.color === 1)).toHaveLength(2);
  });

  it('moving a part inside one copy moves it in the other copy too', () => {
    const { bricks } = setup();
    const next = bricks.map((b) => (b.id === 'b' ? { ...b, pos: [1, 2.4, 0] as [number, number, number] } : b));
    const out = syncSubmodels(bricks, next, id);
    const otherTop = out.find((b) => b.link?.local === 'b' && b.id !== 'b')!;
    expect(otherTop.pos[0]).toBeCloseTo(11);
    expect(otherTop.pos[1]).toBeCloseTo(2.4);
  });

  it('deleting a part in one copy deletes it in every copy', () => {
    const { bricks } = setup();
    const out = syncSubmodels(bricks, bricks.filter((b) => b.id !== 'b'), id);
    expect(out.filter((b) => b.link?.local === 'b')).toHaveLength(0);
    expect(out).toHaveLength(2);
  });

  it('moving or turning a whole copy only moves that copy', () => {
    const { bricks, copyInst } = setup();
    const next = bricks.map((b) => (b.link?.inst === copyInst ? { ...b, pos: [b.pos[0] + 5, b.pos[1], b.pos[2]] as [number, number, number] } : b));
    const out = syncSubmodels(bricks, next, id);
    expect(out.find((b) => b.id === 'a')!.pos[0]).toBe(0);
    // a quarter turn of the whole copy about its first part
    const turned = bricks.map((b) => (b.link?.inst === copyInst ? { ...b, quat: yaw90 } : b));
    const out2 = syncSubmodels(bricks, turned, id);
    expect(out2.find((b) => b.id === 'a')!.quat).toEqual([0, 0, 0, 1]);
  });

  it('an unlinked copy no longer follows', () => {
    const { bricks, copyInst } = setup();
    const free = unlinkCopy(bricks, copyInst);
    const out = syncSubmodels(free, free.map((b) => (b.id === 'b' ? { ...b, color: 2 } : b)), id);
    expect(out.filter((b) => b.color === 2)).toHaveLength(1);
  });
});
