import {
  JellyfinApiError,
  JellyfinNetworkError,
  JellyfinTimeoutError,
} from '../../src/jellyfin/errors';
import { JellyfinHttp } from '../../src/jellyfin/JellyfinHttp';

const clientInfo = { name: 'Jellyfin Vega', version: '0.1.0' };
const deviceInfo = { name: 'Living Room', id: 'device-abc' };

/** Minimal stand-in for the parts of Response the client touches. */
const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }) as Response;

const textResponse = (body: string, status: number): Response =>
  ({
    ok: false,
    status,
    statusText: 'Unauthorized',
    text: async () => body,
  }) as Response;

const makeHttp = (fetchImpl: jest.Mock, accessToken = '') =>
  new JellyfinHttp({
    serverUrl: 'http://jellyfin.local:8096',
    clientInfo,
    deviceInfo,
    accessToken,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

describe('JellyfinHttp', () => {
  it('strips trailing slashes from the server URL so paths do not double up', () => {
    const http = new JellyfinHttp({
      serverUrl: '  http://jellyfin.local:8096///  ',
      clientInfo,
      deviceInfo,
    });
    expect(http.buildUrl('/System/Info/Public')).toBe(
      'http://jellyfin.local:8096/System/Info/Public',
    );
  });

  it('accepts a path with no leading slash', () => {
    const http = new JellyfinHttp({
      serverUrl: 'http://jellyfin.local:8096',
      clientInfo,
      deviceInfo,
    });
    expect(http.buildUrl('Users/Me')).toBe(
      'http://jellyfin.local:8096/Users/Me',
    );
  });

  it('sends the token in the Authorization header, never in the URL', async () => {
    // Query-parameter auth would put the token into the server's access logs.
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ Id: 'u1' }));
    await makeHttp(fetchImpl, 'secret-token').request('/Users/Me');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://jellyfin.local:8096/Users/Me');
    expect(url).not.toContain('secret-token');
    expect(init.headers.Authorization).toContain('Token="secret-token"');
  });

  it('omits undefined and null query values rather than stringifying them', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}));
    await makeHttp(fetchImpl).request('/Items', {
      query: { userId: 'u1', parentId: undefined, limit: 20, searchTerm: null },
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://jellyfin.local:8096/Items?userId=u1&limit=20',
    );
  });

  it('encodes query values', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}));
    await makeHttp(fetchImpl).request('/Items', {
      query: { searchTerm: 'the thing & more' },
    });
    expect(fetchImpl.mock.calls[0][0]).toContain(
      'searchTerm=the%20thing%20%26%20more',
    );
  });

  it('sends a JSON body and content type only when there is a body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}));
    const http = makeHttp(fetchImpl);

    await http.request('/Sessions/Playing', {
      method: 'POST',
      body: { ItemId: 'i1' },
    });
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"ItemId":"i1"}');
    expect(fetchImpl.mock.calls[0][1].headers['Content-Type']).toBe(
      'application/json',
    );

    await http.request('/Users/Me');
    expect(fetchImpl.mock.calls[1][1].body).toBeUndefined();
    expect(fetchImpl.mock.calls[1][1].headers['Content-Type']).toBeUndefined();
  });

  it('returns undefined for an empty body instead of throwing on JSON.parse', async () => {
    // The playback reporting endpoints answer 204 with no body.
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(undefined, 204));
    await expect(makeHttp(fetchImpl).request('/Sessions/Playing')).resolves
      .toBeUndefined();
  });

  it('raises JellyfinApiError with the status and body on a non-2xx response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse('Access token is invalid', 401));

    await expect(makeHttp(fetchImpl).request('/Users/Me')).rejects.toThrow(
      JellyfinApiError,
    );

    try {
      await makeHttp(fetchImpl).request('/Users/Me');
    } catch (error) {
      const apiError = error as JellyfinApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.body).toBe('Access token is invalid');
      // The sign-in screen keys off this rather than re-parsing the message.
      expect(apiError.isUnauthorized).toBe(true);
    }
  });

  it('raises JellyfinNetworkError when there is no response at all', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(makeHttp(fetchImpl).request('/Users/Me')).rejects.toThrow(
      JellyfinNetworkError,
    );
  });

  it('raises JellyfinTimeoutError and aborts the request when it overruns', async () => {
    // Aborting matters on a device: a raced-but-unaborted request leaks a
    // socket per timeout.
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = jest.fn((_url: string, init: RequestInit) => {
      seenSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        seenSignal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    });

    await expect(
      makeHttp(fetchImpl as unknown as jest.Mock).request('/Users/Me', {
        timeoutMs: 10,
      }),
    ).rejects.toThrow(JellyfinTimeoutError);
    expect(seenSignal?.aborted).toBe(true);
  });

  it('reports authentication state and adopts a token set later', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}));
    const http = makeHttp(fetchImpl);
    expect(http.isAuthenticated).toBe(false);

    http.setAccessToken('later-token');
    expect(http.isAuthenticated).toBe(true);

    await http.request('/Users/Me');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toContain(
      'Token="later-token"',
    );
  });
});
