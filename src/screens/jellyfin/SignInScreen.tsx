import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useJellyfin } from '../../jellyfin/react/JellyfinProvider';
import {
  QuickConnectCancelledError,
  QuickConnectTimeoutError,
} from '../../jellyfin/quickConnect';
import { COLORS } from '../../styles/Colors';
import { scaleUxToDp } from '../../utils/pixelUtils';

/**
 * Quick Connect sign-in.
 *
 * The TV shows a six-character code; the user approves it from a device that
 * has a keyboard. Nothing is typed here, which is the point — a password entry
 * grid driven by a D-pad is miserable, and the alternative (a shared API key
 * baked into the build) would ship the same credential to every stick.
 */

type Phase = 'idle' | 'requesting' | 'waiting' | 'error';

export interface SignInScreenProps {
  /**
   * How often to ask the server whether the code has been approved. Exposed
   * so tests do not have to wait out the five-second default, which would
   * otherwise outlive the test and leave a timer running.
   */
  pollIntervalMs?: number;
}

const SignInScreen = ({ pollIntervalMs }: SignInScreenProps = {}) => {
  const { session, onSignedIn } = useJellyfin();
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // The poll runs for minutes. If the screen goes away first the loop has to
  // stop, or it keeps hitting the server for a session nobody is watching.
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const startSignIn = useCallback(async () => {
    if (!session) {
      return;
    }

    setPhase('requesting');
    setMessage(null);
    setCode(null);

    try {
      const enabled = await session.client.isQuickConnectEnabled();
      if (!enabled) {
        setMessage(
          'Quick Connect is switched off on the server. Turn it on in Dashboard → General, then try again.',
        );
        setPhase('error');
        return;
      }

      const { code: quickConnectCode, secret } = await session.beginSignIn();
      if (cancelled.current) {
        return;
      }

      setCode(quickConnectCode);
      setPhase('waiting');

      await session.completeSignIn(secret, {
        isCancelled: () => cancelled.current,
        pollIntervalMs,
      });
      if (cancelled.current) {
        return;
      }

      onSignedIn();
    } catch (error) {
      if (cancelled.current || error instanceof QuickConnectCancelledError) {
        return;
      }
      // console.error rather than warn/info: on Vega this is the level that
      // reliably reaches `vega device start-log-stream`, and a TV with no
      // keyboard gives no other way to find out why sign-in failed.
      console.error(
        `[jellyfin] sign-in failed: ${(error as Error).name}: ${(error as Error).message}`,
      );
      setMessage(
        error instanceof QuickConnectTimeoutError
          ? 'That code expired before it was approved. Try again for a new one.'
          : `Sign-in failed: ${(error as Error).message}`,
      );
      setPhase('error');
    }
  }, [session, onSignedIn, pollIntervalMs]);

  // Fires once, as soon as a session exists — the provider may still have been
  // bootstrapping when this screen first rendered. Guarded rather than left to
  // the dependency array, because re-running would spend codes as fast as the
  // server issues them; asking again is the retry button's job.
  // Repeated rather than said once: the Vega log stream drops an app's first
  // seconds of output, which is exactly when sign-in starts, so a single line
  // is never seen. console.error is the level that arrives. This is how the
  // code being displayed can be read off a device with no visible screen.
  useEffect(() => {
    if (phase === 'idle') {
      return;
    }
    const report = () =>
      console.error(
        `[jellyfin] sign-in phase=${phase} code=${code ?? 'none'} message=${message ?? 'none'}`,
      );
    report();
    const timer = setInterval(report, 30000);
    return () => clearInterval(timer);
  }, [phase, code, message]);

  const started = useRef(false);
  useEffect(() => {
    if (!session || started.current) {
      return;
    }
    started.current = true;
    startSignIn();
  }, [session, startSignIn]);

  return (
    <View style={styles.container} testID="jellyfin-sign-in-screen">
      <Text style={styles.title}>Sign in to Jellyfin</Text>

      {phase === 'requesting' && (
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={COLORS.WHITE} />
          <Text style={styles.body}>Asking the server for a code…</Text>
        </View>
      )}

      {phase === 'waiting' && code && (
        <View style={styles.centred}>
          <Text style={styles.instruction}>
            On your phone or computer, open Jellyfin and go to
          </Text>
          <Text style={styles.instructionStrong}>
            Settings → Quick Connect
          </Text>
          <Text style={styles.instruction}>then enter this code:</Text>

          <Text style={styles.code} testID="jellyfin-quick-connect-code">
            {code}
          </Text>

          <ActivityIndicator color={COLORS.WHITE} />
          <Text style={styles.body}>Waiting for approval…</Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={styles.centred}>
          <Text style={styles.error} testID="jellyfin-sign-in-error">
            {message}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={startSignIn}
            hasTVPreferredFocus
            testID="jellyfin-sign-in-retry">
            <Text style={styles.buttonLabel}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BLACK,
    alignItems: 'center',
    justifyContent: 'center',
    padding: scaleUxToDp(60),
  },
  centred: {
    alignItems: 'center',
  },
  title: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(52),
    marginBottom: scaleUxToDp(40),
  },
  instruction: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(26),
    marginTop: scaleUxToDp(8),
  },
  instructionStrong: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(30),
    fontWeight: 'bold',
    marginTop: scaleUxToDp(8),
  },
  code: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(96),
    letterSpacing: scaleUxToDp(12),
    marginVertical: scaleUxToDp(40),
  },
  body: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(24),
    marginTop: scaleUxToDp(16),
  },
  error: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(26),
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

export default SignInScreen;
