import type { EndlessRun } from '../../src/game/launch/endless';
/** D1 checkpoints were produced exclusively by this Worker. This codec is never
 * used on client data; client snapshots still use the full compatibility validator. */
export function readTrustedCheckpoint(value: string): EndlessRun {
  return JSON.parse(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && '$launchNumber' in item) {
      return (item as { $launchNumber: string }).$launchNumber === '-Infinity' ? -Infinity : Infinity;
    }
    return item;
  }).run as EndlessRun;
}
