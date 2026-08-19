import type {
  AuthenticationResult,
  QuickConnectResult,
} from '@jellyfin/sdk/lib/generated-client/models';
import { JellyfinApiError } from './errors';
import { JellyfinHttp } from './JellyfinHttp';

/**
 * Quick Connect: Jellyfin's device-code sign-in.
 *
 * The TV shows a six-character code; the user approves it from an already
 * signed-in Jellyfin web or mobile session; the server then hands this device
 * its own access token. No password is ever typed on a D-pad, and no shared
 * API key ends up inside the .vpkg — which is the whole reason this project
 * does not embed one.
 *
 * The token that comes back is per-device and revocable from the Jellyfin
 * dashboard.
 */

/** How long to wait between polls. Jellyfin's own web client uses 5s. */
const DEFAULT_POLL_INTERVAL_MS = 5000;
/** Server-side requests expire; stop well before the user gives up anyway. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface QuickConnectInitiation {
  /** Show this to the user. */
  code: string;
  /** Opaque; identifies the request when polling. Not shown to the user. */
  secret: string;
}

export const isQuickConnectEnabled = async (
  http: JellyfinHttp,
): Promise<boolean> => {
  return http.request<boolean>('/QuickConnect/Enabled');
};

/**
 * Starts a request and returns the code to display.
 *
 * The server ties the request to the Device/DeviceId in the authorization
 * header, so the same JellyfinHttp instance must be used for the poll and the
 * final exchange.
 */
export const initiateQuickConnect = async (
  http: JellyfinHttp,
): Promise<QuickConnectInitiation> => {
  const result = await http.request<QuickConnectResult>(
    '/QuickConnect/Initiate',
    { method: 'POST' },
  );
  if (!result?.Code || !result?.Secret) {
    throw new Error(
      'Quick Connect initiation returned no code — is Quick Connect enabled on the server?',
    );
  }
  return { code: result.Code, secret: result.Secret };
};

/** One poll. True once the user has approved the code. */
export const isQuickConnectAuthorized = async (
  http: JellyfinHttp,
  secret: string,
): Promise<boolean> => {
  const result = await http.request<QuickConnectResult>(
    '/QuickConnect/Connect',
    { query: { secret } },
  );
  return result?.Authenticated === true;
};

/** Exchanges an approved secret for this device's access token. */
export const authenticateWithQuickConnect = async (
  http: JellyfinHttp,
  secret: string,
): Promise<AuthenticationResult> => {
  return http.request<AuthenticationResult>(
    '/Users/AuthenticateWithQuickConnect',
    { method: 'POST', body: { Secret: secret } },
  );
};

export interface WaitForQuickConnectOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Injected in tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests; defaults to Date.now. */
  now?: () => number;
  /** Lets a caller abandon the wait when the user leaves the screen. */
  isCancelled?: () => boolean;
}

export class QuickConnectTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Quick Connect was not approved within ${timeoutMs}ms`);
    this.name = 'QuickConnectTimeoutError';
  }
}

export class QuickConnectCancelledError extends Error {
  constructor() {
    super('Quick Connect was cancelled');
    this.name = 'QuickConnectCancelledError';
  }
}

/**
 * Polls until the user approves the code, then returns the access token.
 *
 * A 404 while polling means the server dropped the request — it expired, or an
 * admin denied it. That is a normal outcome, not a transport failure, so it
 * ends the wait rather than being retried.
 *
 * @throws {QuickConnectTimeoutError} nobody approved it in time
 * @throws {QuickConnectCancelledError} isCancelled() went true
 */
export const waitForQuickConnect = async (
  http: JellyfinHttp,
  secret: string,
  options: WaitForQuickConnectOptions = {},
): Promise<AuthenticationResult> => {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const deadline = now() + timeoutMs;

  for (;;) {
    if (options.isCancelled?.()) {
      throw new QuickConnectCancelledError();
    }

    let authorized: boolean;
    try {
      authorized = await isQuickConnectAuthorized(http, secret);
    } catch (error) {
      if (error instanceof JellyfinApiError && error.status === 404) {
        throw new QuickConnectTimeoutError(timeoutMs);
      }
      throw error;
    }

    if (authorized) {
      return authenticateWithQuickConnect(http, secret);
    }

    if (now() >= deadline) {
      throw new QuickConnectTimeoutError(timeoutMs);
    }

    await sleep(pollIntervalMs);
  }
};
