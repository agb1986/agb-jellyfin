import {
  JellyfinClient,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksToSeconds,
} from '../../src/jellyfin/JellyfinClient';

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }) as Response;

const makeClient = (fetchImpl: jest.Mock) =>
  new JellyfinClient({
    serverUrl: 'http://jellyfin.local:8096',
    clientInfo: { name: 'Jellyfin Vega', version: '0.1.0' },
    deviceInfo: { name: 'Living Room', id: 'device-abc' },
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

/** Body of the nth fetch call, parsed. */
const bodyOf = (fetchImpl: jest.Mock, call = 0) =>
  JSON.parse(fetchImpl.mock.calls[call][1].body);

describe('JellyfinClient authentication', () => {
  it('reads public system info without a token', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ ServerName: 'home', Version: '10.9.0' }));
    const client = makeClient(fetchImpl);

    await expect(client.getPublicSystemInfo()).resolves.toMatchObject({
      ServerName: 'home',
    });
    expect(client.isAuthenticated).toBe(false);
  });

  it('adopts the token and user id once Quick Connect completes', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ Authenticated: true }))
      .mockResolvedValueOnce(
        jsonResponse({ AccessToken: 'tok', User: { Id: 'user-1' } }),
      );

    const client = makeClient(fetchImpl);
    await client.completeQuickConnect('s3cr3t', {
      sleep: async () => undefined,
    });

    expect(client.isAuthenticated).toBe(true);
    expect(client.currentUserId).toBe('user-1');
  });

  it('restores a session from a stored token and user id', () => {
    const client = makeClient(jest.fn());
    client.setAccessToken('stored-token', 'user-1');
    expect(client.isAuthenticated).toBe(true);
    expect(client.currentUserId).toBe('user-1');
  });

  it('forgets credentials on sign-out', () => {
    const client = makeClient(jest.fn());
    client.setAccessToken('stored-token', 'user-1');
    client.clearAccessToken();
    expect(client.isAuthenticated).toBe(false);
    expect(client.currentUserId).toBeUndefined();
  });

  it('learns the user id from /Users/Me', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ Id: 'user-9' }));
    const client = makeClient(fetchImpl);
    client.setAccessToken('tok');

    await client.getCurrentUser();
    expect(client.currentUserId).toBe('user-9');
  });
});

describe('JellyfinClient library', () => {
  it('refuses to query the library before a user id is known', async () => {
    // Sending userId=undefined produces an opaque 400 from the server.
    const client = makeClient(jest.fn());
    client.setAccessToken('tok');
    await expect(client.getUserViews()).rejects.toThrow(/No Jellyfin user id/);
  });

  it('scopes user views to the signed-in user', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ Items: [] }));
    const client = makeClient(fetchImpl);
    client.setAccessToken('tok', 'user-1');

    await client.getUserViews();
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://jellyfin.local:8096/UserViews?userId=user-1',
    );
  });

  it('joins list query parameters with commas, as the API expects', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ Items: [] }));
    const client = makeClient(fetchImpl);
    client.setAccessToken('tok', 'user-1');

    await client.getItems({
      parentId: 'lib-1',
      includeItemTypes: ['Movie', 'Series'],
      sortBy: ['SortName'],
      recursive: true,
      limit: 50,
    });

    const url = fetchImpl.mock.calls[0][0];
    expect(url).toContain('parentId=lib-1');
    expect(url).toContain('includeItemTypes=Movie%2CSeries');
    expect(url).toContain('recursive=true');
    expect(url).toContain('limit=50');
  });

  it('builds absolute image URLs', async () => {
    const client = makeClient(jest.fn());
    client.setAccessToken('tok', 'user-1');

    expect(client.getImageUrl('item 1', 'Primary', { maxWidth: 400 })).toBe(
      'http://jellyfin.local:8096/Items/item%201/Images/Primary?maxWidth=400',
    );
  });
});

describe('JellyfinClient playback', () => {
  it('posts the device profile with the PlaybackInfo request', async () => {
    // The profile is the input the server's DirectPlay / DirectStream /
    // Transcode decision is made from; omitting it makes the answer
    // meaningless.
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ MediaSources: [], PlaySessionId: 'p1' }));
    const client = makeClient(fetchImpl);
    client.setAccessToken('tok', 'user-1');

    await client.getPlaybackInfo('item-1');

    expect(fetchImpl.mock.calls[0][0]).toContain('/Items/item-1/PlaybackInfo');
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');

    const body = bodyOf(fetchImpl);
    expect(body.UserId).toBe('user-1');
    expect(body.DeviceProfile.TranscodingProfiles).toBeDefined();
    expect(body.EnableDirectStream).toBe(true);
  });

  it('lets a caller substitute a profile, which is how Phase 2 probing works', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}));
    const client = makeClient(fetchImpl);
    client.setAccessToken('tok', 'user-1');

    await client.getPlaybackInfo('item-1', {
      deviceProfile: { Name: 'probe', TranscodingProfiles: [] },
    });

    expect(bodyOf(fetchImpl).DeviceProfile.Name).toBe('probe');
  });

  it('builds a direct stream URL carrying the device id', async () => {
    const client = makeClient(jest.fn());
    client.setAccessToken('tok', 'user-1');

    const url = client.getStreamUrl('item-1', 'src-1', 'play-1');
    expect(url).toContain('/Videos/item-1/stream');
    expect(url).toContain('static=true');
    expect(url).toContain('mediaSourceId=src-1');
    expect(url).toContain('deviceId=device-abc');
  });
});

describe('JellyfinClient playback reporting', () => {
  const cases = [
    ['reportPlaybackStart', '/Sessions/Playing'],
    ['reportPlaybackProgress', '/Sessions/Playing/Progress'],
    ['reportPlaybackStopped', '/Sessions/Playing/Stopped'],
  ] as const;

  it.each(cases)('%s posts to %s', async (method, path) => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const client = makeClient(fetchImpl);
    client.setAccessToken('tok', 'user-1');

    await client[method]({
      itemId: 'item-1',
      playSessionId: 'play-1',
      positionTicks: secondsToTicks(65),
      playMethod: 'DirectStream',
    });

    expect(fetchImpl.mock.calls[0][0]).toBe(
      `http://jellyfin.local:8096${path}`,
    );
    const body = bodyOf(fetchImpl);
    expect(body.ItemId).toBe('item-1');
    expect(body.PositionTicks).toBe(650_000_000);
    expect(body.PlayMethod).toBe('DirectStream');
  });

  it('defaults MediaSourceId to the item id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const client = makeClient(fetchImpl);
    client.setAccessToken('tok', 'user-1');

    await client.reportPlaybackProgress({ itemId: 'item-1', positionTicks: 0 });
    expect(bodyOf(fetchImpl).MediaSourceId).toBe('item-1');
  });
});

describe('tick conversion', () => {
  it('uses the API\'s ten million ticks per second', () => {
    expect(TICKS_PER_SECOND).toBe(10_000_000);
    expect(secondsToTicks(1)).toBe(10_000_000);
    expect(ticksToSeconds(650_000_000)).toBe(65);
  });

  it('rounds fractional seconds to whole ticks', () => {
    expect(Number.isInteger(secondsToTicks(1.2345678))).toBe(true);
  });
});
