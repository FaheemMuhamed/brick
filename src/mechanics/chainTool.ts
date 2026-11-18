import type { Part } from '../data/library';
import { useStudio, newId } from '../store/studio';
import { CHAIN_PART, LINK, chainPath, chainWheels } from './chain';
import * as sfx from '../lib/sound';

/** Close the loop over the wheels picked with the chain tool and add it to the build. */
export function finishChain(parts: Map<string, Part>) {
  const s = useStudio.getState();
  const ids = s.chainPick;
  if (ids.length < 2) return s.notify('Pick at least two gears or sprockets first.');
  const byId = new Map(s.bricks.map((b) => [b.id, b]));
  // all tread sprockets → a rubber track; anything with gears → a Technic chain
  const kind = ids.every((id) => parts.get(byId.get(id)?.part ?? '')?.sprocket) ? 'tread' : 'chain';
  const brick = { id: newId(), part: CHAIN_PART, color: LINK[kind].color, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number], chain: { kind, wheels: ids } as const };
  const wheels = chainWheels(brick, byId, parts);
  const path = wheels && chainPath(wheels);
  if (!path || 'error' in path) { sfx.bump(); return s.notify(path && 'error' in path ? path.error : 'Those parts cannot carry a chain.'); }
  s.commit([...s.bricks, { ...brick, chain: { kind, wheels: [...ids] } }]);
  useStudio.setState({ chainPick: [] });
  s.select([brick.id]);
  sfx.snap(4);
  s.notify(`${kind === 'tread' ? 'Track' : 'Chain'} of ${Math.max(3, Math.round(path.length / LINK[kind].pitch))} links. Drive a wheel and press Play.`);
}
