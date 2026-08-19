import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import React from 'react';
import { JellyfinProvider } from '../../../src/jellyfin/react/JellyfinProvider';
import { CREDENTIALS_KEY } from '../../../src/jellyfin/storage/credentialStore';
import { MemoryKeyValueStore } from '../../../src/jellyfin/storage/KeyValueStore';
import LibraryScreen from '../../../src/screens/jellyfin/LibraryScreen';

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  }) as Response;

const errorResponse = (): Response =>
  ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    text: async () => 'boom',
  }) as Response;

const stored = {
  serverUrl: 'http://jellyfin.local:8096',
  accessToken: 'tok',
  userId: 'user-1',
  userName: 'agb',
};

const navigate = jest.fn();

const renderLibrary = async (fetchImpl: jest.Mock) => {
  const store = new MemoryKeyValueStore();
  await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

  return render(
    <JellyfinProvider
      store={store}
      clientInfo={{ name: 'Jellyfin Vega', version: '0.1.0' }}
      deviceName="Living Room"
      fetchImpl={fetchImpl as unknown as typeof fetch}>
      <LibraryScreen navigation={{ navigate }} />
    </JellyfinProvider>,
  );
};

/** /Users/Me, then /UserViews, then /Items. */
const happyPath = () =>
  jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
    .mockResolvedValueOnce(
      jsonResponse({
        Items: [
          { Id: 'lib-movies', Name: 'Movies' },
          { Id: 'lib-shows', Name: 'Shows' },
        ],
      }),
    )
    .mockResolvedValue(
      jsonResponse({
        Items: [
          { Id: 'item-1', Name: 'Arrival', ImageTags: { Primary: 'tag1' } },
          { Id: 'item-2', Name: 'Dune' },
        ],
      }),
    );

/** A library holding one series rather than films. */
const showsPath = () =>
  jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
    .mockResolvedValueOnce(
      jsonResponse({ Items: [{ Id: 'lib-shows', Name: 'Shows' }] }),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        Items: [{ Id: 'series-1', Name: 'The Expanse', Type: 'Series' }],
      }),
    )
    .mockResolvedValue(jsonResponse({ Items: [] }));

describe('LibraryScreen', () => {
  it('lists the libraries the user can see', async () => {
    await renderLibrary(happyPath());

    await waitFor(() => screen.getByTestId('jellyfin-view-lib-movies'));
    expect(screen.getByTestId('jellyfin-view-lib-shows')).toBeTruthy();
  });

  it('opens the first library without waiting for a keypress', async () => {
    // The Vega CLI cannot inject D-pad input, so a screen that needs a press
    // to fetch anything cannot be verified on a headless device.
    const fetchImpl = happyPath();
    await renderLibrary(fetchImpl);

    await waitFor(() => screen.getByText('Arrival'));

    const itemsCall = fetchImpl.mock.calls.find(([url]: [string]) =>
      url.includes('/Items?'),
    );
    expect(itemsCall?.[0]).toContain('parentId=lib-movies');
  });

  it('builds poster URLs including the image tag', async () => {
    // The tag makes a changed poster a different URL, so caches cannot serve
    // the old artwork indefinitely.
    await renderLibrary(happyPath());

    await waitFor(() => screen.getByTestId('jellyfin-item-poster-item-1'));
    const poster = screen.getByTestId('jellyfin-item-poster-item-1');
    expect(poster.props.source.uri).toContain(
      '/Items/item-1/Images/Primary',
    );
    expect(poster.props.source.uri).toContain('tag=tag1');
  });

  it('shows the signed-in user', async () => {
    await renderLibrary(happyPath());
    await waitFor(() =>
      expect(screen.getByText('Jellyfin — agb')).toBeTruthy(),
    );
  });

  it('reports a failure instead of showing an empty library', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
      .mockResolvedValue(errorResponse());

    await renderLibrary(fetchImpl);

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-library-error')).toBeTruthy(),
    );
  });

  it('opens a series on its seasons, not on a play button with nothing behind it', async () => {
    await renderLibrary(showsPath());

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-item-series-1')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('jellyfin-item-series-1'));

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-series-screen')).toBeTruthy(),
    );
    expect(screen.queryByTestId('jellyfin-details-screen')).toBeNull();
  });

  it('says a library is empty rather than looking broken', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ Items: [{ Id: 'lib-movies', Name: 'Movies' }] }),
      )
      .mockResolvedValue(jsonResponse({ Items: [] }));

    await renderLibrary(fetchImpl);
    await waitFor(() =>
      expect(screen.getByText('Nothing in this library yet.')).toBeTruthy(),
    );
  });
});
