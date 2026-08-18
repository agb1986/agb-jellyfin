import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import {
  JellyfinProvider,
  useJellyfin,
} from '../../../src/jellyfin/react/JellyfinProvider';
import { CREDENTIALS_KEY } from '../../../src/jellyfin/storage/credentialStore';
import { MemoryKeyValueStore } from '../../../src/jellyfin/storage/KeyValueStore';

const clientInfo = { name: 'Jellyfin Vega', version: '0.1.0' };

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    text: async () => JSON.stringify(body),
  }) as Response;

const stored = {
  serverUrl: 'http://stored.local:8096',
  accessToken: 'stored-token',
  userId: 'user-1',
};

/** Renders the context's status so assertions read like the UI does. */
const StatusProbe = () => {
  const { status } = useJellyfin();
  return <Text testID="status">{status}</Text>;
};

const renderProvider = (
  store: MemoryKeyValueStore,
  fetchImpl: jest.Mock,
  serverUrl?: string,
) =>
  render(
    <JellyfinProvider
      store={store}
      clientInfo={clientInfo}
      deviceName="Living Room"
      serverUrl={serverUrl}
      fetchImpl={fetchImpl as unknown as typeof fetch}>
      <StatusProbe />
    </JellyfinProvider>,
  );

const expectStatus = async (value: string) =>
  waitFor(() => expect(screen.getByTestId('status').props.children).toBe(value));

describe('JellyfinProvider', () => {
  it('lands on signed-out when there are no stored credentials', async () => {
    await renderProvider(
      new MemoryKeyValueStore(),
      jest.fn(),
      'http://jellyfin.local:8096',
    );
    await expectStatus('signed-out');
  });

  it('lands on signed-in when a stored token still works', async () => {
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ Id: 'user-1' }));

    renderProvider(store, fetchImpl);
    await expectStatus('signed-in');
  });

  it('falls back to signed-out when the stored token was revoked', async () => {
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse('', 401));

    renderProvider(store, fetchImpl);

    await expectStatus('signed-out');
    await waitFor(async () =>
      expect(await store.getItem(CREDENTIALS_KEY)).toBeNull(),
    );
  });

  it('distinguishes an unreachable server from a revoked token', async () => {
    // Showing the sign-in screen because the server was rebooting would make
    // the user re-approve a code for no reason.
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    renderProvider(store, fetchImpl);

    await expectStatus('unavailable');
    expect(await store.getItem(CREDENTIALS_KEY)).not.toBeNull();
  });

  it('reports no-server when nothing supplies an address', async () => {
    renderProvider(new MemoryKeyValueStore(), jest.fn());
    await expectStatus('no-server');
  });

  it('refuses to be used outside a provider', () => {
    // Silence React's error boundary logging for the expected throw.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    expect(() => render(<StatusProbe />)).toThrow(/must be used inside/);
    consoleError.mockRestore();
  });
});
