/**
 * Playback spike autorun.
 *
 * The Vega CLI has no way to inject D-pad input into a device, so a list you
 * have to select from by hand cannot produce results in an automated run. This
 * screen instead walks every entry in SPIKE_STREAMS by itself: it loads each
 * one through the same VideoHandler / Shaka path the real player uses, waits
 * for playback to actually advance, records a verdict, and moves on. The
 * summary is printed to the device log behind a fixed marker so it can be
 * grepped straight out of `vega device start-log-stream`.
 *
 * Two things this harness learned the hard way, both of which silently produce
 * believable-but-wrong results:
 *
 * 1. Each stream gets its own <SpikeStreamProbe key={id}>. VideoHandler builds
 *    preBufferVideo/loadVideoElements/loadAdaptiveMediaPlayer with
 *    `useCallback(..., [])` inside its constructor, so a handler constructed on
 *    a later render still calls the *first* instance's methods, bound to the
 *    first instance's data. Reusing one handler across streams replays stream
 *    one eight times and reports eight passes. Remounting resets those caches.
 *
 * 2. A pass is only claimed after reading back the variant Shaka actually
 *    chose. preferredVideoCodecs/preferredAudioCodecs are preferences, not
 *    constraints — an unsupported codec falls back to another variant and plays
 *    happily, which would report an AC-3 pass that was really AAC.
 *
 * A stream counts as PASS only when currentTime advances past PROGRESS_TARGET.
 * Reaching 'loadedmetadata' is not enough: Shaka can parse a manifest for a
 * codec the device cannot decode, and that is the case this spike exists to
 * catch.
 *
 * Development scaffolding; delete along with src/spike once the results are
 * recorded in docs/.
 */
import { useReportFullyDrawn } from '@amazon-devices/kepler-performance-api';
import { useHideSplashScreenCallback } from '@amazon-devices/react-native-kepler';
import {
  KeplerVideoSurfaceView,
  VideoPlayer,
} from '@amazon-devices/react-native-w3cmedia';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppStackScreenProps, Screens } from '../components/navigation/types';
import { SPIKE_STREAMS, SpikeStream } from '../spike/spikeStreams';
import { COLORS } from '../styles/Colors';
import { scaleUxToDp } from '../utils/pixelUtils';
import { VideoHandler } from '../utils/VideoHandler';
import { ShakaPlayer } from '../w3cmedia/shakaplayer/ShakaPlayer';

/** Marker to grep for in the device log. */
const TAG = 'SPIKE_RESULT';

/** Seconds of playback that must elapse before a stream is called a pass. */
const PROGRESS_TARGET = 1.5;

/** How long a single stream gets before it is written off as a failure. */
const PER_STREAM_TIMEOUT_MS = 45000;

/** How often playback progress is sampled. */
const POLL_INTERVAL_MS = 500;

type Verdict = 'PASS' | 'FAIL' | 'TIMEOUT' | 'MISMATCH';

/**
 * Codec strings probed against MediaSource before any stream is loaded.
 *
 * Shaka silently drops variants whose codecs the platform will not admit, so a
 * missing AC-3 variant is indistinguishable from a manifest that never had one.
 * Asking MediaSource directly separates "the device refuses this codec" from
 * "this test stream did not offer it", and the answer is exactly the input the
 * Phase 3 Jellyfin DeviceProfile needs.
 */
const CAPABILITY_PROBES = [
  'video/mp4; codecs="avc1.640028"',
  'video/mp4; codecs="hvc1.2.4.L123.B0"',
  'video/mp4; codecs="hev1.2.4.L123.B0"',
  'audio/mp4; codecs="mp4a.40.2"',
  'audio/mp4; codecs="ac-3"',
  'audio/mp4; codecs="ec-3"',
  'audio/mp4; codecs="flac"',
  'audio/mp4; codecs="opus"',
];

