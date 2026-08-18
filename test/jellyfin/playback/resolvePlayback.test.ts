import type {
  BaseItemDto,
  PlaybackInfoResponse,
} from '@jellyfin/sdk/lib/generated-client/models';
import { JellyfinClient } from '../../../src/jellyfin/JellyfinClient';
import {
  NoPlayableSourceError,
  resolvePlaybackTarget,
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
  it('uses the static stream URL when the server offers direct play', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      directPlayResponse,
    );

    expect(target.playMethod).toBe('DirectPlay');
    expect(target.titleData.format).toBe('MP4');
    expect(target.titleData.uri).toContain('/Videos/item-1/stream');
    expect(target.titleData.uri).toContain('static=true');
  });

  it('carries the token in the media URL, since Shaka never sees our headers', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      item,
      directPlayResponse,
    );
    expect(target.titleData.uri).toContain('api_key=tok');
  });

  it('refuses direct play for a container the static player cannot open', async () => {
    // Shaka handles HLS and DASH only, so an MKV has to be remuxed even when
    // the device could decode every stream inside it.
    const response = remuxResponse({ SupportsDirectPlay: true });
    const target = resolvePlaybackTarget(makeClient(), item, response);

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
    const direct = resolvePlaybackTarget(makeClient(), item, directPlayResponse);
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

  it('passes through the resume position', async () => {
    const target = resolvePlaybackTarget(
      makeClient(),
      { ...item, UserData: { PlaybackPositionTicks: 6_000_000_000 } },
      directPlayResponse,
    );
    expect(target.startPositionTicks).toBe(6_000_000_000);
  });

  it('raises rather than handing the player nothing to open', async () => {
    expect(() =>
      resolvePlaybackTarget(makeClient(), item, { MediaSources: [] }),
    ).toThrow(NoPlayableSourceError);

    expect(() =>
      resolvePlaybackTarget(
        makeClient(),
        item,
        remuxResponse({ TranscodingUrl: undefined, Container: 'mkv' }),
      ),
    ).toThrow(NoPlayableSourceError);
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
