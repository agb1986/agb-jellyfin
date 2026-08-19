import { VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import { JellyfinProvider } from '../../../src/jellyfin/react/JellyfinProvider';
import { useJellyfinPlaybackReporting } from '../../../src/jellyfin/react/useJellyfinPlaybackReporting';
import { CREDENTIALS_KEY } from '../../../src/jellyfin/storage/credentialStore';
import { MemoryKeyValueStore } from '../../../src/jellyfin/storage/KeyValueStore';

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  }) as Response;

const stored = {
  serverUrl: 'http://jellyfin.local:8096',
  accessToken: 'tok',
  userId: 'user-1',
};

const descriptor = {
  itemId: 'item-1',
  playSessionId: 'play-1',
  mediaSourceId: 'source-1',
  playMethod: 'DirectStream' as const,
};

/** Stand-in for the media element the player owns. */
const makeVideo = (overrides: Partial<VideoPlayer> = {}) =>
  ({
    current: {
      currentTime: 0,
      paused: false,
      readyState: 3,
      ...overrides,
    },
  }) as React.MutableRefObject<VideoPlayer | null>;

const Harness = ({
  videoRef,
  startPositionTicks,
  descriptorOverride,
}: {
  videoRef: React.MutableRefObject<VideoPlayer | null>;
  startPositionTicks?: number;
  descriptorOverride?: typeof descriptor;
}) => {
  useJellyfinPlaybackReporting(videoRef, {
    descriptor: descriptorOverride ?? descriptor,
    startPositionTicks,
    pollIntervalMs: 5,
  });
  return <Text>player</Text>;
};

const renderHarness = async (
  fetchImpl: jest.Mock,
  videoRef: React.MutableRefObject<VideoPlayer | null>,
  props: { startPositionTicks?: number } = {},
) => {
  const store = new MemoryKeyValueStore();
  await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

  return render(
    <JellyfinProvider
      store={store}
      clientInfo={{ name: 'Jellyfin Vega', version: '0.1.0' }}
      deviceName="Living Room"
      fetchImpl={fetchImpl as unknown as typeof fetch}>
      <Harness videoRef={videoRef} {...props} />
    </JellyfinProvider>,
  );
};

/** /Users/Me for the provider, then whatever reporting sends. */
const reportingFetch = () =>
  jest.fn().mockResolvedValue(jsonResponse({ Id: 'user-1' }));

const callsTo = (fetchImpl: jest.Mock, path: string) =>
  fetchImpl.mock.calls.filter(([url]: [string]) => url.includes(path));

describe('useJellyfinPlaybackReporting', () => {
  it('reports a start once the element has decoded something', async () => {
    const fetchImpl = reportingFetch();
    await renderHarness(fetchImpl, makeVideo());

    await waitFor(() =>
      expect(callsTo(fetchImpl, '/Sessions/Playing').length).toBeGreaterThan(0),
    );
  });

  it('waits for readyState rather than reporting an empty player', async () => {
    // Reporting a start before anything is decoded tells the server this
    // session is playing when it is not.
    const fetchImpl = reportingFetch();
    await renderHarness(fetchImpl, makeVideo({ readyState: 0 }));

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(callsTo(fetchImpl, '/Sessions/Playing')).toHaveLength(0);
  });

  it('seeks to a real resume point before reporting', async () => {
    const video = makeVideo();
    const fetchImpl = reportingFetch();
    // 10 minutes in.
    await renderHarness(fetchImpl, video, { startPositionTicks: 6_000_000_000 });

    await waitFor(() => expect(video.current?.currentTime).toBe(600));
  });

  it('ignores a resume point of a couple of seconds', async () => {
    // That is the beginning as far as anyone watching is concerned, and
    // seeking there costs a buffering pause for nothing.
    const video = makeVideo();
    const fetchImpl = reportingFetch();
    await renderHarness(fetchImpl, video, { startPositionTicks: 20_000_000 });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(video.current?.currentTime).toBe(0);
  });

  it('reports a stop when the player goes away', async () => {
    // This is the report that becomes the resume point.
    const video = makeVideo();
    const fetchImpl = reportingFetch();
    const { unmount } = await renderHarness(fetchImpl, video);

    await waitFor(() =>
      expect(callsTo(fetchImpl, '/Sessions/Playing').length).toBeGreaterThan(0),
    );

    video.current!.currentTime = 42;
    unmount();

    await waitFor(() =>
      expect(callsTo(fetchImpl, '/Sessions/Playing/Stopped')).toHaveLength(1),
    );
    const body = JSON.parse(
      callsTo(fetchImpl, '/Sessions/Playing/Stopped')[0][1].body,
    );
    expect(body.PositionTicks).toBe(420_000_000);
  });

  it('does nothing at all without a Jellyfin descriptor', async () => {
    // The player screen is shared with the sample's own content.
    const fetchImpl = reportingFetch();
    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

    render(
      <JellyfinProvider
        store={store}
        clientInfo={{ name: 'Jellyfin Vega', version: '0.1.0' }}
        deviceName="Living Room"
        fetchImpl={fetchImpl as unknown as typeof fetch}>
        <NoDescriptorHarness />
      </JellyfinProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(callsTo(fetchImpl, '/Sessions/Playing')).toHaveLength(0);
  });
});

const NoDescriptorHarness = () => {
  useJellyfinPlaybackReporting(makeVideo(), { pollIntervalMs: 5 });
  return <Text>sample content</Text>;
};

describe('when Shaka opened the stream at the resume point', () => {
  it('does not seek, and reports currentTime unchanged', async () => {
    // Shaka is handed the resume point at load, so its timeline still spans
    // the whole title: currentTime is already the position within the title,
    // and writing to it here is what produced the start/stop loop.
    const video = makeVideo({ currentTime: 912 });
    const fetchImpl = jest.fn().mockResolvedValue(
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ Id: 'user-1' }),
      }) as Response,
    );

    const store = new MemoryKeyValueStore();
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(stored));

    const { unmount } = render(
      <JellyfinProvider
        store={store}
        clientInfo={{ name: 'Jellyfin Vega', version: '0.1.0' }}
        deviceName="Living Room"
        fetchImpl={fetchImpl as unknown as typeof fetch}>
        <OffsetHarness videoRef={video} />
      </JellyfinProvider>,
    );

    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.filter(([url]: [string]) =>
          url.includes('/Sessions/Playing'),
        ).length,
      ).toBeGreaterThan(0),
    );

    expect(video.current?.currentTime).toBe(912);

    const startCall = fetchImpl.mock.calls.find(([url]: [string]) =>
      url.endsWith('/Sessions/Playing'),
    );
    expect(JSON.parse(startCall![1].body).PositionTicks).toBe(9_120_000_000);

    unmount();
  });
});

const OffsetHarness = ({
  videoRef,
}: {
  videoRef: React.MutableRefObject<VideoPlayer | null>;
}) => {
  useJellyfinPlaybackReporting(videoRef, {
    descriptor,
    // Zero because the stream already opened at the resume point.
    startPositionTicks: 0,
    pollIntervalMs: 5,
  });
  return <Text>player</Text>;
};