/** Logs what the platform admits, once, before the run starts. */
const logCapabilities = (): void => {
  const mediaSource = (global as any).MediaSource;
  if (!mediaSource?.isTypeSupported) {
    console.warn(`${TAG} CAPABILITY MediaSource.isTypeSupported unavailable`);
    return;
  }
  CAPABILITY_PROBES.forEach((type) => {
    let supported: string;
    try {
      supported = String(mediaSource.isTypeSupported(type));
    } catch (e) {
      supported = `threw ${e}`;
    }
    console.warn(`${TAG} CAPABILITY ${supported} ${type}`);
  });
};

interface Result {
  id: string;
  verdict: Verdict;
  detail: string;
}

interface ProbeProps {
  stream: SpikeStream;
  onResult: (result: Result) => void;
}

/**
 * Plays exactly one stream and reports a single verdict, then stops touching
 * the player. Mounted with key={stream.id} so every stream gets a clean
 * VideoHandler, a clean Shaka instance and a clean media element.
 */
const SpikeStreamProbe = ({ stream, onResult }: ProbeProps) => {
  const videoRef = useRef<VideoPlayer | null>(null);
  const player = useRef<ShakaPlayer | null>(null);
  const settled = useRef<boolean>(false);
  const variantForced = useRef<boolean>(false);
  const [isVideoInitialized, setIsVideoInitialized] = useState<boolean>(false);

  const noop = useCallback(() => {}, []);

  /** What Shaka actually chose to decode; see note 2 in the file header. */
  const describeActiveVariant = (): string => {
    try {
      const shakaPlayer = (player.current as any)?.player;
      if (!shakaPlayer) {
        // MP4 goes through the static player; there is no Shaka variant list.
        return 'static media path, no Shaka variant';
      }
      const tracks = shakaPlayer.getVariantTracks?.() ?? [];
      const active = tracks.find((t: any) => t.active);
      if (!active) {
        return `no active variant among ${tracks.length}`;
      }
      return `active video=${active.videoCodec} audio=${active.audioCodec} ${active.width}x${active.height} @${active.bandwidth}`;
    } catch (e) {
      return `could not read active variant: ${e}`;
    }
  };

  /**
   * Pin playback to a variant that actually uses the codecs this row is meant
   * to test.
   *
   * The first working run showed every AC-3 and E-AC-3 row playing
   * `mp4a.40.2`: ShakaPlayer.load() only sets preferredAudioCodecs /
   * preferredVideoCodecs, and with ABR disabled Shaka is free to ignore them
   * and keep the first variant. That produces a green result for a codec that
   * was never exercised. Selecting the variant explicitly is what makes the
   * audio rows mean anything.
   */
  const forceRequestedVariant = (): void => {
    if (variantForced.current) {
      return;
    }
    const shakaPlayer = (player.current as any)?.player;
    const tracks = shakaPlayer?.getVariantTracks?.() ?? [];
    if (tracks.length === 0) {
      return;
    }
    variantForced.current = true;
    // The inventory is logged in full: which variants survived Shaka's own
    // codec filtering is the evidence behind every verdict below.
    console.warn(
      `${TAG} ${stream.id} variants=${tracks
        .map((t: any) => `${t.videoCodec}/${t.audioCodec}`)
        .join(',')}`,
    );
    const match = tracks.find(
      (t: any) =>
        (t.videoCodec ?? '').toLowerCase().startsWith(stream.vcodec ?? '') &&
        (t.audioCodec ?? '').toLowerCase().startsWith(stream.acodec ?? ''),
    );
    if (!match) {
      console.warn(
        `${TAG} ${stream.id} no variant offers ${stream.vcodec}/${stream.acodec} among ${tracks.length}`,
      );
      return;
    }
    try {
      shakaPlayer.selectVariantTrack(match, true);
      console.warn(
        `${TAG} ${stream.id} pinned variant video=${match.videoCodec} audio=${match.audioCodec}`,
      );
    } catch (e) {
      console.error(`${TAG} ${stream.id} selectVariantTrack failed: ${e}`);
    }
  };

  /** True when the variant being decoded is the one this row asked for. */
  const codecsHonored = (): boolean => {
    const shakaPlayer = (player.current as any)?.player;
    if (!shakaPlayer) {
      // Static MP4 path: there is one stream and no choice to get wrong.
      return true;
    }
    const active = (shakaPlayer.getVariantTracks?.() ?? []).find(
      (t: any) => t.active,
    );
    if (!active) {
      return false;
    }
    return (
      (active.videoCodec ?? '').toLowerCase().startsWith(stream.vcodec ?? '') &&
      (active.audioCodec ?? '').toLowerCase().startsWith(stream.acodec ?? '')
    );
  };

  const settle = (verdict: Verdict, detail: string) => {
    if (settled.current) {
      return;
    }
    settled.current = true;
    console.warn(
      `${TAG} ${stream.id} ${verdict} format=${stream.format} want-vcodec=${stream.vcodec} want-acodec=${stream.acodec} detail=${detail}`,
    );
    onResult({ id: stream.id, verdict, detail });
  };

  // VideoHandler is constructed during render exactly as PlayerScreen does it:
  // the class calls useCallback in its constructor, so the hook order has to
  // stay stable across this component's renders.
  const handler = new VideoHandler(
    videoRef,
    player,
    stream,
    setIsVideoInitialized as any,
    noop as any,
    // The only VideoHandler signal used for scoring. VideoHandler.onError has
    // already logged the decisive category and details line by this point.
    ((isError: boolean) => {
      if (isError) {
        settle('FAIL', `player error; ${describeActiveVariant()}`);
      }
    }) as any,
    noop as any,
    noop as any,
  );

  useEffect(() => {
    console.warn(
      `${TAG} START ${stream.id} uri=${stream.uri} want-vcodec=${stream.vcodec} want-acodec=${stream.acodec}`,
    );
    // componentInstance is deliberately not passed. Handing it in makes
    // VideoHandler await setMediaControlFocus, and on the virtual device that
    // await never settles — the run stops at the "KMC : set Media Control
    // Focus" log line and initialize() is never reached. Media Controls are not
    // what this spike measures, so the dependency is dropped.
    handler.preBufferVideo();

    const startedAt = Date.now();
    const poll = setInterval(() => {
      forceRequestedVariant();
      const current = videoRef.current?.currentTime ?? 0;
      // Progress alone is not a pass: playback has to have progressed *while
      // decoding the codecs this row asked for*. Waiting for both avoids
      // crediting the codec with a pass earned by the fallback variant during
      // the moments before selectVariantTrack takes effect.
      if (current >= PROGRESS_TARGET && codecsHonored()) {
        settle(
          'PASS',
          `currentTime reached ${current.toFixed(2)}s; ${describeActiveVariant()}`,
        );
      } else if (Date.now() - startedAt > PER_STREAM_TIMEOUT_MS) {
        // Playing fine but on the wrong codec is a different finding from not
        // playing at all: it means the requested codec was never on offer.
        if (current >= PROGRESS_TARGET) {
          settle(
            'MISMATCH',
            `played on a fallback variant; ${stream.vcodec}/${stream.acodec} ` +
              `was never selectable; ${describeActiveVariant()}`,
          );
        } else {
          settle(
            'TIMEOUT',
            `no playback progress in ${PER_STREAM_TIMEOUT_MS / 1000}s ` +
              `(currentTime=${current.toFixed(2)}s); ${describeActiveVariant()}`,
          );
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(poll);
      try {
        videoRef.current?.clearSurfaceHandle('');
        handler.destroyVideoElements();
        videoRef.current = null;
      } catch (e) {
        console.error(`${TAG} teardown failed for ${stream.id}: ${e}`);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSurfaceViewCreated = useCallback((handle: string) => {
    videoRef.current?.setSurfaceHandle(handle);
    videoRef.current?.play();
  }, []);

  const onSurfaceViewDestroyed = useCallback((handle: string) => {
    videoRef.current?.clearSurfaceHandle(handle);
  }, []);

  // Mirrors PlayerScreen: the surface is only mounted once the player reports
  // 'loadedmetadata'. Mounting it earlier hands back a surface handle while
  // videoRef is still null and the handle is silently dropped.
  if (!isVideoInitialized) {
    return null;
  }

  return (
    <KeplerVideoSurfaceView
      style={styles.surface}
      onSurfaceViewCreated={onSurfaceViewCreated}
      onSurfaceViewDestroyed={onSurfaceViewDestroyed}
      testID="spike-surface"
    />
  );
};

const PlaybackSpikeRunnerScreen = (
  _props: AppStackScreenProps<Screens.PLAYBACK_SPIKE_RUNNER_SCREEN>,
) => {
  const hideSplashScreen = useHideSplashScreenCallback();
  const reportFullyDrawn = useReportFullyDrawn();

  const [index, setIndex] = useState<number>(0);
  const [results, setResults] = useState<Result[]>([]);

  const stream = index < SPIKE_STREAMS.length ? SPIKE_STREAMS[index] : null;
  const done = stream === null;

  useEffect(() => {
    hideSplashScreen();
    reportFullyDrawn();
    logCapabilities();
  }, [hideSplashScreen, reportFullyDrawn]);

  const onResult = useCallback((result: Result) => {
    setResults((prev) => {
      // Logged after the first stream settles rather than at mount or at the
      // end: the device log stream drops an app's first seconds of output, and
      // a run can crash before the summary is reached.
      if (prev.length === 0) {
        logCapabilities();
      }
      return [...prev, result];
    });
    setIndex((prev) => prev + 1);
  }, []);

  // Print the whole matrix once, so a single grep gets the full answer.
  useEffect(() => {
    if (!done) {
      return;
    }
    // Logged here rather than only at mount: the device log stream does not
    // deliver the first couple of seconds of an app's output, so anything
    // printed during startup is lost.
    logCapabilities();
    console.warn(`${TAG} SUMMARY BEGIN`);
    results.forEach((r) => {
      console.warn(
        `${TAG} SUMMARY ${r.verdict.padEnd(7)} ${r.id} — ${r.detail}`,
      );
    });
    console.warn(`${TAG} SUMMARY END`);
  }, [done, results]);

  return (
    <View style={styles.container} testID="playback-spike-runner">
      {stream && (
        <SpikeStreamProbe
          key={stream.id}
          stream={stream}
          onResult={onResult}
        />
      )}
      <View style={styles.overlay}>
        <Text style={styles.title}>
          {done
            ? `Spike complete — ${results.length}/${SPIKE_STREAMS.length} streams`
            : `Testing ${index + 1}/${SPIKE_STREAMS.length}: ${stream!.title}`}
        </Text>
        {results.map((r) => (
          <Text
            key={r.id}
            style={[
              styles.result,
              r.verdict === 'PASS' ? styles.pass : styles.fail,
            ]}>
            {`${r.verdict}  ${r.id}`}
          </Text>
        ))}
      </View>
    </View>
  );
};

export default PlaybackSpikeRunnerScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.BLACK },
  surface: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  overlay: {
    zIndex: 1,
    paddingHorizontal: scaleUxToDp(50),
    paddingTop: scaleUxToDp(40),
  },
  title: { color: COLORS.WHITE, fontSize: scaleUxToDp(28), fontWeight: 'bold' },
  result: { fontSize: scaleUxToDp(20), marginTop: scaleUxToDp(4) },
  pass: { color: COLORS.LIME_GREEN },
  fail: { color: COLORS.STRONG_RED },
});
