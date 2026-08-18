/**
 * End-to-end check against a real Jellyfin server.
 *
 * Skipped unless JELLYFIN_TEST_SERVER is set, so the normal suite stays
 * hermetic. Everything else in test/jellyfin/ asserts request shapes against a
 * fake fetch; this is the only thing that proves the server agrees with them.
 *
 * Bring a throwaway server up with:
 *
 *   docker run -d --name jellyfin-dev -p 8096:8096 \
 *     -v "$PWD/.jellyfin/config:/config" -v "$PWD/.jellyfin/cache:/cache" \
 *     -v "$PWD/.jellyfin/media:/media" jellyfin/jellyfin:latest
 *
 * then complete the startup wizard, add a library, and run:
 *
 *   JELLYFIN_TEST_SERVER=http://localhost:8096 \
 *   JELLYFIN_TEST_USER=devuser JELLYFIN_TEST_PASSWORD=devpass \
 *   npx jest test/jellyfin/integration --coverage=false
 */
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models';
import { JellyfinClient } from '../../src/jellyfin/JellyfinClient';
import { JellyfinSession } from '../../src/jellyfin/JellyfinSession';
import { MemoryKeyValueStore } from '../../src/jellyfin/storage/KeyValueStore';

/**
 * `TranscodeReasons` is missing from MediaSourceInfo in @jellyfin/sdk 0.13,
 * but Jellyfin 10.11 does return it — and it is the field the whole Phase 2
 * DeviceProfile loop reads. Declared here rather than silently dropped.
 */
type MediaSourceWithReasons = MediaSourceInfo & {
  TranscodeReasons?: string[] | string | null;
};

const serverUrl = process.env.JELLYFIN_TEST_SERVER;
const userName = process.env.JELLYFIN_TEST_USER;
const password = process.env.JELLYFIN_TEST_PASSWORD;

const clientInfo = { name: 'Jellyfin Vega (test)', version: '0.1.0' };
const describeLive = serverUrl ? describe : describe.skip;

/**
 * Approves a Quick Connect code the way a user would from the web UI. Needs an
 * already-authenticated session, which is what the password login provides.
 */
const approveQuickConnect = async (
  base: string,
  adminToken: string,
  code: string,
): Promise<void> => {
  const response = await fetch(
    `${base}/QuickConnect/Authorize?code=${encodeURIComponent(code)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `MediaBrowser Client="test-admin", Device="ci", DeviceId="ci-1", Version="1.0.0", Token="${adminToken}"`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Could not approve the code: ${response.status}`);
  }
};

