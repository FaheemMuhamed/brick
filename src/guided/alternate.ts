import type { BrickColor, Part } from '../data/library';
import { generateAlternate, type Design } from './generate';
import { startGuided } from './actions';
import { useStudio } from '../store/studio';

/** Generate an alternate build for a set and start it as a guide. Returns false if the set has no plain bricks/plates. */
export function startAlternate(
  set: string, setName: string, inventory: [string, number, number][], parts: Map<string, Part>, colors: Map<number, BrickColor>,
  opts: { seed?: number; design?: Design } = {},
) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const r = generateAlternate(set, setName, inventory, parts, colors, seed, opts.design);
  if (!r) return false;
  startGuided(r.model);
  useStudio.getState().notify(`${r.used} parts from ${setName}`);
  return true;
}

/** Photo → mosaic: size the picture to the set's plate area, quantise to its colours, and start the guide. */
export async function startPhotoMosaic(
  set: string, setName: string, inventory: [string, number, number][], parts: Map<string, Part>, colors: Map<number, BrickColor>, file: File,
) {
  const { generatePhotoMosaic } = await import('./generate');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const s = Math.min(bitmap.width, bitmap.height);
  // centre-crop to a square and scale to whatever size the generator asks for
  const sample = (n: number) => {
    canvas.width = canvas.height = n;
    ctx.drawImage(bitmap, (bitmap.width - s) / 2, (bitmap.height - s) / 2, s, s, 0, 0, n, n);
    return ctx.getImageData(0, 0, n, n).data;
  };
  const r = generatePhotoMosaic(set, setName, inventory, parts, colors, sample);
  if (!r) return false;
  startGuided(r.model);
  const n = Math.round(Math.sqrt(r.model.steps.flat().length ? r.model.steps.flat().reduce((m, t) => Math.max(m, Math.abs(t.pos[0])), 0) * 2 : 0));
  useStudio.getState().notify(`Photo mosaic · ${r.used} plates from ${setName}`);
  void n;
  return true;
}
