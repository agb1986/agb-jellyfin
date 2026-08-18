import { useReportFullyDrawn } from '@amazon-devices/kepler-performance-api';
import { useHideSplashScreenCallback } from '@amazon-devices/react-native-kepler';
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useJellyfin } from '../jellyfin/react/JellyfinProvider';
import { COLORS } from '../styles/Colors';
import { scaleUxToDp } from '../utils/pixelUtils';
import LibraryScreen from './jellyfin/LibraryScreen';
import SignInScreen from './jellyfin/SignInScreen';

/**
 * The app's entry point once the Jellyfin client is switched on.
 *
 * A single route that renders whichever screen the session state calls for,
 * rather than navigating between routes. Bootstrap is asynchronous, and a
 * navigator whose initial route depends on an unresolved promise either
 * flashes the wrong screen or shows none — and showing none is fatal here,
 * because the splash has to come down within about fifteen seconds or
 * lcm_service kills the app.
 */
const JellyfinScreen = () => {
  // App.tsx calls preventHideSplashScreen() on TV and never hides it again in
  // a release build; in the sample only MovieGrid does. Any screen that
  // replaces the home screen as the initial route must hide it itself, or the
  // app is judged unresponsive and killed with AppNotResponding.
  const hideSplashScreen = useHideSplashScreenCallback();
  const reportFullyDrawn = useReportFullyDrawn();

  useEffect(() => {
    hideSplashScreen();
    reportFullyDrawn();
  }, [hideSplashScreen, reportFullyDrawn]);

  const { status, error, reload } = useJellyfin();

  // The only diagnostic channel this platform gives a TV app: console.error
  // is the level that reaches `vega device start-log-stream`, console.log is
  // stripped from release builds, and the stream drops an app's first seconds
  // of output — so anything that matters has to be said again later. One line
  // every thirty seconds is the price of being able to see anything at all.
  useEffect(() => {
    const report = () =>
      console.error(
        `[jellyfin] state=${status} error=${error ? error.message : 'none'}`,
      );
    report();
    const timer = setInterval(report, 30000);
    return () => clearInterval(timer);
  }, [status, error]);

  switch (status) {
    case 'signed-in':
      return <LibraryScreen />;

    case 'signed-out':
      return <SignInScreen />;

    case 'no-server':
      return (
        <Message
          testID="jellyfin-no-server"
          title="No Jellyfin server configured"
          detail={
            'Set JELLYFIN_SERVER_URL in .env and rebuild, or add a server from the setup screen once it exists.'
          }
        />
      );

    case 'unavailable':
      return (
        <Message
          testID="jellyfin-unavailable"
          title="Cannot reach the Jellyfin server"
          detail={error?.message ?? ''}
          onRetry={reload}
        />
      );

    case 'starting':
    default:
      return (
        <View style={styles.container} testID="jellyfin-starting">
          <ActivityIndicator size="large" color={COLORS.WHITE} />
        </View>
      );
  }
};

interface MessageProps {
  title: string;
  detail: string;
  testID: string;
  onRetry?: () => void;
}

const Message = ({ title, detail, testID, onRetry }: MessageProps) => (
  <View style={styles.container} testID={testID}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.detail}>{detail}</Text>
    {onRetry && (
      <TouchableOpacity
        style={styles.button}
        onPress={onRetry}
        hasTVPreferredFocus
        testID={`${testID}-retry`}>
        <Text style={styles.buttonLabel}>Try again</Text>
      </TouchableOpacity>
    )}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BLACK,
    alignItems: 'center',
    justifyContent: 'center',
    padding: scaleUxToDp(60),
  },
  title: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(40),
    marginBottom: scaleUxToDp(20),
    textAlign: 'center',
  },
  detail: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(24),
    textAlign: 'center',
    marginBottom: scaleUxToDp(32),
  },
  button: {
    backgroundColor: COLORS.KASHMIR_BLUE,
    paddingVertical: scaleUxToDp(16),
    paddingHorizontal: scaleUxToDp(48),
    borderRadius: scaleUxToDp(8),
  },
  buttonLabel: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(28),
  },
});

export default JellyfinScreen;
