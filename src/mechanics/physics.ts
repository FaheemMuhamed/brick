import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Part } from '../data/library';
import type { Brick } from '../building/snap';
import { analyseStability, connections } from './stability';

// Drop / shake test: every part becomes a rigid body; every stud or Technic connection becomes a joint
// that can snap. Joints the stability analysis already finds overloaded start broken, and hard impacts
// break joints with too few studs. Gravity is scaled down so the fall reads like slow-motion toy footage.

let ready: Promise<void> | null = null;
const init = () => (ready ??= RAPIER.init());

const GRAVITY = -48;            // studs / s² (true scale would be ≈ -1200: far too fast to watch)
const BREAK_PER_STUD = 900;     // impact force a joint survives per engaged stud
const STEP = 1 / 120;

export type Test = 'drop' | 'shake';
export interface Sim {
  step(dt: number): void;
  xform(b: Brick): { pos: THREE.Vector3; quat: THREE.Quaternion } | null;
  /** parts that ended up away from where they were built */
  loose(): number;
  done(): boolean;
  dispose(): void;
}

export async function createSim(bricks: Brick[], parts: Map<string, Part>, test: Test): Promise<Sim> {
  await init();
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  const events = new RAPIER.EventQueue(true);
  const live = bricks.filter((b) => !b.hidden && parts.has(b.part));
  const lift = test === 'drop' ? 3 : 0;

  // floor: a kinematic slab so the shake test can move it like an earthquake table
  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setFriction(0.9), floorBody);

  const bodies = new Map<string, RAPIER.RigidBody>();
  const handleToBrick = new Map<number, string>();
  const start = new Map<string, THREE.Vector3>();
  const startQ = new Map<string, THREE.Quaternion>();
  for (const b of live) {
    const part = parts.get(b.part)!;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(b.pos[0], b.pos[1] + lift, b.pos[2])
        .setRotation({ x: b.quat[0], y: b.quat[1], z: b.quat[2], w: b.quat[3] })
        .setLinearDamping(0.05).setAngularDamping(0.2),
    );
    const size = part.box.getSize(new THREE.Vector3());
    const c = part.box.getCenter(new THREE.Vector3());
    const col = world.createCollider(
      RAPIER.ColliderDesc.cuboid(Math.max(0.05, size.x / 2 - 0.02), Math.max(0.05, size.y / 2 - 0.02), Math.max(0.05, size.z / 2 - 0.02))
        .setTranslation(c.x, c.y, c.z).setDensity(0.6).setFriction(0.8).setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(BREAK_PER_STUD * 0.5),
      body,
    );
    bodies.set(b.id, body);
    handleToBrick.set(col.handle, b.id);
    start.set(b.id, new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]));
    startQ.set(b.id, new THREE.Quaternion(...b.quat));
  }

  // joints (skip the ones that are already overloaded)
  const weak = new Set(analyseStability(live, parts).weak.map((w) => [w.a, w.b].sort().join('|')));
  const joints = new Map<string, { joint: RAPIER.ImpulseJoint; studs: number; a: string; b: string }[]>();
  for (const e of connections(live, parts)) {
    if (weak.has([e.a, e.b].sort().join('|'))) continue;
    const A = bodies.get(e.a)!, B = bodies.get(e.b)!;
    const pa = new THREE.Vector3(...live.find((x) => x.id === e.a)!.pos), qa = new THREE.Quaternion(...live.find((x) => x.id === e.a)!.quat);
    const pb = new THREE.Vector3(...live.find((x) => x.id === e.b)!.pos), qb = new THREE.Quaternion(...live.find((x) => x.id === e.b)!.quat);
    const la = e.point.clone().sub(pa).applyQuaternion(qa.clone().invert());
    const lb = e.point.clone().sub(pb).applyQuaternion(qb.clone().invert());
    const fa = qa.clone().invert(), fb = qb.clone().invert();
    const data = RAPIER.JointData.fixed(
      { x: la.x, y: la.y, z: la.z }, { x: fa.x, y: fa.y, z: fa.z, w: fa.w },
      { x: lb.x, y: lb.y, z: lb.z }, { x: fb.x, y: fb.y, z: fb.z, w: fb.w },
    );
    const joint = world.createImpulseJoint(data, A, B, true);
    const rec = { joint, studs: e.studs, a: e.a, b: e.b };
    for (const id of [e.a, e.b]) { if (!joints.has(id)) joints.set(id, []); joints.get(id)!.push(rec); }
  }

  const breakJointsOf = (id: string, force: number) => {
    for (const r of joints.get(id) ?? []) {
      if (!r.joint.isValid() || force < r.studs * BREAK_PER_STUD) continue;
      world.removeImpulseJoint(r.joint, true);
    }
  };

  let time = 0, acc = 0;
  const duration = test === 'drop' ? 3.5 : 4;
  return {
    step(dt) {
      acc += Math.min(dt, 0.05);
      while (acc >= STEP) {
        acc -= STEP;
        time += STEP;
        if (test === 'shake' && time < 2.6) {
          // earthquake table: side-to-side then front-to-back, growing then fading
          const amp = 0.35 * Math.sin(Math.min(time, 2.6) / 2.6 * Math.PI);
          floorBody.setNextKinematicTranslation({ x: amp * Math.sin(time * 26), y: -0.5, z: amp * 0.6 * Math.sin(time * 19 + 1) });
        }
        world.step(events);
        events.drainContactForceEvents((ev) => {
          const f = ev.totalForceMagnitude();
          const a = handleToBrick.get(ev.collider1()), b = handleToBrick.get(ev.collider2());
          if (a) breakJointsOf(a, f);
          if (b) breakJointsOf(b, f);
        });
      }
    },
    xform(b) {
      const body = bodies.get(b.id);
      if (!body) return null;
      const t = body.translation(), r = body.rotation();
      return { pos: new THREE.Vector3(t.x, t.y, t.z), quat: new THREE.Quaternion(r.x, r.y, r.z, r.w) };
    },
    loose() {
      // a part came loose if it ended up more than a third of a stud away, or tipped more than 15°,
      // from where it sits in the build (an intact model lands right back on its footprint)
      let n = 0;
      for (const [id, body] of bodies) {
        const t = body.translation(), r = body.rotation();
        const s0 = start.get(id)!, q0 = startQ.get(id)!;
        const moved = Math.hypot(t.x - s0.x, t.y - s0.y, t.z - s0.z) > 0.35;
        const tipped = 2 * Math.acos(Math.min(1, Math.abs(q0.x * r.x + q0.y * r.y + q0.z * r.z + q0.w * r.w))) > (15 * Math.PI) / 180;
        if (moved || tipped) n++;
      }
      return n;
    },
    done: () => time >= duration,
    dispose: () => { world.free(); events.free(); },
  };
}
