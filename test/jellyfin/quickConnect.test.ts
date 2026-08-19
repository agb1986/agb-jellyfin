import { JellyfinApiError } from '../../src/jellyfin/errors';
import { JellyfinHttp } from '../../src/jellyfin/JellyfinHttp';
import {
  authenticateWithQuickConnect,
  initiateQuickConnect,
  isQuickConnectAuthorized,
  isQuickConnectEnabled,
  QuickConnectCancelledError,
  QuickConnectTimeoutError,
  waitForQuickConnect,
} from '../../src/jellyfin/quickConnect';

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  }) as Response;

const errorResponse = (status: number): Response =>
  ({
    ok: false,
    status,
    statusText: 'Not Found',
    text: async () => '',
  }) as Response;

const makeHttp = (fetchImpl: jest.Mock) =>
  new JellyfinHttp({
    serverUrl: 'http://jellyfin.local:8096',
    clientInfo: { name: 'Jellyfin Vega', version: '0.1.0' },
    deviceInfo: { name: 'Living Room', id: 'device-abc' },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

describe('Quick Connect', () => {
  it('reports whether the server has Quick Connect turned on', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(true));
    await expect(isQuickConnectEnabled(makeHttp(fetchImpl))).resolves.toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toContain('/QuickConnect/Enabled');
  });

  it('returns the code to show on screen and the secret to poll with', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ Code: '123456', Secret: 's3cr3t' }));

    await expect(initiateQuickConnect(makeHttp(fetchImpl))).resolves.toEqual({
      code: '123456',
      secret: 's3cr3t',
    });
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
  });

  it('explains itself when the server answers without a code', async () => {
    // The usual cause is Quick Connect being disabled server-side, which
    // otherwise surfaces as an unreadable undefined further down.
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}));
    await expect(initiateQuickConnect(makeHttp(fetchImpl))).rejects.toThrow(
      /is Quick Connect enabled on the server/i,
    );
  });

  it('polls with the secret as a query parameter', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ Authenticated: false }));

    await expect(
      isQuickConnectAuthorized(makeHttp(fetchImpl), 's3cr3t'),
    ).resolves.toBe(false);
    expect(fetchImpl.mock.calls[0][0]).toContain(
      '/QuickConnect/Connect?secret=s3cr3t',
    );
  });

  it('exchanges an approved secret for an access token', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ AccessToken: 'tok', User: { Id: 'u1' } }));

    const result = await authenticateWithQuickConnect(
      makeHttp(fetchImpl),
      's3cr3t',
    );

    expect(result.AccessToken).toBe('tok');
    expect(fetchImpl.mock.calls[0][0]).toContain(
      '/Users/AuthenticateWithQuickConnect',
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      Secret: 's3cr3t',
    });
  });
});

describe('waitForQuickConnect', () => {
  const sleep = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    sleep.mockClear();
  });

  it('keeps polling until the user approves, then returns the token', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Authenticated: false }))
      .mockResolvedValueOnce(jsonResponse({ Authenticated: false }))
      .mockResolvedValueOnce(jsonResponse({ Authenticated: true }))
      .mockResolvedValueOnce(
        jsonResponse({ AccessToken: 'tok', User: { Id: 'u1' } }),
      );

    const result = await waitForQuickConnect(makeHttp(fetchImpl), 's3cr3t', {
      sleep,
      pollIntervalMs: 5000,
    });

    expect(result.AccessToken).toBe('tok');
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('gives up once the deadline passes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ Authenticated: false }));
    // A clock that jumps past the deadline on the second reading.
    const now = jest.fn().mockReturnValueOnce(0).mockReturnValue(999_999);

    await expect(
      waitForQuickConnect(makeHttp(fetchImpl), 's3cr3t', {
        sleep,
        now,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(QuickConnectTimeoutError);
  });

  it('treats a 404 while polling as the request having expired', async () => {
    // Jellyfin drops the request once it expires or an admin denies it; that
    // is a normal outcome and must not be retried as a transport failure.
    const fetchImpl = jest.fn().mockResolvedValue(errorResponse(404));

    await expect(
      waitForQuickConnect(makeHttp(fetchImpl), 's3cr3t', { sleep }),
    ).rejects.toThrow(QuickConnectTimeoutError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('propagates other API errors rather than swallowing them', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(errorResponse(500));
    await expect(
      waitForQuickConnect(makeHttp(fetchImpl), 's3cr3t', { sleep }),
    ).rejects.toThrow(JellyfinApiError);
  });

  it('stops when the caller cancels, without another request', async () => {
    const fetchImpl = jest.fn();
    await expect(
      waitForQuickConnect(makeHttp(fetchImpl), 's3cr3t', {
        sleep,
        isCancelled: () => true,
      }),
    ).rejects.toThrow(QuickConnectCancelledError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
