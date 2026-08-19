import { VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { MutableRefObject, useEffect, useRef } from 'react';
import { ticksToSeconds } from '../JellyfinClient';
import {
  PlaybackReporter,
  PlaybackSessionDescriptor,
} from '../playback/PlaybackReporter';
import { useOptionalJellyfin } from './JellyfinProvider';

/**
 * Drives PlaybackReporter from the player's video element.
 *
 * Polled rather than event-driven on purpose. The sample's VideoHandler owns
 * the media element's listeners and rebuilds them per instance; adding more
 * would mean reaching into it, and the spike showed how easily that goes
 * wrong. Reading `currentTime` and `paused` on a timer needs nothing from it,
 * and a report is only ever a few seconds stale.
 */

/** How often to look at the element. The reporter throttles what it sends. */
const POLL_INTERVAL_MS = 2000;

export interface JellyfinPlaybackReportingOptions {
  /** Absent when the player was opened with something other than a Jellyfin item. */
  descriptor?: PlaybackSessionDescriptor;
  /**
   * Resume point to seek to once, on first play. Left unset for HLS, where
   * Shaka has already opened the stream at the resume point — see
   * `PlaybackTarget.startAppliedAtLoad`. Writing `currentTime` on top of that
   * is what produced the start/stop loop.
   */
  startPositionTicks?: number;
  pollIntervalMs?: number;
}

export const useJellyfinPlaybackReporting = (
  videoRef: MutableRefObject<VideoPlayer | null>,
  options: JellyfinPlaybackReportingOptions,
): void => {
  // Optional: the player screen also serves the sample's own content, which
  // is rendered outside the Jellyfin tree and reports nowhere.
  const session = useOptionalJellyfin()?.session ?? null;
  const { descriptor, startPositionTicks, pollIntervalMs } = options;

  const reporterRef = useRef<PlaybackReporter | null>(null);
  const seekedRef = useRef(false);

  useEffect(() => {
    if (!session || !descriptor) {
      return;
    }

    const reporter = new PlaybackReporter(session.client, descriptor);
    reporterRef.current = reporter;
    seekedRef.current = false;

    const readState = () => {
      const video = videoRef.current;
      if (!video) {
        return null;
      }
      return {
        // Shaka's timeline spans the whole title even when the stream begins
        // partway in, so currentTime is already the position to report.
        positionSeconds: video.currentTime ?? 0,
        isPaused: video.paused === true,
      };
    };

    const tick = () => {
      const video = videoRef.current;
      const state = readState();
      if (!video || !state) {
        return;
      }

      // Nothing has been decoded yet; reporting a start here would set the
      // session playing before there is anything to play.
      if (video.readyState === undefined || video.readyState < 1) {
        return;
      }

      if (!seekedRef.current) {
        seekedRef.current = true;
        const resumeSeconds = startPositionTicks
          ? ticksToSeconds(startPositionTicks)
          : 0;
        // Only worth seeking for a real resume point — a second or two in is
        // the beginning as far as anyone watching is concerned.
        if (resumeSeconds > 5) {
          video.currentTime = resumeSeconds;
          state.positionSeconds = resumeSeconds;
        }
        reporter.start(state);
        return;
      }

      reporter.progress(state);
    };

    const timer = setInterval(tick, pollIntervalMs ?? POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      // The last position reported is the one that becomes the resume point,
      // so it has to be read before the player tears the element down.
      const state = readState();
      reporter.stop(state ?? { positionSeconds: 0 });
      reporterRef.current = null;
    };
  }, [session, descriptor, startPositionTicks, pollIntervalMs, videoRef]);
};