const signInWithPassword = async (base: string): Promise<string> => {
  const response = await fetch(`${base}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:
        'MediaBrowser Client="test-admin", Device="ci", DeviceId="ci-1", Version="1.0.0", Token=""',
    },
    body: JSON.stringify({ Username: userName, Pw: password }),
  });
  const body = await response.json();
  return body.AccessToken;
};

describeLive('against a live Jellyfin server', () => {
  jest.setTimeout(60000);

  it('reads public system info without credentials', async () => {
    const client = new JellyfinClient({
      serverUrl: serverUrl as string,
      clientInfo,
      deviceInfo: { name: 'integration', id: 'integration-1' },
    });

    const info = await client.getPublicSystemInfo();
    expect(info.Version).toBeTruthy();
    expect(info.StartupWizardCompleted).toBe(true);
  });

  it('signs in through the whole Quick Connect flow', async () => {
    const store = new MemoryKeyValueStore();
    const session = await JellyfinSession.create({
      store,
      clientInfo,
      deviceName: 'integration',
      serverUrl,
    });

    expect(await session.client.isQuickConnectEnabled()).toBe(true);

    const { code, secret } = await session.beginSignIn();
    expect(code).toMatch(/^\w{6}$/);

    const adminToken = await signInWithPassword(serverUrl as string);
    await approveQuickConnect(serverUrl as string, adminToken, code);

    const result = await session.completeSignIn(secret, {
      pollIntervalMs: 250,
    });

    expect(result.AccessToken).toBeTruthy();
    expect(session.isSignedIn).toBe(true);
    // The stored record is what a restart reads back.
    expect(session.storedCredentials?.serverUrl).toBe(serverUrl);
    expect(await session.verify()).toBe(true);
  });

  it('lists libraries and items, and builds a usable image URL', async () => {
    const session = await JellyfinSession.create({
      store: new MemoryKeyValueStore(),
      clientInfo,
      deviceName: 'integration',
      serverUrl,
    });
    session.client.setAccessToken(
      await signInWithPassword(serverUrl as string),
    );
    await session.client.getCurrentUser();

    const views = await session.client.getUserViews();
    expect(views.Items?.length).toBeGreaterThan(0);

    const library = views.Items?.[0];
    const items = await session.client.getItems({
      parentId: library?.Id,
      recursive: true,
      includeItemTypes: ['Movie'],
      limit: 10,
    });
    expect(items.Items?.length).toBeGreaterThan(0);

    const item = items.Items?.[0];
    const imageUrl = session.client.getImageUrl(item?.Id as string, 'Primary');
    const imageResponse = await fetch(imageUrl);
    // 404 is a legitimate answer for an item with no artwork; what matters is
    // that the URL is well formed and the server recognises the route.
    expect([200, 404]).toContain(imageResponse.status);
  });

  it('answers PlaybackInfo with a delivery decision and any transcode reasons', async () => {
    // This is the Phase 2 loop in miniature: send a profile, read back what
    // the server intends to do and why.
    const session = await JellyfinSession.create({
      store: new MemoryKeyValueStore(),
      clientInfo,
      deviceName: 'integration',
      serverUrl,
    });
    session.client.setAccessToken(
      await signInWithPassword(serverUrl as string),
    );
    await session.client.getCurrentUser();

    const views = await session.client.getUserViews();
    const items = await session.client.getItems({
      parentId: views.Items?.[0]?.Id,
      recursive: true,
      includeItemTypes: ['Movie'],
      limit: 1,
    });
    const itemId = items.Items?.[0]?.Id as string;

    const playback = await session.client.getPlaybackInfo(itemId);

    expect(playback.PlaySessionId).toBeTruthy();
    expect(playback.MediaSources?.length).toBeGreaterThan(0);

    const source = playback.MediaSources?.[0] as
      | MediaSourceWithReasons
      | undefined;
    // Reported rather than asserted: which of the three the server picks
    // depends on the file, and the useful output of this test is the reason.
    // Written to stdout because jest.setup silences console.info.
    process.stdout.write(
      `[integration] ${items.Items?.[0]?.Name}: ` +
        `directPlay=${source?.SupportsDirectPlay} ` +
        `directStream=${source?.SupportsDirectStream} ` +
        `transcode=${source?.SupportsTranscoding} ` +
        `reasons=${JSON.stringify(source?.TranscodeReasons ?? null)}\n`,
    );
    expect(
      source?.SupportsDirectPlay ||
        source?.SupportsDirectStream ||
        source?.SupportsTranscoding,
    ).toBe(true);
  });

  it('accepts playback progress reports', async () => {
    const session = await JellyfinSession.create({
      store: new MemoryKeyValueStore(),
      clientInfo,
      deviceName: 'integration',
      serverUrl,
    });
    session.client.setAccessToken(
      await signInWithPassword(serverUrl as string),
    );
    await session.client.getCurrentUser();

    const views = await session.client.getUserViews();
    const items = await session.client.getItems({
      parentId: views.Items?.[0]?.Id,
      recursive: true,
      includeItemTypes: ['Movie'],
      limit: 1,
    });
    const itemId = items.Items?.[0]?.Id as string;
    const playback = await session.client.getPlaybackInfo(itemId);
    const playSessionId = playback.PlaySessionId ?? undefined;

    await expect(
      session.client.reportPlaybackStart({
        itemId,
        playSessionId,
        positionTicks: 0,
        playMethod: 'DirectPlay',
      }),
    ).resolves.toBeUndefined();

    await expect(
      session.client.reportPlaybackProgress({
        itemId,
        playSessionId,
        positionTicks: 20_000_000,
        playMethod: 'DirectPlay',
      }),
    ).resolves.toBeUndefined();

    await expect(
      session.client.reportPlaybackStopped({
        itemId,
        playSessionId,
        positionTicks: 30_000_000,
        playMethod: 'DirectPlay',
      }),
    ).resolves.toBeUndefined();
  });
});
