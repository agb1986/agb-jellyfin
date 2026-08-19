import { JellyfinClient } from '../../../src/jellyfin/JellyfinClient';
import { PlaybackReporter } from '../../../src/jellyfin/playback/PlaybackReporter';

const makeClient = () => {
  const client = new JellyfinClient({
    serverUrl: 'http://jellyfin.local:8096',
    clientInfo: { name: 'Jellyfin Vega', version: '0.1.0' },
    deviceInfo: { name: 'Living Room', id: 'device-abc' },
    fetchImpl: jest.fn() as unknown as typeof fetch,
  });
  client.setAccessToken('tok', 'user-1');
  client.reportPlaybackStart = jest.fn().mockResolvedValue(undefined);
  client.reportPlaybackProgress = jest.fn().mockResolvedValue(undefined);
  client.reportPlaybackStopped = jest.fn().mockResolvedValue(undefined);
  return client;
};

const descriptor = {
  itemId: 'item-1',
  playSessionId: 'play-1',
  mediaSourceId: 'source-1',
  playMethod: 'DirectStream' as const,
};

/** A clock the test moves by hand. */
const makeClock = () => {
  let value = 0;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
};

describe('PlaybackReporter', () => {
  it('reports a start carrying the session the server handed out', async () => {
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor);

    await reporter.start({ positionSeconds: 0 });

    expect(client.reportPlaybackStart).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        playSessionId: 'play-1',
        mediaSourceId: 'source-1',
        playMethod: 'DirectStream',
        positionTicks: 0,
      }),
    );
  });

  it('starts only once, however many times it is asked', async () => {
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor);

    await reporter.start({ positionSeconds: 0 });
    await reporter.start({ positionSeconds: 5 });

    expect(client.reportPlaybackStart).toHaveBeenCalledTimes(1);
  });

  it('converts seconds to the ticks the API expects', async () => {
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor);

    await reporter.start({ positionSeconds: 65 });

    expect(client.reportPlaybackStart).toHaveBeenCalledWith(
      expect.objectContaining({ positionTicks: 650_000_000 }),
    );
  });

  it('throttles progress to one report per interval', async () => {
    // Every frame would be a request per frame; the point is resume accuracy,
    // not telemetry.
    const clock = makeClock();
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor, {
      progressIntervalMs: 10000,
      now: clock.now,
    });

    await reporter.start({ positionSeconds: 0 });

    await reporter.progress({ positionSeconds: 1 });
    await reporter.progress({ positionSeconds: 2 });
    expect(client.reportPlaybackProgress).not.toHaveBeenCalled();

    clock.advance(10000);
    await reporter.progress({ positionSeconds: 10 });
    expect(client.reportPlaybackProgress).toHaveBeenCalledTimes(1);
  });

  it('sends a pause immediately rather than waiting for the interval', async () => {
    // The server uses it to decide whether this session is still watching, and
    // ten seconds is long enough for a pause to look like a stall.
    const clock = makeClock();
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor, {
      progressIntervalMs: 10000,
      now: clock.now,
    });

    await reporter.start({ positionSeconds: 0 });
    await reporter.progress({ positionSeconds: 3, isPaused: true });

    expect(client.reportPlaybackProgress).toHaveBeenCalledWith(
      expect.objectContaining({ isPaused: true }),
    );
  });

  it('sends a resume immediately too', async () => {
    const clock = makeClock();
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor, {
      progressIntervalMs: 10000,
      now: clock.now,
    });

    await reporter.start({ positionSeconds: 0 });
    await reporter.progress({ positionSeconds: 3, isPaused: true });
    await reporter.progress({ positionSeconds: 3, isPaused: false });

    expect(client.reportPlaybackProgress).toHaveBeenCalledTimes(2);
  });

  it('ignores progress before a start', async () => {
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor);

    await reporter.progress({ positionSeconds: 5 });

    expect(client.reportPlaybackProgress).not.toHaveBeenCalled();
  });

  it('reports the stop position, which is what sets the resume point', async () => {
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor);

    await reporter.start({ positionSeconds: 0 });
    await reporter.stop({ positionSeconds: 120 });

    expect(client.reportPlaybackStopped).toHaveBeenCalledWith(
      expect.objectContaining({ positionTicks: 1_200_000_000 }),
    );
  });

  it('stops only once, and goes quiet afterwards', async () => {
    // The player unmounts through more than one path, so stop can be called
    // twice; a second report would overwrite the resume point with a stale
    // position.
    const clock = makeClock();
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor, {
      now: clock.now,
    });

    await reporter.start({ positionSeconds: 0 });
    await reporter.stop({ positionSeconds: 120 });
    await reporter.stop({ positionSeconds: 0 });
    clock.advance(60000);
    await reporter.progress({ positionSeconds: 130 });

    expect(client.reportPlaybackStopped).toHaveBeenCalledTimes(1);
    expect(client.reportPlaybackProgress).not.toHaveBeenCalled();
  });

  it('says nothing on stop if playback never started', async () => {
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor);

    await reporter.stop({ positionSeconds: 0 });

    expect(client.reportPlaybackStopped).not.toHaveBeenCalled();
  });

  it('never lets a failed report reach the player', async () => {
    // Losing a report costs a little resume accuracy; raising into the player
    // loses the frame.
    const client = makeClient();
    (client.reportPlaybackStart as jest.Mock).mockRejectedValue(
      new Error('server down'),
    );
    const reporter = new PlaybackReporter(client, descriptor);

    await expect(
      reporter.start({ positionSeconds: 0 }),
    ).resolves.toBeUndefined();
  });

  it('never reports a negative position', async () => {
    const client = makeClient();
    const reporter = new PlaybackReporter(client, descriptor);

    await reporter.start({ positionSeconds: -1 });

    expect(client.reportPlaybackStart).toHaveBeenCalledWith(
      expect.objectContaining({ positionTicks: 0 }),
    );
  });
});
