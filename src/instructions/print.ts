import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadPartGeometry, type BrickColor, type Part } from '../data/library';
import { partThumb } from '../data/thumbs';
import { brickMaterial } from '../studio/materials';
import type { Brick } from '../building/snap';

// Printable instructions: render each step (everything built so far, the new parts on top) from one fixed 3/4
// camera, add a manual-style callout of that step's parts, and open a print-ready booklet (Save as PDF).

/** Steps for a free build: bottom up, a few parts per step, parts of one height together. */
export function stepsFromBuild(bricks: Brick[], perStep = 8): Brick[][] {
  const sorted = [...bricks].filter((b) => !b.hidden).sort((a, b) => a.pos[1] - b.pos[1] || a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0]);
  const steps: Brick[][] = [];
  let cur: Brick[] = [];
  let y = sorted[0]?.pos[1];
  for (const b of sorted) {
    if (cur.length >= perStep || (cur.length && Math.abs(b.pos[1] - y!) > 0.01 && cur.length >= 3)) { steps.push(cur); cur = []; }
    y = b.pos[1];
    cur.push(b);
  }
  if (cur.length) steps.push(cur);
  return steps;
}

export async function printInstructions(title: string, steps: Brick[][], parts: Map<string, Part>, colors: Map<number, BrickColor>, onProgress?: (done: number, total: number) => void) {
  // open the window first (inside the click) so pop-up blockers allow it
  const win = window.open('', '_blank');
  if (!win) throw new Error('Allow pop-ups for this site to print instructions.');
  win.document.write('<p style="font-family:system-ui;padding:24px">Preparing your instructions…</p>');

  const W = 1100, H = 820;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight('#ffffff', 1.8);
  scene.add(key, new THREE.AmbientLight('#ffffff', 0.35));

  // one camera for the whole booklet, framing the finished model
  const all = steps.flat();
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const b of all) {
    const p = parts.get(b.part);
    if (!p) continue;
    m.compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(...b.quat), new THREE.Vector3(1, 1, 1));
    box.union(p.box.clone().applyMatrix4(m));
  }
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(2, box.getBoundingSphere(new THREE.Sphere()).radius);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 500);
  const dir = new THREE.Vector3(0.65, 0.6, 0.75).normalize();
  camera.position.copy(centre).add(dir.multiplyScalar((radius / Math.sin((15 * Math.PI) / 180)) * 1.05));
  camera.lookAt(centre);
  key.position.copy(camera.position).add(new THREE.Vector3(6, 14, 2));

  const images: string[] = [];
  const callouts: { src: string; qty: number; name: string }[][] = [];
  const highlight = new THREE.MeshBasicMaterial({ color: '#E8762B', transparent: true, opacity: 0.18, depthWrite: false });
  let previous: THREE.Mesh[] = [];
  for (let i = 0; i < steps.length; i++) {
    // last step's highlight comes off
    for (const h of previous) scene.remove(h);
    previous = [];
    for (const b of steps[i]) {
      const g = await loadPartGeometry(b.part).catch(() => null);
      if (!g) continue;
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(...b.pos);
        mesh.quaternion.set(...b.quat);
        scene.add(mesh);
        return mesh;
      };
      if (g.main) {
        add(g.main, brickMaterial(colors.get(b.color)));
        previous.push(add(g.main, highlight)); // a soft orange wash marks this step's new parts
      }
      for (const f of g.fixed) add(f.geometry, brickMaterial(colors.get(f.color)));
    }
    renderer.render(scene, camera);
    images.push(renderer.domElement.toDataURL('image/jpeg', 0.9));
    const counts = new Map<string, { part: string; color: number; qty: number }>();
    for (const b of steps[i]) { const k = `${b.part}:${b.color}`; const c = counts.get(k) ?? { part: b.part, color: b.color, qty: 0 }; c.qty++; counts.set(k, c); }
    callouts.push(await Promise.all([...counts.values()].map(async (c) => ({ src: await partThumb(c.part, colors.get(c.color)).catch(() => ''), qty: c.qty, name: parts.get(c.part)?.name ?? c.part }))));
    onProgress?.(i + 1, steps.length);
  }
  for (const h of previous) scene.remove(h);
  renderer.render(scene, camera);
  const cover = renderer.domElement.toDataURL('image/jpeg', 0.92);
  renderer.dispose();
  pmrem.dispose();

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · instructions</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@800;900&family=Figtree:wght@400;600&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Figtree, system-ui, sans-serif; color: #0f0f12; }
  .page { page-break-after: always; break-after: page; min-height: 180mm; display: flex; flex-direction: column; }
  .cover { align-items: center; justify-content: center; text-align: center; }
  .cover h1 { font-family: Nunito, sans-serif; font-weight: 900; font-size: 34pt; margin: 6mm 0 2mm; letter-spacing: -0.02em; }
  .cover p { color: #666; margin: 0; }
  .cover img { max-width: 100%; max-height: 130mm; }
  .step { position: relative; }
  .num { font-family: Nunito, sans-serif; font-weight: 900; font-size: 40pt; line-height: 1; }
  .callout { position: absolute; top: 0; right: 0; display: flex; flex-wrap: wrap; gap: 3mm; max-width: 120mm; justify-content: flex-end;
    border: 0.5mm solid #ddd; border-radius: 3mm; padding: 3mm; background: #fafafa; }
  .callout div { text-align: center; font-weight: 600; font-size: 10pt; }
  .callout img { width: 18mm; height: 18mm; object-fit: contain; display: block; }
  .shot { flex: 1; display: flex; align-items: center; justify-content: center; }
  .shot img { max-width: 100%; max-height: 150mm; }
  .foot { font-size: 8pt; color: #999; text-align: right; }
  @media screen { body { background: #eee; } .page { background: #fff; width: 297mm; margin: 8mm auto; padding: 12mm; box-shadow: 0 2px 12px rgba(0,0,0,.12); } }
</style></head><body>
<section class="page cover"><img src="${cover}"><h1>${esc(title)}</h1><p>${all.length} parts · ${steps.length} steps · Brick Atelier</p></section>
${images.map((img, i) => `<section class="page step">
  <div class="num">${i + 1}</div>
  <div class="callout">${callouts[i].map((c) => `<div><img src="${c.src}" alt="${esc(c.name)}">×${c.qty}</div>`).join('')}</div>
  <div class="shot"><img src="${img}"></div>
  <div class="foot">${esc(title)} · ${i + 1} / ${steps.length}</div>
</section>`).join('')}
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));</script>
</body></html>`);
  win.document.close();
}
