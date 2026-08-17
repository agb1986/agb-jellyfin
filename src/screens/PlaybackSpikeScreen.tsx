/**
 * Playback spike harness.
 *
 * Lists the container/codec combinations a Jellyfin server can emit and hands
 * each one to the existing PlayerScreen. The point is to find out which ones
 * Vega can actually decode before any Jellyfin code is written, so the Phase 3
 * DeviceProfile is based on measurement rather than guesswork.
 *
 * See src/spike/spikeStreams.ts for what each entry proves and why.
 *
 * This screen is development scaffolding. It is reachable only while
 * isPlaybackSpikeEnabled() is true, and should be deleted once the results are
 * recorded in docs/.
 */
import { useReportFullyDrawn } from '@amazon-devices/kepler-performance-api';
import { useHideSplashScreenCallback } from '@amazon-devices/react-native-kepler';
import React, { useCallback, useEffect } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppStackScreenProps, Screens } from '../components/navigation/types';
import { SPIKE_STREAMS, SpikeStream } from '../spike/spikeStreams';
import { COLORS } from '../styles/Colors';
import { scaleUxToDp } from '../utils/pixelUtils';

const PlaybackSpikeScreen = ({
  navigation,
}: AppStackScreenProps<Screens.PLAYBACK_SPIKE_SCREEN>) => {
  // App.tsx calls preventHideSplashScreen() on TV and never hides it again in a
  // release build; in the sample only MovieGrid on the home screen does that.
  // Because the spike screen replaces the home screen as the initial route, it
  // has to hide the splash itself — otherwise the splash stays up, the app is
  // judged unresponsive, and lcm_service kills it with AppNotResponding after
  // roughly fifteen seconds.
  const hideSplashScreen = useHideSplashScreenCallback();
  const reportFullyDrawn = useReportFullyDrawn();

  useEffect(() => {
    hideSplashScreen();
    reportFullyDrawn();
  }, [hideSplashScreen, reportFullyDrawn]);

  const play = useCallback(
    (stream: SpikeStream) => {
      // The URI is logged so a failed attempt can be correlated with the
      // VideoHandler.onError output in the device log.
      console.info(
        `[PlaybackSpikeScreen] - playing ${stream.id}: vcodec=${stream.vcodec} acodec=${stream.acodec} uri=${stream.uri}`,
      );
      navigation.navigate(Screens.PLAYER_SCREEN, {
        data: stream,
        focusId: stream.id,
      });
    },
    [navigation],
  );

  return (
    <View style={styles.container} testID="playback-spike-screen">
      <Text style={styles.title}>Playback spike</Text>
      <Text style={styles.subtitle}>
        Each row forces one video/audio codec pair. Play it, then check the
        device log for [VideoHandler.ts] - Streaming Error.
      </Text>
      <ScrollView contentContainerStyle={styles.list}>
        {SPIKE_STREAMS.map((stream, index) => (
          <TouchableOpacity
            key={stream.id}
            style={styles.row}
            hasTVPreferredFocus={index === 0}
            onPress={() => play(stream)}
            testID={`spike-stream-${stream.id}`}>
            <Text style={styles.rowTitle}>{stream.title}</Text>
            <Text style={styles.rowCodecs}>
              {`${stream.format} · video ${stream.vcodec} · audio ${stream.acodec}`}
            </Text>
            <Text style={styles.rowRationale}>{stream.rationale}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

export default PlaybackSpikeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BLACK,
    paddingHorizontal: scaleUxToDp(60),
    paddingTop: scaleUxToDp(40),
  },
  title: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(40),
    fontWeight: 'bold',
  },
  subtitle: {
    color: COLORS.PALE_GRAY,
    fontSize: scaleUxToDp(20),
    marginTop: scaleUxToDp(8),
    marginBottom: scaleUxToDp(20),
  },
  list: {
    paddingBottom: scaleUxToDp(40),
  },
  row: {
    backgroundColor: COLORS.DARK_GRAY,
    borderRadius: scaleUxToDp(8),
    borderWidth: scaleUxToDp(2),
    borderColor: COLORS.CHARCOAL_GRAY,
    paddingVertical: scaleUxToDp(14),
    paddingHorizontal: scaleUxToDp(20),
    marginBottom: scaleUxToDp(12),
  },
  rowTitle: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(26),
    fontWeight: 'bold',
  },
  rowCodecs: {
    color: COLORS.ORANGE,
    fontSize: scaleUxToDp(18),
    marginTop: scaleUxToDp(4),
  },
  rowRationale: {
    color: COLORS.PALE_GRAY,
    fontSize: scaleUxToDp(18),
    marginTop: scaleUxToDp(6),
  },
});
