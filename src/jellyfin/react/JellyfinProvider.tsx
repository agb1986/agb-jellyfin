import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ClientInfo } from '../authorization';
import { JellyfinNoServerError, JellyfinSession } from '../JellyfinSession';
import { KeyValueStore } from '../storage/KeyValueStore';

/**
 * Owns the one JellyfinSession the app shares.
 *
 * Bootstrapping is asynchronous — storage reads, then an optional token check —
 * so the screens need a state machine rather than a boolean. Every state below
 * corresponds to something the user has to be shown; there is no state that
 * renders nothing.
 */

export type JellyfinStatus =
  /** Reading storage. On a cold start this is the first frame. */
  | 'starting'
  /** No server address at all: nothing stored, and no .env default. */
  | 'no-server'
  /** Reachable or not, we have no valid credentials. Show Quick Connect. */
  | 'signed-out'
  | 'signed-in'
  /** Bootstrap failed for a reason that is not "signed out" — server down. */
  | 'unavailable';

export interface JellyfinContextValue {
  status: JellyfinStatus;
  session: JellyfinSession | null;
  /** Populated in the 'unavailable' state, for display. */
  error: Error | null;
  /** Re-runs the bootstrap. Used by the retry button. */
  reload: () => void;
  /** Called by the sign-in screen once Quick Connect succeeds. */
  onSignedIn: () => void;
  signOut: () => Promise<void>;
}

const JellyfinContext = createContext<JellyfinContextValue | null>(null);

export interface JellyfinProviderProps {
  store: KeyValueStore;
  clientInfo: ClientInfo;
  deviceName: string;
  /** Fallback address, used only when nothing is stored. */
  serverUrl?: string;
  fetchImpl?: typeof fetch;
  children: ReactNode;
}

export const JellyfinProvider = ({
  store,
  clientInfo,
  deviceName,
  serverUrl,
  fetchImpl,
  children,
}: JellyfinProviderProps) => {
  const [status, setStatus] = useState<JellyfinStatus>('starting');
  const [session, setSession] = useState<JellyfinSession | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  // Bootstrap is async and the screen can go away mid-flight; setting state
  // after that is a leak warning at best and a stale render at worst.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      setStatus('starting');
      setError(null);

      let created: JellyfinSession;
      try {
        created = await JellyfinSession.create({
          store,
          clientInfo,
          deviceName,
          serverUrl,
          fetchImpl,
        });
      } catch (creationError) {
        // Only a missing address is a configuration problem. Anything else —
        // storage misbehaving, say — must not be reported as "no server
        // configured", which sends whoever is debugging it to the wrong file.
        // On a device with no keyboard the log is the only diagnostic there
        // is, so it says which failure this was.
        // console.error: the level that reaches the Vega device log.
        console.error(
          `[jellyfin] session bootstrap failed: ${(creationError as Error).message}`,
        );
        if (!cancelled && mounted.current) {
          setError(creationError as Error);
          setStatus(
            creationError instanceof JellyfinNoServerError
              ? 'no-server'
              : 'unavailable',
          );
        }
        return;
      }

      if (cancelled || !mounted.current) {
        return;
      }
      // Printed once per bootstrap: on a headless device this is how anyone
      // finds out which server the build is actually pointing at.
      console.error(
        `[jellyfin] server=${created.client.http.serverUrl} device=${created.client.deviceInfo.id} storedSession=${created.isSignedIn}`,
      );
      setSession(created);

      try {
        const valid = await created.verify();
        if (!cancelled && mounted.current) {
          setStatus(valid ? 'signed-in' : 'signed-out');
        }
      } catch (verifyError) {
        console.error(
          `[jellyfin] could not verify the stored session: ${(verifyError as Error).message}`,
        );
        // verify() only throws when the server could not be reached; a
        // rejected token resolves false and has already been cleared. Keeping
        // the credentials and showing a retry beats silently demanding a new
        // sign-in because the server was rebooting.
        if (!cancelled && mounted.current) {
          setError(verifyError as Error);
          setStatus('unavailable');
        }
      }
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [store, clientInfo, deviceName, serverUrl, fetchImpl, reloadCount]);

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  const onSignedIn = useCallback(() => {
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    await session?.signOut();
    if (mounted.current) {
      setStatus('signed-out');
    }
  }, [session]);

  const value = useMemo<JellyfinContextValue>(
    () => ({ status, session, error, reload, onSignedIn, signOut }),
    [status, session, error, reload, onSignedIn, signOut],
  );

  return (
    <JellyfinContext.Provider value={value}>
      {children}
    </JellyfinContext.Provider>
  );
};

/**
 * The context, or null when there is no provider above.
 *
 * The player screen is shared with the sample's own content and can be
 * rendered outside the Jellyfin tree; asking for the session there is a
 * question, not a mistake.
 */
export const useOptionalJellyfin = (): JellyfinContextValue | null => {
  return useContext(JellyfinContext);
};

export const useJellyfin = (): JellyfinContextValue => {
  const value = useContext(JellyfinContext);
  if (!value) {
    throw new Error('useJellyfin must be used inside a JellyfinProvider');
  }
  return value;
};

/**
 * The session, for screens that only render once signed in. Throws rather than
 * returning null so a screen cannot quietly render an empty library.
 */
export const useJellyfinSession = (): JellyfinSession => {
  const { session } = useJellyfin();
  if (!session) {
    throw new Error('No Jellyfin session: this screen rendered before bootstrap finished');
  }
  return session;
};
