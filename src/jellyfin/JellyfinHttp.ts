import {
  AUTHORIZATION_HEADER,
  buildAuthorizationHeader,
  ClientInfo,
  DeviceInfo,
} from './authorization';
import {
  JellyfinApiError,
  JellyfinNetworkError,
  JellyfinTimeoutError,
} from './errors';

/**
 * The transport underneath the Jellyfin client.
 *
 * Deliberately plain `fetch`: Jellyfin's official TypeScript SDK is ESM-only
 * and needs axios, and Metro bundles ~134 KB of it before a single endpoint is
 * called. The SDK's generated *types* are used (see JellyfinClient) because
 * type imports are erased at build time and cost nothing at runtime.
 *
 * `fetchImpl` and `now` are injected so tests never touch globals.
 */

const DEFAULT_TIMEOUT_MS = 10000;
/** Error bodies are logged; a runaway HTML page is not worth keeping. */
const MAX_ERROR_BODY_LENGTH = 512;

export interface JellyfinHttpOptions {
  /** Base URL of the server, with or without a trailing slash. */
  serverUrl: string;
  clientInfo: ClientInfo;
  deviceInfo: DeviceInfo;
  /** Omitted until the user has signed in. */
  accessToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  /** Serialised as JSON. */
  body?: unknown;
  /** Undefined and null values are dropped rather than sent as "undefined". */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Overrides the instance timeout for one call. */
  timeoutMs?: number;
}

export class JellyfinHttp {
  readonly serverUrl: string;
  readonly clientInfo: ClientInfo;
  readonly deviceInfo: DeviceInfo;

  private accessToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JellyfinHttpOptions) {
    this.serverUrl = options.serverUrl.trim().replace(/\/+$/, '');
    this.clientInfo = options.clientInfo;
    this.deviceInfo = options.deviceInfo;
    this.accessToken = options.accessToken ?? '';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** True once an access token has been supplied. */
  get isAuthenticated(): boolean {
    return this.accessToken.length > 0;
  }

  /**
   * Called after Quick Connect completes, and with '' on sign-out. Kept
   * mutable so a single client instance survives sign-in without every holder
   * needing to swap it.
   */
  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  /** Absolute URL for a server-relative path — for image and stream URLs. */
  buildUrl(
    path: string,
    query?: RequestOptions['query'],
  ): string {
    const normalisedPath = path.startsWith('/') ? path : `/${path}`;
    const search = buildQueryString(query);
    return `${this.serverUrl}${normalisedPath}${search}`;
  }

  /**
   * Performs a request and parses the JSON response.
   *
   * @throws {JellyfinTimeoutError} the request exceeded the timeout
   * @throws {JellyfinNetworkError} no response at all
   * @throws {JellyfinApiError} a non-2xx response
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    // AbortController rather than Promise.race: racing leaves the request in
    // flight, and on a device that means a dead socket per timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: this.buildHeaders(options.body !== undefined),
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new JellyfinTimeoutError(url, timeoutMs);
      }
      throw new JellyfinNetworkError(url, error);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new JellyfinApiError(
        url,
        response.status,
        response.statusText,
        await readErrorBody(response),
      );
    }

    // 204 on the playback reporting endpoints, and Jellyfin sometimes answers
    // 200 with an empty body; JSON.parse('') would throw.
    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  private buildHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      [AUTHORIZATION_HEADER]: buildAuthorizationHeader(
        this.clientInfo,
        this.deviceInfo,
        this.accessToken,
      ),
      Accept: 'application/json',
    };
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }
    return headers;
  }
}

const buildQueryString = (query: RequestOptions['query']): string => {
  if (!query) {
    return '';
  }
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
};

const readErrorBody = async (response: Response): Promise<string> => {
  try {
    const body = await response.text();
    return body.slice(0, MAX_ERROR_BODY_LENGTH);
  } catch {
    // A body that cannot be read must not mask the status code.
    return '';
  }
};
