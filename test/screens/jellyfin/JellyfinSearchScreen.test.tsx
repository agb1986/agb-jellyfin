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
import JellyfinSearchScreen, {
  resultSubtitle,
} from '../../../src/screens/jellyfin/JellyfinSearchScreen';

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
const onBack = jest.fn();

const renderSearch = async (fetchImpl: jest.Mock) => {
  const store = new MemoryKeyValueStore();
  await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

  return render(
    <JellyfinProvider
      store={store}
      clientInfo={{ name: 'Jellyfin Vega', version: '0.1.0' }}
      deviceName="Living Room"
      fetchImpl={fetchImpl as unknown as typeof fetch}>
      <JellyfinSearchScreen navigation={{ navigate }} onBack={onBack} />
    </JellyfinProvider>,
  );
};

const withResults = () =>
  jest
    .fn()
    .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
    .mockResolvedValue(
      jsonResponse({
        Items: [
          { Id: 'movie-1', Name: 'Arrival', Type: 'Movie', ProductionYear: 2016 },
          {
            Id: 'ep-1',
            Name: 'Dulcinea',
            Type: 'Episode',
            SeriesName: 'The Expanse',
            ParentIndexNumber: 1,
            IndexNumber: 1,
          },
        ],
      }),
    );

/** Typing on a remote ends with a submit; that is what triggers the search. */
const submit = (text: string) =>
  fireEvent(screen.getByTestId('search_input_text_input'), 'submitEditing', {
    nativeEvent: { text },
  });

/**
 * The provider signs in before a search can run, and the input renders before
 * that finishes — submitting earlier is a no-op, so wait for the session.
 */
const readyToSearch = async (fetchImpl: jest.Mock) => {
  await waitFor(() =>
    expect(screen.getByTestId('search_input_text_input')).toBeTruthy(),
  );
  await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
};

beforeEach(() => {
  navigate.mockClear();
  onBack.mockClear();
});

describe('JellyfinSearchScreen', () => {
  it('searches only once the term is submitted', async () => {
    const fetchImpl = withResults();
    await renderSearch(fetchImpl);
    await readyToSearch(fetchImpl);

    // Typing alone must not search — on a remote each character is several
    // presses, and every one would be a request.
    fireEvent.changeText(
      screen.getByTestId('search_input_text_input'),
      'arriv',
    );
    expect(
      fetchImpl.mock.calls.filter(([url]: [string]) =>
        url.includes('searchTerm'),
      ),
    ).toHaveLength(0);

    submit('arrival');

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-result-movie-1')).toBeTruthy(),
    );
  });

  it('searches every library, not the one that happened to be open', async () => {
    const fetchImpl = withResults();
    await renderSearch(fetchImpl);
    await readyToSearch(fetchImpl);

    submit('arrival');

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-result-movie-1')).toBeTruthy(),
    );

    const url = fetchImpl.mock.calls.find(([called]: [string]) =>
      called.includes('searchTerm'),
    )![0];
    expect(url).toContain('searchTerm=arrival');
    expect(url).toContain('recursive=true');
    expect(url).not.toContain('parentId');
  });

  it('looks for films, series and episodes', async () => {
    const fetchImpl = withResults();
    await renderSearch(fetchImpl);
    await readyToSearch(fetchImpl);

    submit('arrival');

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-result-movie-1')).toBeTruthy(),
    );

    const url = fetchImpl.mock.calls.find(([called]: [string]) =>
      called.includes('searchTerm'),
    )![0];
    expect(url).toContain('includeItemTypes=Movie%2CSeries%2CEpisode');
  });

  it('trims the term, so a trailing space is not part of the search', async () => {
    const fetchImpl = withResults();
    await renderSearch(fetchImpl);
    await readyToSearch(fetchImpl);

    submit('  arrival  ');

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-result-movie-1')).toBeTruthy(),
    );

    const url = fetchImpl.mock.calls.find(([called]: [string]) =>
      called.includes('searchTerm'),
    )![0];
    expect(url).toContain('searchTerm=arrival');
  });

  it('does not search for an empty term', async () => {
    const fetchImpl = withResults();
    await renderSearch(fetchImpl);
    await readyToSearch(fetchImpl);

    submit('   ');

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.filter(([url]: [string]) =>
          url.includes('searchTerm'),
        ),
      ).toHaveLength(0),
    );
  });

  it('says nothing was found rather than showing a blank screen', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
      .mockResolvedValue(jsonResponse({ Items: [] }));

    await renderSearch(fetchImpl);
    await readyToSearch(fetchImpl);

    submit('nothing here');

    await waitFor(() =>
      expect(screen.getByText('Nothing found for "nothing here".')).toBeTruthy(),
    );
  });

  it('surfaces a failed search', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Id: 'user-1' }))
      .mockResolvedValue(errorResponse());

    await renderSearch(fetchImpl);
    await readyToSearch(fetchImpl);

    submit('arrival');

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-search-error')).toBeTruthy(),
    );
  });

  it('opens a chosen result on its details screen', async () => {
    const fetchImpl = withResults();
    await renderSearch(fetchImpl);
    await readyToSearch(fetchImpl);

    submit('arrival');
    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-result-movie-1')).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId('jellyfin-result-movie-1'));

    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-details-screen')).toBeTruthy(),
    );
  });

  it('goes back to the library', async () => {
    await renderSearch(withResults());
    await waitFor(() =>
      expect(screen.getByTestId('jellyfin-search-back')).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId('jellyfin-search-back'));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('resultSubtitle', () => {
  it('places an episode in its series', () => {
    expect(
      resultSubtitle({
        Type: 'Episode',
        SeriesName: 'The Expanse',
        ParentIndexNumber: 1,
        IndexNumber: 2,
      }),
    ).toBe('The Expanse  ·  S1 E2');
  });

  it('says a series is a series, so it is not mistaken for a film', () => {
    expect(resultSubtitle({ Type: 'Series', ProductionYear: 2015 })).toBe(
      'Series  ·  2015',
    );
  });

  it('gives a film its year', () => {
    expect(resultSubtitle({ Type: 'Movie', ProductionYear: 2016 })).toBe(
      '2016',
    );
  });

  it('says nothing when the server gave nothing to say', () => {
    expect(resultSubtitle({ Type: 'Movie' })).toBe('');
  });

  it('copes with an unnumbered episode', () => {
    expect(
      resultSubtitle({ Type: 'Episode', SeriesName: 'The Expanse' }),
    ).toBe('The Expanse');
  });
});
