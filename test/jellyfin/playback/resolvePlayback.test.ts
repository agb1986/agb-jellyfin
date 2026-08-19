import type {
  BaseItemDto,
  PlaybackInfoResponse,
} from '@jellyfin/sdk/lib/generated-client/models';
import { JellyfinClient } from '../../../src/jellyfin/JellyfinClient';
import {
  NoPlayableSourceError,
  resolvePlaybackTarget,
  subtitleLabel,
} from '../../../src/jellyfin/playback/resolvePlayback';

const makeClient = () => {
  const client = new JellyfinClient({
    serverUrl: 'http://jellyfin.local:8096',
    clientInfo: { name: 'Jellyfin Vega', version: '0.1.0' },
    deviceInfo: { name: 'Living Room', id: 'device-abc' },
    fetchImpl: jest.fn() as unknown as typeof fetch,
  });
  client.setAccessToken('tok', 'user-1');
  return client;
};

const item: BaseItemDto = {
  Id: 'item-1',
  Name: 'Arrival',
  Overview: 'Linguist meets heptapods.',
  Genres: ['Science Fiction'],
  RunTimeTicks: 71_040_000_000, // 1h 58m
};

const directPlayResponse: PlaybackInfoResponse = {
  PlaySessionId: 'play-1',
  MediaSources: [
    {
      Id: 'source-1',
      Container: 'mp4',
      SupportsDirectPlay: true,
      SupportsDirectStream: true,
      MediaStreams: [
        { Type: 'Video', Codec: 'h264', Width: 1920 },
        { Type: 'Audio', Codec: 'aac' },
      ],
    },
  ],
};

const remuxResponse = (
  overrides: Record<string, unknown> = {},
): PlaybackInfoResponse => ({
  PlaySessionId: 'play-2',
  MediaSources: [
    {
      Id: 'source-2',
      Container: 'mkv',
      SupportsDirectPlay: false,
      SupportsDirectStream: true,
      TranscodingUrl: '/videos/item-1/master.m3u8?ApiKey=tok&SegmentContainer=mp4',
      TranscodingSubProtocol: 'hls',
      MediaStreams: [
        { Type: 'Video', Codec: 'hevc', Width: 3840 },
        { Type: 'Audio', Codec: 'eac3' },
      ],
      ...overrides,
    },
  ],
});

