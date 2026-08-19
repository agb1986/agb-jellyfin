/**
 * Failure modes callers actually need to tell apart.
 *
 * On a TV client these lead to different screens: a network failure is "check
 * the server is on", a 401 sends the user back through Quick Connect, and a
 * 5xx is the server's problem. Collapsing them into one Error type means the
 * UI cannot make that distinction.
 */

/** The request never produced an HTTP response (DNS, refused, TLS, timeout). */
export class JellyfinNetworkError extends Error {
  readonly url: string;
  readonly cause?: unknown;

  constructor(url: string, cause?: unknown) {
    super(`Could not reach the Jellyfin server at ${url}`);
    this.name = 'JellyfinNetworkError';
    this.url = url;
    this.cause = cause;
  }
}

/** The request took longer than the configured timeout. */
export class JellyfinTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Jellyfin request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'JellyfinTimeoutError';
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/** The server answered with a non-2xx status. */
export class JellyfinApiError extends Error {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  /** Response body, truncated. Jellyfin returns plain text for most errors. */
  readonly body: string;

  constructor(url: string, status: number, statusText: string, body: string) {
    super(`Jellyfin request to ${url} failed: ${status} ${statusText}`);
    this.name = 'JellyfinApiError';
    this.url = url;
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }

  /** The stored access token is no longer valid — re-run Quick Connect. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}
