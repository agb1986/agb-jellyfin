import { JellyfinSession } from '../../src/jellyfin/JellyfinSession';
import {
  CREDENTIALS_KEY,
  JellyfinCredentials,
} from '../../src/jellyfin/storage/credentialStore';
import { DEVICE_ID_KEY } from '../../src/jellyfin/storage/deviceIdentity';
import { MemoryKeyValueStore } from '../../src/jellyfin/storage/KeyValueStore';

const clientInfo = { name: 'Jellyfin Vega', version: '0.1.0' };

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }) as Response;

const stored: JellyfinCredentials = {
  serverUrl: 'http://stored.local:8096',
  accessToken: 'stored-token',
  userId: 'user-1',
  userName: 'agb',
};

const makeSession = (
  store: MemoryKeyValueStore,
  fetchImpl: jest.Mock,
  serverUrl?: string,
) =>
  JellyfinSession.create({
    store,
    clientInfo,
    deviceName: 'Living Room',
    serverUrl,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

describe('JellyfinSession.create', () => {
  it('starts signed out against the supplied server on a fresh device', async () => {
    const store = new MemoryKeyValueStore();
    const session = await makeSession(
      store,
      jest.fn(),
      'http://jellyfin.local:8096',
    );

    expect(session.isSignedIn).toBe(false);
    expect(session.client.http.serverUrl).toBe('http://jellyfin.local:8096');
    expect(await store.getItem(DEVICE_ID_KEY)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('restores a stored session without a network call', async () => {
    // Verifying here would put a round trip in front of the first frame.
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
    const fetchImpl = jest.fn();

    const session = await makeSession(store, fetchImpl);

    expect(session.isSignedIn).toBe(true);
    expect(session.client.currentUserId).toBe('user-1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prefers the stored server URL over the supplied one', async () => {
    // The stored token is only valid against the server that issued it.
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

    const session = await makeSession(store, jest.fn(), 'http://other:8096');
    expect(session.client.http.serverUrl).toBe('http://stored.local:8096');
  });

  it('refuses to build a client with no address at all', async () => {
    await expect(
      makeSession(new MemoryKeyValueStore(), jest.fn()),
    ).rejects.toThrow(/No Jellyfin server URL/);
  });

  it('keeps the same device id across sessions', async () => {
    const store = new MemoryKeyValueStore();
    const first = await makeSession(store, jest.fn(), 'http://s:8096');
    const second = await makeSession(store, jest.fn(), 'http://s:8096');

    expect(second.client.deviceInfo.id).toBe(first.client.deviceInfo.id);
  });
});

describe('JellyfinSession.verify', () => {
  it('is false when signed out, without asking the server', async () => {
    const fetchImpl = jest.fn();
    const session = await makeSession(
      new MemoryKeyValueStore(),
      fetchImpl,
      'http://s:8096',
    );

    await expect(session.verify()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('confirms a token the server still accepts', async () => {
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ Id: 'user-1' }));

    const session = await makeSession(store, fetchImpl);
    await expect(session.verify()).resolves.toBe(true);
    expect(session.isSignedIn).toBe(true);
  });

  it('signs out when the server rejects the token', async () => {
    // Revoked from the dashboard, or the server was rebuilt.
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse('', 401));

    const session = await makeSession(store, fetchImpl);

    await expect(session.verify()).resolves.toBe(false);
    expect(session.isSignedIn).toBe(false);
    expect(await store.getItem(CREDENTIALS_KEY)).toBeNull();
  });

  it('keeps credentials when the server is merely unreachable', async () => {
    // An unreachable server is not a reason to make the user sign in again.
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const session = await makeSession(store, fetchImpl);

    await expect(session.verify()).rejects.toThrow();
    expect(session.isSignedIn).toBe(true);
    expect(await store.getItem(CREDENTIALS_KEY)).not.toBeNull();
  });
});

describe('JellyfinSession sign-in and sign-out', () => {
  it('persists the server URL alongside the token after Quick Connect', async () => {
    const store = new MemoryKeyValueStore();
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Authenticated: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          AccessToken: 'fresh-token',
          User: { Id: 'user-2', Name: 'agb' },
        }),
      );

    const session = await makeSession(store, fetchImpl, 'http://new.local:8096');
    await session.completeSignIn('s3cr3t', { sleep: async () => undefined });

    expect(session.isSignedIn).toBe(true);
    expect(JSON.parse((await store.getItem(CREDENTIALS_KEY)) as string)).toEqual(
      expect.objectContaining({
        serverUrl: 'http://new.local:8096',
        accessToken: 'fresh-token',
        userId: 'user-2',
        userName: 'agb',
      }),
    );
  });

  it('refuses to store a half-finished sign-in', async () => {
    const store = new MemoryKeyValueStore();
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Authenticated: true }))
      .mockResolvedValueOnce(jsonResponse({ AccessToken: 'fresh-token' }));

    const session = await makeSession(store, fetchImpl, 'http://new.local:8096');

    await expect(
      session.completeSignIn('s3cr3t', { sleep: async () => undefined }),
    ).rejects.toThrow(/without an access token or user id/);
    expect(await store.getItem(CREDENTIALS_KEY)).toBeNull();
  });

  it('keeps the device id when signing out', async () => {
    // Clearing it would present the server with a new device on every
    // sign-out and litter the dashboard with orphans.
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

    const session = await makeSession(store, jest.fn());
    const deviceId = session.client.deviceInfo.id;

    await session.signOut();

    expect(session.isSignedIn).toBe(false);
    expect(session.storedCredentials).toBeNull();
    expect(await store.getItem(CREDENTIALS_KEY)).toBeNull();
    expect(await store.getItem(DEVICE_ID_KEY)).toBe(deviceId);
  });

  it('exposes the stored user name for a "signed in as" line', async () => {
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

    const session = await makeSession(store, jest.fn());
    expect(session.storedCredentials?.userName).toBe('agb');
  });
});
