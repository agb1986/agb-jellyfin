import {
  clearCredentials,
  CREDENTIALS_KEY,
  JellyfinCredentials,
  loadCredentials,
  saveCredentials,
} from '../../../src/jellyfin/storage/credentialStore';
import { MemoryKeyValueStore } from '../../../src/jellyfin/storage/KeyValueStore';

const credentials: JellyfinCredentials = {
  serverUrl: 'http://jellyfin.local:8096',
  accessToken: 'tok',
  userId: 'user-1',
  userName: 'agb',
};

describe('credentialStore', () => {
  it('round-trips a stored session', async () => {
    const store = new MemoryKeyValueStore();
    await saveCredentials(store, credentials);
    await expect(loadCredentials(store)).resolves.toEqual(credentials);
  });

  it('returns null when nothing is stored', async () => {
    await expect(loadCredentials(new MemoryKeyValueStore())).resolves.toBeNull();
  });

  it('treats unparseable storage as signed out rather than throwing', async () => {
    // A corrupt record should send the user through Quick Connect again, not
    // wedge the app on a screen a D-pad cannot leave.
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, 'not json');
    await expect(loadCredentials(store)).resolves.toBeNull();
  });

  it.each([
    ['no token', { serverUrl: 'http://s', userId: 'u' }],
    ['no user id', { serverUrl: 'http://s', accessToken: 't' }],
    ['no server url', { accessToken: 't', userId: 'u' }],
    ['empty token', { serverUrl: 'http://s', accessToken: '', userId: 'u' }],
  ])('rejects an incomplete record: %s', async (_label, record) => {
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(record));
    await expect(loadCredentials(store)).resolves.toBeNull();
  });

  it('stores the server URL with the token', async () => {
    // A token is only valid against the server that issued it, so the two
    // must not be able to drift apart.
    const store = new MemoryKeyValueStore();
    await saveCredentials(store, credentials);
    const raw = await store.getItem(CREDENTIALS_KEY);
    expect(JSON.parse(raw as string).serverUrl).toBe(
      'http://jellyfin.local:8096',
    );
  });

  it('forgets the session on clear', async () => {
    const store = new MemoryKeyValueStore();
    await saveCredentials(store, credentials);
    await clearCredentials(store);
    await expect(loadCredentials(store)).resolves.toBeNull();
  });
});

describe('credentialStore when storage is broken', () => {
  const broken = {
    getItem: jest.fn().mockRejectedValue(new Error('data root not set')),
    setItem: jest.fn().mockRejectedValue(new Error('data root not set')),
    removeItem: jest.fn().mockRejectedValue(new Error('data root not set')),
  };

  it('reads as signed out rather than raising', async () => {
    await expect(loadCredentials(broken)).resolves.toBeNull();
  });

  it('does not undo a successful sign-in because the write failed', async () => {
    // The session still works for as long as the app is open.
    await expect(saveCredentials(broken, credentials)).resolves.toBeUndefined();
  });

  it('does not raise on a failed clear', async () => {
    await expect(clearCredentials(broken)).resolves.toBeUndefined();
  });
});