describe('resolvePlaybackTarget', () => {
  it('uses the static stream URL when direct play is explicitly allowed', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      directPlayResponse,
      { allowDirectPlay: true },
    );

    expect(target.playMethod).toBe('DirectPlay');
    expect(target.titleData.format).toBe('MP4');
    // The container belongs in the path: a player that infers it from the URL
    // has nothing to go on otherwise.
    expect(target.titleData.uri).toContain('/Videos/item-1/stream.mp4');
    expect(target.titleData.uri).toContain('static=true');
  });

  it('carries the token in the media URL, since Shaka never sees our headers', async () => {
    const target = resolvePlaybackTarget(makeClient(), item, directPlayResponse);
    expect(target.titleData.uri).toContain('api_key=tok');
  });

  it('asks for HLS by default, even when the server offers direct play', async () => {
    // The static player rejects a Jellyfin URL outright on the virtual device:
    // the element initializes, src is set, load() is called, and it reports
    // MEDIA_ERR_SRC_NOT_SUPPORTED. Shaka plays fragmented-MP4 HLS on the same
    // device, so that is the path this client takes.
    const target = resolvePlaybackTarget(makeClient(), item, directPlayResponse);

    expect(target.titleData.format).toBe('HLS');
    expect(target.titleData.uri).toContain('/Videos/item-1/master.m3u8');
    expect(target.titleData.uri).toContain('SegmentContainer=mp4');
  });

  it('builds its own HLS URL when the server answers with a progressive stream', async () => {
    // With a profile that permits direct play, Jellyfin answers
    // TranscodingSubProtocol "http" and no TranscodingUrl at all, which leaves
    // an HLS-only client with nothing to open.
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      remuxResponse({
        TranscodingSubProtocol: 'http',
        TranscodingUrl: '/videos/item-1/stream.mp4?ApiKey=tok',
      }),
    );

    expect(target.titleData.format).toBe('HLS');
    expect(target.titleData.uri).toContain('master.m3u8');
  });

  it('refuses direct play for a container the static player cannot open', async () => {
    // Shaka handles HLS and DASH only, so an MKV has to be remuxed even when
    // the device could decode every stream inside it.
    const response = remuxResponse({ SupportsDirectPlay: true });
    const target = resolvePlaybackTarget(makeClient(), item, response, {
      allowDirectPlay: true,
    });

    expect(target.playMethod).not.toBe('DirectPlay');
    expect(target.titleData.format).toBe('HLS');
  });

  it('prefers the server TranscodingUrl verbatim', async () => {
    // It already encodes the settings the server chose, including its own
    // ApiKey; appending to it risks contradicting them.
    const target = resolvePlaybackTarget(makeClient(), item, remuxResponse());

    expect(target.titleData.uri).toBe(
      'http://jellyfin.local:8096/videos/item-1/master.m3u8?ApiKey=tok&SegmentContainer=mp4',
    );
  });

  it('reports DirectStream and Transcode as different outcomes', async () => {
    expect(
      resolvePlaybackTarget(makeClient(), item, remuxResponse()).playMethod,
    ).toBe('DirectStream');

    expect(
      resolvePlaybackTarget(
        makeClient(),
        item,
        remuxResponse({ SupportsDirectStream: false }),
      ).playMethod,
    ).toBe('Transcode');
  });

  it('surfaces the transcode reasons the DeviceProfile is tuned against', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      remuxResponse({ TranscodeReasons: ['VideoCodecNotSupported'] }),
    );
    expect(target.transcodeReasons).toEqual(['VideoCodecNotSupported']);
  });

  it('accepts the comma-joined reasons older servers return', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      remuxResponse({
        TranscodeReasons: 'VideoCodecNotSupported, AudioCodecNotSupported',
      }),
    );
    expect(target.transcodeReasons).toEqual([
      'VideoCodecNotSupported',
      'AudioCodecNotSupported',
    ]);
  });

  it('translates ffmpeg codec names into the ones MediaSource understands', async () => {
    // h264 and avc1 are the same decoder, but only one survives
    // isTypeSupported.
    const direct = resolvePlaybackTarget(makeClient(), item, directPlayResponse, {
      allowDirectPlay: true,
    });
    expect(direct.titleData.vcodec).toBe('avc1');
    expect(direct.titleData.acodec).toBe('mp4a');

    const remux = resolvePlaybackTarget(makeClient(), item, remuxResponse());
    expect(remux.titleData.vcodec).toBe('hvc1');
    expect(remux.titleData.acodec).toBe('ec-3');
  });

  it('fills in the metadata the player screen displays', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      directPlayResponse,
    );

    expect(target.titleData.title).toBe('Arrival');
    expect(target.titleData.description).toBe('Linguist meets heptapods.');
    expect(target.titleData.categories).toEqual(['Science Fiction']);
    expect(target.titleData.duration).toBe(7104);
    expect(target.titleData.uhd).toBe(false);
  });

  it('marks a 4K source as UHD', async () => {
    expect(
      resolvePlaybackTarget(makeClient(), item, remuxResponse()).titleData.uhd,
    ).toBe(true);
  });

  it('passes through the resume position for direct play', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      { ...item, UserData: { PlaybackPositionTicks: 6_000_000_000 } },
      directPlayResponse,
      { allowDirectPlay: true },
    );
    expect(target.startPositionTicks).toBe(6_000_000_000);
  });

  it('raises rather than handing the player nothing to open', async () => {
    expect(() =>
      resolvePlaybackTarget(makeClient(), item, { MediaSources: [] }),
    ).toThrow(NoPlayableSourceError);

    // A source with no TranscodingUrl is no longer fatal — the client asks for
    // HLS itself — so only a response with no source at all raises.
  });
});

describe('transcode reasons hidden in the TranscodingUrl', () => {
  it('reads them from the URL when the field is null', async () => {
    // Jellyfin 10.11 was observed doing exactly this: transcoding, with
    // TranscodeReasons null on the media source and the real answer only in
    // the URL it handed back. This value is the whole feedback signal for
    // tuning the DeviceProfile, so both places are checked.
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      remuxResponse({
        TranscodeReasons: null,
        TranscodingUrl:
          '/videos/item-1/master.m3u8?ApiKey=tok&TranscodeReasons=DirectPlayError',
      }),
    );
    expect(target.transcodeReasons).toEqual(['DirectPlayError']);
  });

  it('prefers the declared field when the server populates it', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      remuxResponse({
        TranscodeReasons: ['VideoCodecNotSupported'],
        TranscodingUrl:
          '/videos/item-1/master.m3u8?TranscodeReasons=DirectPlayError',
      }),
    );
    expect(target.transcodeReasons).toEqual(['VideoCodecNotSupported']);
  });

  it('reports none when neither place says anything', async () => {
    expect(
      resolvePlaybackTarget(makeClient(), item, remuxResponse())
        .transcodeReasons,
    ).toEqual([]);
  });
});

