import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Screens } from '../../../src/components/navigation/types';
import { JellyfinProvider } from '../../../src/jellyfin/react/JellyfinProvider';
import { CREDENTIALS_KEY } from '../../../src/jellyfin/storage/credentialStore';
import { MemoryKeyValueStore } from '../../../src/jellyfin/storage/KeyValueStore';
import JellyfinDetailsScreen from '../../../src/screens/jellyfin/JellyfinDetailsScreen';

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
};

const item = {
  Id: 'item-1',
  Name: 'Arrival',
  Overview: 'Linguist meets heptapods.',
  ProductionYear: 2016,
  RunTimeTicks: 71_040_000_000,
  Genres: ['Science Fiction'],
};

const navigate = jest.fn();

const renderDetails = async (fetchImpl: jest.Mock, overrides = {}) => {
  const store = new MemoryKeyValueStore();
  await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

  return render(
    <JellyfinProvider
      store={store}
      clientInfo={{ name: 'Jellyfin Vega', version: '0.1.0' }}
      deviceName="Living Room"
      fetchImpl={fetchImpl as unknown as typeof fetch}>
      <JellyfinDetailsScreen
        item={{ ...item, ...overrides }}
        navigation={{ navigate }}
        onBack={jest.fn()}
      />
    </JellyfinProvider>,
  );
};

/** /Users/Me for the provider, then PlaybackInfo for the play button. */
const playbackFetch = () =>
  jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
    .mockResolvedValue(
      jsonResponse({
        PlaySessionId: 'play-1',
        MediaSources: [
          {
            Id: 'source-1',
            Container: 'mp4',
            SupportsDirectPlay: true,
            MediaStreams: [
              { Type: 'Video', Codec: 'h264', Width: 1920 },
              { Type: 'Audio', Codec: 'aac' },
            ],
          },
        ],
      }),
    );

describe('JellyfinDetailsScreen', () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it('shows the metadata a viewer chooses from', async () => {
    await renderDetails(playbackFetch());

    expect(screen.getByText('Arrival')).toBeTruthy();
    expect(screen.getByText('Linguist meets heptapods.')).toBeTruthy();
    // Year, runtime and genre on one line.
    expect(screen.getByText(/2016.*1h 58m.*Science Fiction/)).toBeTruthy();
  });

  it('asks the server how to play, then hands the result to the player', async () => {
    const fetchImpl = playbackFetch();
    await renderDetails(fetchImpl);
    // The provider bootstraps asynchronously; pressing before the session
    // exists is a no-op, which would make this test pass for the wrong reason.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    fireEvent.press(screen.getByTestId('jellyfin-play-button'));

    await waitFor(() => expect(navigate).toHaveBeenCalled());

    const [screenName, params] = navigate.mock.calls[0];
    expect(screenName).toBe(Screens.PLAYER_SCREEN);
    // HLS by default: the static player cannot open a Jellyfin URL on Vega.
    expect(params.data.uri).toContain('/Videos/item-1/master.m3u8');
    expect(params.data.format).toBe('HLS');
    expect(params.data.title).toBe('Arrival');

    const playbackInfoCall = fetchImpl.mock.calls.find(([url]: [string]) =>
      url.includes('/PlaybackInfo'),
    );
    expect(playbackInfoCall).toBeDefined();
  });

  it('offers Resume when the server has a position for this user', async () => {
    await renderDetails(playbackFetch(), {
      UserData: { PlaybackPositionTicks: 6_000_000_000 },
    });
    expect(screen.getByText('Resume')).toBeTruthy();
  });

  it('says Play when there is nothing to resume', async () => {
    await renderDetails(playbackFetch());
    expect(screen.getByText('Play')).toBeTruthy();
  });

  it('reports a failure instead of navigating to a player with no stream', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
      .mockResolvedValue(errorResponse());

    await renderDetails(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    fireEvent.press(screen.getByTestId('jellyfin-play-button'));

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-details-error')).toBeTruthy(),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});
