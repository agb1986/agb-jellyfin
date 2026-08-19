import { KeyValueStore } from './KeyValueStore';

/**
 * What a signed-in session needs to survive a restart.
 *
 * The server URL travels with the token deliberately: a token is only valid
 * against the server that issued it, so storing them apart invites a state
 * where the app points at one server holding another's credentials.
 */
export interface JellyfinCredentials {
  serverUrl: string;
  accessToken: string;
  userId: string;
  /** For display — "signed in as ..." — not used for any request. */
  userName?: string;
  /** Server name at sign-in time, for the same reason. */
  serverName?: string;
}

export const CREDENTIALS_KEY = 'jellyfin.credentials';

const isCredentials = (value: unknown): value is JellyfinCredentials => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<JellyfinCredentials>;
  return (
    typeof candidate.serverUrl === 'string' &&
    candidate.serverUrl.length > 0 &&
    typeof candidate.accessToken === 'string' &&
    candidate.accessToken.length > 0 &&
    typeof candidate.userId === 'string' &&
    candidate.userId.length > 0
  );
};

/**
 * Reads stored credentials, or null if there are none.
 *
 * Anything unreadable or incomplete is treated as "not signed in" rather than
 * raised: a corrupt record should send the user through Quick Connect again,
 * not wedge the app on a screen it cannot leave with a D-pad.
 */
export const loadCredentials = async (
  store: KeyValueStore,
): Promise<JellyfinCredentials | null> => {
  try {
    const raw = await store.getItem(CREDENTIALS_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isCredentials(parsed) ? parsed : null;
  } catch {
    // Unreadable storage and unreadable contents mean the same thing to the
    // caller: sign in again.
    return null;
  }
};

/**
 * Persists a session. A storage failure is reported but not raised: the user
 * has just signed in successfully, and undoing that because the write failed
 * would be the wrong trade. The session lives until the app is closed.
 */
export const saveCredentials = async (
  store: KeyValueStore,
  credentials: JellyfinCredentials,
): Promise<void> => {
  try {
    await store.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
  } catch (error) {
    console.warn(
      `[jellyfin] signed in, but the session could not be saved and will not survive a restart: ${(error as Error).message}`,
    );
  }
};

/**
 * Forgets the local session. The token stays valid server-side until it is
 * revoked from the dashboard — this is sign-out on this device, not logout
 * everywhere.
 */
export const clearCredentials = async (store: KeyValueStore): Promise<void> => {
  try {
    await store.removeItem(CREDENTIALS_KEY);
  } catch (error) {
    console.warn(
      `[jellyfin] could not clear the stored session: ${(error as Error).message}`,
    );
  }
};
