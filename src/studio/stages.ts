import * as THREE from 'three';
import type { StagePreset } from '../store/studio';

export interface Stage {
  label: string; bg: string; floor: string; grid: string; key: string; keyIntensity: number;
  fill: string; rim: string; envIntensity: number; dark: boolean;
}
export interface World { bg: string; floor: string; grid: string; dark: boolean }
/** Backdrop, floor and grid colours for a preset, optionally re-tinted to a custom world colour. */
export function worldColors(stage: Stage, custom: string | null): World {
  if (!custom) return { bg: stage.bg, floor: stage.floor, grid: stage.grid, dark: stage.dark };
  const c = new THREE.Color(custom);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const dark = hsl.l < 0.42;
  const floor = c.clone().offsetHSL(0, -0.04, dark ? 0.03 : 0.03);
  const grid = c.clone().offsetHSL(0, 0, dark ? 0.09 : -0.1);
  return { bg: '#' + c.getHexString(), floor: '#' + floor.getHexString(), grid: '#' + grid.getHexString(), dark };
}
export const WORLD_SWATCHES = ['#DCE1E8', '#F4EFE6', '#E7DCCB', '#D8E6DC', '#DDE6F2', '#F2DCDC', '#2B3245', '#121826'];

export const STAGES: Record<StagePreset, Stage> = {
  daylight: { label: 'Daylight studio', bg: '#DCE1E8', floor: '#E6E9EE', grid: '#C5CCD6', key: '#FFF6EA', keyIntensity: 2.5, fill: '#DCE8FF', rim: '#FFFFFF', envIntensity: 0.9, dark: false },
  workshop: { label: 'Warm workshop', bg: '#E2D6C6', floor: '#E8DDCF', grid: '#CDBFAC', key: '#FFDDB0', keyIntensity: 2.6, fill: '#FFE9CF', rim: '#FFF3E0', envIntensity: 0.85, dark: false },
  night: { label: 'Night showcase', bg: '#121826', floor: '#161D2C', grid: '#26304A', key: '#CFE0FF', keyIntensity: 2.6, fill: '#3A4F8C', rim: '#9FC2FF', envIntensity: 0.7, dark: true },
  white: { label: 'Clean white', bg: '#F3F4F5', floor: '#F6F7F8', grid: '#DDE0E4', key: '#FFFFFF', keyIntensity: 2.3, fill: '#FFFFFF', rim: '#FFFFFF', envIntensity: 1.0, dark: false },
};
