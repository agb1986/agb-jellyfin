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
import { buildDeviceProfile } from '../../src/jellyfin/deviceProfile';
import { PlaybackReporter } from '../../src/jellyfin/playback/PlaybackReporter';
import { resolvePlaybackTarget } from '../../src/jellyfin/playback/resolvePlayback';
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

/**
 * Read through an alias, not as `process.env.X`.
 *
 * react-native-dotenv rewrites `process.env.SOMETHING` into a literal at
 * compile time, and Jest caches the transformed module — so a run with the
 * variable set bakes the value in, and every later run tries to reach a server
 * that is no longer there. Aliasing the object defeats the rewrite, because
 * the plugin only matches member expressions on `process.env` itself.
 */
const env = process.env;
const serverUrl = env.JELLYFIN_TEST_SERVER;
const userName = env.JELLYFIN_TEST_USER;
const password = env.JELLYFIN_TEST_PASSWORD;

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

  it('resolves a playable URL the server actually serves', async () => {
    // The hand-off between the two halves of the app: PlaybackInfo in, a
    // TitleData the sample's player can open out. Fetching the URL is the
    // part unit tests cannot do — it proves the query parameters and the
    // api_key are the ones the server wants.
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
    const item = items.Items?.[0];

    const playback = await session.client.getPlaybackInfo(item?.Id as string);
    const target = resolvePlaybackTarget(session.client, item ?? {}, playback);

    process.stdout.write(
      `[integration] resolved ${target.titleData.title}: method=${target.playMethod} ` +
        `format=${target.titleData.format} vcodec=${target.titleData.vcodec} ` +
        `acodec=${target.titleData.acodec} reasons=${
          target.transcodeReasons.join(',') || 'none'
        }\n`,
    );

    const response = await fetch(target.titleData.uri);
    expect(response.status).toBe(200);

    const contentType = response.headers.get('content-type') ?? '';
    // A direct play answers with the file; an HLS answer is a playlist.
    expect(contentType).toMatch(/video|mpegurl|octet-stream/i);

    // Now the path that matters for a real library. Claiming no direct-play
    // container forces the server down the HLS route, which is what every
    // remux will take, and checks that the TranscodingUrl it hands back is
    // usable exactly as given.
    const hlsPlayback = await session.client.getPlaybackInfo(
      item?.Id as string,
      {
        deviceProfile: {
          ...buildDeviceProfile(),
          DirectPlayProfiles: [],
        },
      },
    );
    const hlsTarget = resolvePlaybackTarget(
      session.client,
      item ?? {},
      hlsPlayback,
    );

    process.stdout.write(
      `[integration] forced HLS ${hlsTarget.titleData.title}: ` +
        `method=${hlsTarget.playMethod} format=${hlsTarget.titleData.format} ` +
        `reasons=${hlsTarget.transcodeReasons.join(',') || 'none'}\n`,
    );

    expect(hlsTarget.titleData.format).toBe('HLS');

    const playlist = await fetch(hlsTarget.titleData.uri);
    expect(playlist.status).toBe(200);
    expect(await playlist.text()).toContain('#EXTM3U');
  });

  it('offers subtitles the server serves as WebVTT', async () => {
    // The DeviceProfile claims vtt and nothing else, which makes Jellyfin
    // convert on the way out. Fetching the track is the only way to prove
    // that: a profile claiming srt gets the raw SRT file back from the same
    // endpoint, and nothing about the response shape says which happened.
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
      limit: 20,
    });

    // Find a title that actually has an external subtitle; a library without
    // one cannot prove anything, so say so rather than passing vacuously.
    let tracks: NonNullable<
      ReturnType<typeof resolvePlaybackTarget>['titleData']['textTrack']
    > = [];
    for (const candidate of items.Items ?? []) {
      const playback = await session.client.getPlaybackInfo(
        candidate.Id as string,
      );
      const target = resolvePlaybackTarget(session.client, candidate, playback);
      if ((target.titleData.textTrack ?? []).length > 0) {
        tracks = target.titleData.textTrack ?? [];
        process.stdout.write(
          `[integration] subtitles on ${target.titleData.title}: ` +
            `${tracks.map((track) => track.label).join(', ')}\n`,
        );
        break;
      }
    }

    if (tracks.length === 0) {
      process.stdout.write(
        '[integration] no external subtitles in this library — nothing proved\n',
      );
      return;
    }

    expect(tracks[0].mimeType).toBe('text/vtt');
    expect(tracks[0].uri).toContain('Stream.vtt');

    const response = await fetch(tracks[0].uri);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/vtt');
    expect(await response.text()).toContain('WEBVTT');
  });

  it('finds items across every library by search term', async () => {
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

    // Take a real title's first word and search for it, so the term is known
    // to exist without hard-coding anything about the library.
    const views = await session.client.getUserViews();
    const items = await session.client.getItems({
      parentId: views.Items?.[0]?.Id,
      recursive: true,
      includeItemTypes: ['Movie'],
      limit: 1,
    });
    const known = items.Items?.[0];
    const word = (known?.Name ?? '').split(' ')[0];
    expect(word.length).toBeGreaterThan(0);

    const found = await session.client.getItems({
      searchTerm: word,
      recursive: true,
      includeItemTypes: ['Movie', 'Series', 'Episode'],
      limit: 60,
    });

    process.stdout.write(
      `[integration] search "${word}" returned ${found.Items?.length ?? 0}: ` +
        `${(found.Items ?? []).map((i) => i.Name).join(', ')}\n`,
    );

    expect(found.Items?.some((i) => i.Id === known?.Id)).toBe(true);
  });

  it('returns nothing, rather than everything, for a term that matches no title', async () => {
    // Worth pinning: an ignored searchTerm would look like a working search
    // that always returns the whole library.
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

    const found = await session.client.getItems({
      searchTerm: 'zzzznotathingzzzz',
      recursive: true,
      includeItemTypes: ['Movie', 'Series', 'Episode'],
      limit: 60,
    });

    expect(found.Items ?? []).toHaveLength(0);
  });

  it('turns a reported stop into a resume point the server hands back', async () => {
    // The whole reason reporting is server-side: this is what makes a film
    // resume on a different stick, and what fills Continue Watching.
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
    // Jellyfin refuses to store a resume point for anything shorter than
    // MinResumeDurationSeconds (five minutes by default), and treats a
    // position past MaxResumePct as watched — so this needs a long item, not
    // whichever one happens to be first.
    const items = await session.client.getItems({
      parentId: views.Items?.[0]?.Id,
      recursive: true,
      includeItemTypes: ['Movie'],
      searchTerm: 'Long Feature',
      limit: 1,
    });
    const item = items.Items?.[0];
    if (!item) {
      throw new Error(
        'This test needs a library item longer than five minutes named "Long Feature"',
      );
    }
    const itemId = item.Id as string;

    const playback = await session.client.getPlaybackInfo(itemId);
    const target = resolvePlaybackTarget(session.client, item, playback);

    const reporter = new PlaybackReporter(session.client, {
      itemId,
      playSessionId: target.playSessionId,
      mediaSourceId: target.mediaSourceId,
      playMethod: target.playMethod,
    });

    await reporter.start({ positionSeconds: 0 });
    await reporter.stop({ positionSeconds: 90 });

    const afterwards = await session.client.getItem(itemId);
    const resumeTicks = afterwards.UserData?.PlaybackPositionTicks ?? 0;

    process.stdout.write(
      `[integration] resume point after reporting 90s: ${resumeTicks} ticks\n`,
    );
    expect(resumeTicks).toBe(900_000_000);
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
