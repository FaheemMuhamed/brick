import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { generateAlternate, DESIGNS } from '../generate';
import { analyseStability } from '../../mechanics/stability';

const manifest = JSON.parse(fs.readFileSync('public/data/parts.json', 'utf8'));
const lib = await import('../../data/library');
const parts = new Map<string, any>(manifest.parts.map((p: any) => [p.id, (lib as any).__toPartForTest(p)]));
const colors = new Map<number, any>(JSON.parse(fs.readFileSync('public/data/colors.json', 'utf8')).map((c: any) => [c.code, c]));
const inv = (set: string) => JSON.parse(fs.readFileSync(`public/data/inv/${set}.json`, 'utf8')).parts as [string, number, number][];

describe('alternate builds', () => {
  const set = '10696-1'; // Medium Creative Brick Box
  const inventory = inv(set);

  for (const d of DESIGNS) {
    it(`designs a ${d.label.toLowerCase()} using only the set's own parts`, () => {
      const r = generateAlternate(set, 'Medium Creative Brick Box', inventory, parts, colors, 7, d.id);
      expect(r).not.toBeNull();
      const used = new Map<string, number>();
      for (const s of r!.model.steps) for (const t of s) used.set(`${t.part}:${t.color}`, (used.get(`${t.part}:${t.color}`) ?? 0) + 1);
      const have = new Map<string, number>();
      for (const [p, c, q] of inventory) have.set(`${p}:${c}`, (have.get(`${p}:${c}`) ?? 0) + q);
      for (const [k, n] of used) expect(n).toBeLessThanOrEqual(have.get(k) ?? 0);
      expect(r!.coverage).toBeGreaterThanOrEqual(0.92);
      expect(r!.model.steps.every((s) => s.length <= 10)).toBe(true);
    });
  }

  it('the generated model stands up: nothing floats', () => {
    const r = generateAlternate(set, 'Medium Creative Brick Box', inventory, parts, colors, 3, 'cottage')!;
    const bricks = r.model.steps.flat();
    const s = analyseStability(bricks, parts);
    expect(s.floating).toHaveLength(0);
  });

  it('a set with no plain bricks or plates gives no build', () => {
    expect(generateAlternate('x-1', 'x', [['3647', 7, 4]], parts, colors)).toBeNull();
  });
});

describe('smarter designs', async () => {
  const { generatePhotoMosaic, standardPieces, colorDistance } = await import('../generate');
  const THREE = await import('three');
  const pieces = standardPieces(parts);
  const set = '10696-1';
  const inventory = inv(set);

  it('reads which way a slope falls from its geometry', () => {
    expect(pieces.get('3039')?.slope?.down).toEqual([0, 1]); // 2x2 slope falls toward its open side
    expect(pieces.get('3037')?.w).toBe(4);
  });

  it('cottage roof slopes all face outward', () => {
    const r = generateAlternate(set, 'box', inventory, parts, colors, 2, 'cottage')!;
    const all = r.model.steps.flat();
    const slopes = all.filter((t) => pieces.get(t.part)?.slope);
    expect(slopes.length).toBeGreaterThan(0);
    const cz = all.reduce((a, t) => a + t.pos[2], 0) / all.length;
    for (const t of slopes) {
      const down = pieces.get(t.part)!.slope!.down;
      const dir = new THREE.Vector3(down[0], 0, down[1]).applyQuaternion(new THREE.Quaternion(...t.quat));
      expect(dir.z * (t.pos[2] - cz)).toBeGreaterThan(0); // falls away from the ridge
    }
  });

  it('a tree gets a woody trunk and leafy canopy from the set\'s closest shades', () => {
    const r = generateAlternate(set, 'box', inventory, parts, colors, 4, 'tree')!;
    const all = r.model.steps.flat();
    const top = all.reduce((a, t) => (t.pos[1] > a.pos[1] ? t : a));
    // the topmost canopy brick is closer to green than to red
    const hex = colors.get(top.color)?.hex;
    expect(colorDistance(hex, '#4B974A')).toBeLessThan(colorDistance(hex, '#C91A09'));
  });

  it('turns a photo into a mosaic in the set\'s plate colours', () => {
    const n = 8;
    const data = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) { const left = i % n < n / 2; data.set(left ? [200, 30, 30, 255] : [30, 60, 200, 255], i * 4); }
    const r = generatePhotoMosaic('11717-1', 'Bricks Bricks Plates', inv('11717-1'), parts, colors, { size: n, data });
    expect(r).not.toBeNull();
    const face = r!.model.steps.flat().filter((t) => t.pos[1] > 0.5);
    const reds = face.filter((t) => colorDistance(colors.get(t.color)?.hex, '#C81E1E') < colorDistance(colors.get(t.color)?.hex, '#1E3CC8'));
    expect(reds.length).toBeGreaterThan(0);
    expect(reds.length).toBeLessThan(face.length);
  });
});
