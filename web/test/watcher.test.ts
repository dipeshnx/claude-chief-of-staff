import { afterEach, describe, expect, it, vi } from 'vitest';
import { cosPaths } from '../server/data/paths';
import { watchCosFiles } from '../server/data/watcher';
import { makeHome } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('watchCosFiles', () => {
  it('logs watcher errors instead of throwing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = watchCosFiles(cosPaths(await makeHome()), () => {});
    expect(() => w.watcher.emit('error', new Error('boom'))).not.toThrow();
    expect(spy).toHaveBeenCalledWith('[cos-web] file watcher error:', expect.objectContaining({ message: 'boom' }));
    await w.close();
  });
});
