import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
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
import JellyfinSeriesScreen, {
  formatEpisodeNumber,
  watchedFraction,
} from '../../../src/screens/jellyfin/JellyfinSeriesScreen';

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

const series: BaseItemDto = {
  Id: 'series-1',
  Name: 'The Expanse',
  Type: 'Series',
};

const navigate = jest.fn();
const onBack = jest.fn();

const renderSeries = async (fetchImpl: jest.Mock) => {
  const store = new MemoryKeyValueStore();
  await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

  return render(
    <JellyfinProvider
      store={store}
      clientInfo={{ name: 'Jellyfin Vega', version: '0.1.0' }}
      deviceName="Living Room"
      fetchImpl={fetchImpl as unknown as typeof fetch}>
      <JellyfinSeriesScreen
        series={series}
        navigation={{ navigate }}
        onBack={onBack}
      />
    </JellyfinProvider>,
  );
};

/** /Users/Me, then /Shows/{id}/Seasons, then /Shows/{id}/Episodes. */
const happyPath = () =>
  jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
    .mockResolvedValueOnce(
      jsonResponse({
        Items: [
          { Id: 'season-1', Name: 'Season 1' },
          { Id: 'season-2', Name: 'Season 2' },
        ],
      }),
    )
    .mockResolvedValue(
      jsonResponse({
        Items: [
          {
            Id: 'ep-1',
            Name: 'Dulcinea',
            Type: 'Episode',
            ParentIndexNumber: 1,
            IndexNumber: 1,
            RunTimeTicks: 24_000_000_000,
            UserData: { PlaybackPositionTicks: 12_000_000_000 },
          },
          {
            Id: 'ep-2',
            Name: 'The Big Empty',
            Type: 'Episode',
            ParentIndexNumber: 1,
            IndexNumber: 2,
          },
        ],
      }),
    );

beforeEach(() => {
  navigate.mockClear();
  onBack.mockClear();
});

describe('JellyfinSeriesScreen', () => {
  it('lists the seasons of the series', async () => {
    await renderSeries(happyPath());

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-season-season-1')).toBeTruthy(),
    );
    expect(screen.getByTestId('jellyfin-season-season-2')).toBeTruthy();
  });

  it('opens on the first season, so a device with no input still loads episodes', async () => {
    const fetchImpl = happyPath();
    await renderSeries(fetchImpl);

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-episode-ep-1')).toBeTruthy(),
    );

    const episodeCall = fetchImpl.mock.calls.find(([url]: [string]) =>
      url.includes('/Episodes'),
    );
    expect(episodeCall![0]).toContain('seasonId=season-1');
  });

  it('asks the Shows endpoints rather than /Items', async () => {
    const fetchImpl = happyPath();
    await renderSeries(fetchImpl);

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-episode-ep-1')).toBeTruthy(),
    );

    const urls = fetchImpl.mock.calls.map(([url]: [string]) => url);
    expect(
      urls.some((url) => url.includes('/Shows/series-1/Seasons')),
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('/Shows/series-1/Episodes')),
    ).toBe(true);
  });

  it('shows the episode number alongside the title', async () => {
    await renderSeries(happyPath());

    await waitFor(() =>
      expect(screen.getByText('S1 E1  ·  Dulcinea')).toBeTruthy(),
    );
  });

  it('shows a progress bar only for a part-watched episode', async () => {
    await renderSeries(happyPath());

    await waitFor(() =>
      expect(
        screen.getByTestId('jellyfin-episode-progress-ep-1'),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId('jellyfin-episode-progress-ep-2')).toBeNull();
  });

  it('loads the other season when it is chosen', async () => {
    const fetchImpl = happyPath();
    await renderSeries(fetchImpl);

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-episode-ep-1')).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId('jellyfin-season-season-2'));

    await waitFor(() => {
      const calls = fetchImpl.mock.calls.filter(([url]: [string]) =>
        url.includes('seasonId=season-2'),
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('hands a chosen episode to the details screen', async () => {
    await renderSeries(happyPath());

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-episode-ep-1')).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId('jellyfin-episode-ep-1'));

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-details-screen')).toBeTruthy(),
    );
    // The details screen owns playback, so the episode gets resume handling
    // for free — and a part-watched episode offers Resume, not Play.
    expect(screen.getByText('Resume')).toBeTruthy();
  });

  it('surfaces a failure to load seasons', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
      .mockResolvedValue(errorResponse());

    await renderSeries(fetchImpl);

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-series-error')).toBeTruthy(),
    );
  });

  it('says so when a season has no episodes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ Items: [{ Id: 'season-1', Name: 'Season 1' }] }),
      )
      .mockResolvedValue(jsonResponse({ Items: [] }));

    await renderSeries(fetchImpl);

    await waitFor(() =>
      expect(screen.getByText('No episodes in this season.')).toBeTruthy(),
    );
  });

  it('goes back to the library', async () => {
    await renderSeries(happyPath());

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-series-back')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('jellyfin-series-back'));

    expect(onBack).toHaveBeenCalled();
  });
});

describe('formatEpisodeNumber', () => {
  it('reads as it does on the box', () => {
    expect(
      formatEpisodeNumber({ ParentIndexNumber: 2, IndexNumber: 7 }),
    ).toBe('S2 E7');
  });

  it('copes with a special, which has no season', () => {
    expect(formatEpisodeNumber({ IndexNumber: 3 })).toBe('E3');
  });

  it('copes with an episode the server has not numbered', () => {
    expect(formatEpisodeNumber({})).toBe('');
  });

  it('keeps season zero, which is where Jellyfin files specials', () => {
    expect(
      formatEpisodeNumber({ ParentIndexNumber: 0, IndexNumber: 1 }),
    ).toBe('S0 E1');
  });
});

describe('watchedFraction', () => {
  it('is the position over the runtime', () => {
    expect(
      watchedFraction({
        RunTimeTicks: 100,
        UserData: { PlaybackPositionTicks: 25 },
      }),
    ).toBe(0.25);
  });

  it('is zero for an unwatched episode', () => {
    expect(watchedFraction({ RunTimeTicks: 100 })).toBe(0);
  });

  it('never exceeds one, so the bar cannot overflow its track', () => {
    expect(
      watchedFraction({
        RunTimeTicks: 100,
        UserData: { PlaybackPositionTicks: 140 },
      }),
    ).toBe(1);
  });

  it('is zero when the runtime is unknown, rather than dividing by it', () => {
    expect(
      watchedFraction({ UserData: { PlaybackPositionTicks: 25 } }),
    ).toBe(0);
  });
});
