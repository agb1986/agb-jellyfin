import {
  DEVICE_ID_KEY,
  generateDeviceId,
  loadDeviceInfo,
} from '../../../src/jellyfin/storage/deviceIdentity';
import { MemoryKeyValueStore } from '../../../src/jellyfin/storage/KeyValueStore';

describe('generateDeviceId', () => {
  it('produces a 32-character hex id', () => {
    expect(generateDeviceId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, generateDeviceId));
    expect(ids.size).toBe(200);
  });

  it('falls back to Math.random when the runtime has no crypto', () => {
    // Hermes on Vega is not guaranteed to provide getRandomValues, and an id
    // is not a secret — but it still has to be produced.
    const original = (globalThis as { crypto?: Crypto }).crypto;
    // @ts-expect-error deliberately removing a global for this test
    delete globalThis.crypto;
    try {
      expect(generateDeviceId()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      (globalThis as { crypto?: Crypto }).crypto = original;
    }
  });
});

describe('loadDeviceInfo', () => {
  it('creates and persists an id on first run', async () => {
    const store = new MemoryKeyValueStore();
    const info = await loadDeviceInfo(store, 'Living Room');

    expect(info.name).toBe('Living Room');
    expect(info.id).toMatch(/^[0-9a-f]{32}$/);
    expect(await store.getItem(DEVICE_ID_KEY)).toBe(info.id);
  });

  it('returns the same id on every later run', async () => {
    // Jellyfin keys sessions, resume points and token revocation off this id;
    // a device that regenerates it looks like a new device every launch.
    const store = new MemoryKeyValueStore();
    const first = await loadDeviceInfo(store, 'Living Room');
    const second = await loadDeviceInfo(store, 'Living Room');

    expect(second.id).toBe(first.id);
  });

  it('lets the display name change without disturbing the id', async () => {
    const store = new MemoryKeyValueStore();
    const first = await loadDeviceInfo(store, 'Living Room');
    const renamed = await loadDeviceInfo(store, 'Bedroom');

    expect(renamed.id).toBe(first.id);
    expect(renamed.name).toBe('Bedroom');
  });

  it('gives two devices different ids', async () => {
    const a = await loadDeviceInfo(new MemoryKeyValueStore(), 'Living Room');
    const b = await loadDeviceInfo(new MemoryKeyValueStore(), 'Bedroom');
    expect(a.id).not.toBe(b.id);
  });
});
