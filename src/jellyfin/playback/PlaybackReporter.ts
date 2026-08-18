import { JellyfinClient, PlaybackProgress, secondsToTicks } from '../JellyfinClient';
import { PlayMethod } from './resolvePlayback';

/**
 * Reports playback state to the server.
 *
 * This is what makes resume, watched state and Continue Watching work, and it
 * has to be server-side: five sticks sharing one server should agree on where
 * a film was paused, which local storage cannot deliver.
 *
 * Reporting must never break playback. Every call swallows its failure — a
 * dropped progress report costs a few seconds of resume accuracy, whereas an
 * exception raised into the player loses the frame.
 */

/** Jellyfin's own clients report every ten seconds. */
const DEFAULT_PROGRESS_INTERVAL_MS = 10000;

export interface PlaybackSessionDescriptor {
  itemId: string;
  playSessionId?: string;
  mediaSourceId?: string;
  playMethod?: PlayMethod;
}

export interface PlaybackReporterOptions {
  progressIntervalMs?: number;
  /** Injected in tests. */
  now?: () => number;
}

export interface PlaybackState {
  positionSeconds: number;
  isPaused?: boolean;
  isMuted?: boolean;
}

export class PlaybackReporter {
  private readonly client: JellyfinClient;
  private readonly descriptor: PlaybackSessionDescriptor;
  private readonly progressIntervalMs: number;
  private readonly now: () => number;

  private lastReportedAt = 0;
  private lastPaused = false;
  private started = false;
  private stopped = false;

  constructor(
    client: JellyfinClient,
    descriptor: PlaybackSessionDescriptor,
    options: PlaybackReporterOptions = {},
  ) {
    this.client = client;
    this.descriptor = descriptor;
    this.progressIntervalMs =
      options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Tells the server this device has started playing. Sent once. */
  async start(state: PlaybackState): Promise<void> {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.lastReportedAt = this.now();
    this.lastPaused = state.isPaused ?? false;
    await this.send('start', (progress) =>
      this.client.reportPlaybackStart(progress),
      state,
    );
  }

  /**
   * Reports progress, at most once per interval.
   *
   * A pause or resume is sent immediately regardless: the server uses it to
   * decide whether this session is still watching, and a ten-second delay is
   * long enough for a remote-control pause to look like a stall.
   */
  async progress(state: PlaybackState): Promise<void> {
    if (!this.started || this.stopped) {
      return;
    }

    const paused = state.isPaused ?? false;
    const pauseChanged = paused !== this.lastPaused;
    const due = this.now() - this.lastReportedAt >= this.progressIntervalMs;

    if (!pauseChanged && !due) {
      return;
    }

    this.lastPaused = paused;
    this.lastReportedAt = this.now();
    await this.send('progress', (progress) =>
      this.client.reportPlaybackProgress(progress),
      state,
    );
  }

  /**
   * Tells the server playback ended, and where. This is the report that sets
   * the resume point, so it is the one that matters most.
   */
  async stop(state: PlaybackState): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    if (!this.started) {
      return;
    }
    await this.send('stopped', (progress) =>
      this.client.reportPlaybackStopped(progress),
      state,
    );
  }

  private async send(
    label: string,
    call: (progress: PlaybackProgress) => Promise<void>,
    state: PlaybackState,
  ): Promise<void> {
    try {
      await call({
        itemId: this.descriptor.itemId,
        playSessionId: this.descriptor.playSessionId,
        mediaSourceId: this.descriptor.mediaSourceId,
        playMethod: this.descriptor.playMethod,
        positionTicks: secondsToTicks(Math.max(0, state.positionSeconds)),
        isPaused: state.isPaused ?? false,
        isMuted: state.isMuted ?? false,
      });
    } catch (error) {
      // console.error is the level that reaches the Vega device log.
      console.error(
        `[jellyfin] playback ${label} report failed: ${(error as Error).message}`,
      );
    }
  }
}