describe('subtitles', () => {
  const withSubtitles = (streams: unknown[]) => ({
    ...directPlayResponse,
    MediaSources: [
      {
        ...directPlayResponse.MediaSources![0],
        MediaStreams: [
          ...(directPlayResponse.MediaSources![0].MediaStreams ?? []),
          ...streams,
        ],
      },
    ],
  });

  const external = {
    Type: 'Subtitle',
    Index: 0,
    Codec: 'subrip',
    Language: 'eng',
    DisplayTitle: 'English - SUBRIP - External',
    IsTextSubtitleStream: true,
    DeliveryMethod: 'External',
    DeliveryUrl: '/Videos/item-1/item-1/Subtitles/0/0/Stream.vtt?ApiKey=key',
  };

  it('offers an external text track to the player', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      withSubtitles([external]) as never,
    );

    expect(target.titleData.textTrack).toHaveLength(1);
    expect(target.titleData.textTrack![0]).toEqual({
      label: 'English',
      language: 'eng',
      uri: 'http://jellyfin.local:8096/Videos/item-1/item-1/Subtitles/0/0/Stream.vtt?ApiKey=key',
      mimeType: 'text/vtt',
    });
  });

  it('keeps the ApiKey the server put on the URL', async () => {
    // The player fetches subtitles through its own networking and never sees
    // this client's Authorization header.
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      withSubtitles([external]) as never,
    );

    expect(target.titleData.textTrack![0].uri).toContain('ApiKey=key');
  });

  it('ignores a track the server would have to burn into the picture', async () => {
    // Encode means a full video transcode; the DeviceProfile is shaped to
    // avoid ever being offered one.
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      withSubtitles([
        { ...external, DeliveryMethod: 'Encode', DeliveryUrl: null },
      ]) as never,
    );

    expect(target.titleData.textTrack).toEqual([]);
  });

  it('ignores an embedded track, which has no URL to fetch', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      withSubtitles([
        { ...external, DeliveryMethod: 'Embed', DeliveryUrl: null },
      ]) as never,
    );

    expect(target.titleData.textTrack).toEqual([]);
  });

  it('offers every external track, not just the first', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      withSubtitles([
        external,
        {
          ...external,
          Index: 1,
          Language: 'fra',
          DisplayTitle: 'French - SUBRIP - External',
          DeliveryUrl: '/Videos/item-1/item-1/Subtitles/1/0/Stream.vtt',
        },
      ]) as never,
    );

    expect(target.titleData.textTrack!.map((track) => track.label)).toEqual([
      'English',
      'French',
    ]);
  });

  it('has no tracks when the title has no subtitles', async () => {
    const target = resolvePlaybackTarget(makeClient(), item, directPlayResponse);

    expect(target.titleData.textTrack).toEqual([]);
  });
});

describe('subtitleLabel', () => {
  it('takes the language from the front of DisplayTitle', () => {
    expect(
      subtitleLabel({ DisplayTitle: 'English - SUBRIP - External' }),
    ).toBe('English');
  });

  it('falls back to the language code when there is no title', () => {
    expect(subtitleLabel({ Language: 'eng' })).toBe('eng');
  });

  it('marks a forced track, which appears without being chosen', () => {
    expect(
      subtitleLabel({ DisplayTitle: 'English - SUBRIP', IsForced: true }),
    ).toBe('English (forced)');
  });

  it('still names a track the server described not at all', () => {
    expect(subtitleLabel({})).toBe('Subtitle');
  });
});

describe('resume against an HLS stream', () => {
  const withResume = {
    ...item,
    UserData: { PlaybackPositionTicks: 900_000_000 },
  };

  it('opens the stream at the resume point rather than seeking to it', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      withResume,
      directPlayResponse,
    );

    // 900,000,000 ticks is 90 seconds. Shaka receives this at load().
    expect(target.titleData.startTimeSeconds).toBe(90);
    expect(target.startAppliedAtLoad).toBe(true);
    expect(target.startPositionTicks).toBe(900_000_000);
  });

  it('never puts startTimeTicks on the playlist URL', async () => {
    // Jellyfin returns the same playlist either way — segment 0 onwards,
    // covering the whole title — but copies the parameter into every segment
    // URL it generates and then rejects its own request with
    // "StartTimeTicks is not allowed" on /hls1/main/-1.mp4.
    const target = resolvePlaybackTarget(
      makeClient(),
      withResume,
      directPlayResponse,
    );

    expect(target.titleData.uri.toLowerCase()).not.toContain('starttimeticks');
  });

  it('leaves direct play to seek, since the static player is not Shaka', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      withResume,
      directPlayResponse,
      { allowDirectPlay: true },
    );

    expect(target.startAppliedAtLoad).toBe(false);
    expect(target.titleData.startTimeSeconds).toBeUndefined();
    expect(target.startPositionTicks).toBe(900_000_000);
  });
});
