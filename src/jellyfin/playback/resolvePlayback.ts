import type {
  BaseItemDto,
  MediaSourceInfo,
  MediaStream,
  PlaybackInfoResponse,
} from '@jellyfin/sdk/lib/generated-client/models';
import { TextTrack, TitleData } from '../../types/TitleData';
import { JellyfinClient, ticksToSeconds } from '../JellyfinClient';
import { toShakaAudioCodec, toShakaVideoCodec } from './codecs';

/**
 * Turns the server's playback decision into something the existing player can
 * open.
 *
 * This is where the two halves of the project meet: Jellyfin says how it
 * intends to deliver a title, and `TitleData` is what the sample's
 * VideoHandler and ShakaPlayer consume. Everything interesting happens in
 * between — which URL, which container, and whether the answer is good news.
 */

export type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';

export interface PlaybackTarget {
  /** Ready to hand to PlayerScreen as its route parameter. */
  titleData: TitleData;
  playMethod: PlayMethod;
  /** Needed by every playback report, and by the server to stop a transcode. */
  playSessionId?: string;
  mediaSourceId?: string;
  /**
   * Why the server chose to transcode, when it did. This is the field the
   * DeviceProfile is tuned against — it names the codec or container that
   * failed to match.
   */
  transcodeReasons: string[];
  /** Resume position, if the server has one for this user. */
  startPositionTicks: number;
  /**
   * True when the start position is applied by the player as it loads, which
   * is the case for every HLS stream — `TitleData.startTimeSeconds` is handed
   * to Shaka's `load()` and it opens at the resume point.
   *
   * The reporting hook keys off this to know it must not also write
   * `currentTime`. Seeking a stream that already started in the right place
   * is what produced the start/stop loop: the write landed at `readyState 1`,
   * before Shaka had settled, and dropped the buffer it had just filled.
   */
  startAppliedAtLoad: boolean;
}

/**
 * `TranscodeReasons` is absent from MediaSourceInfo in @jellyfin/sdk 0.13,
 * although Jellyfin 10.11 returns it — and it is the single most useful field
 * in the response for this project.
 */
type MediaSourceWithReasons = MediaSourceInfo & {
  TranscodeReasons?: string[] | string | null;
};

/** Containers the static (non-Shaka) player can open directly. */
const DIRECT_PLAY_CONTAINERS = ['mp4', 'm4v', 'mov'];

export class NoPlayableSourceError extends Error {
  constructor(itemName: string) {
    super(`Jellyfin returned no playable source for "${itemName}"`);
    this.name = 'NoPlayableSourceError';
  }
}

const splitReasons = (reasons: string[] | string): string[] =>
  Array.isArray(reasons)
    ? reasons
    : reasons
        .split(',')
        .map((reason) => reason.trim())
        .filter(Boolean);

/**
 * Extracts the reasons the server chose to transcode.
 *
 * Two places have to be checked. The documented one is the MediaSource field,
 * an array on recent servers and a comma-joined string on older ones — but
 * Jellyfin 10.11 was observed returning `TranscodeReasons: null` there while
 * still transcoding, with the actual reason present only as a query parameter
 * inside TranscodingUrl. Since this value is the entire feedback signal for
 * tuning the DeviceProfile, it is worth reading from both.
 */
const normaliseReasons = (
  source: MediaSourceWithReasons | undefined,
): string[] => {
  const declared = source?.TranscodeReasons;
  if (declared) {
    const split = splitReasons(declared);
    if (split.length > 0) {
      return split;
    }
  }

  const fromUrl = source?.TranscodingUrl?.match(
    /[?&]TranscodeReasons=([^&]*)/,
  )?.[1];
  return fromUrl ? splitReasons(decodeURIComponent(fromUrl)) : [];
};

const streamOfType = (source: MediaSourceInfo, type: 'Video' | 'Audio') =>
  source.MediaStreams?.find((stream) => stream.Type === type);

/**
 * A readable name for a subtitle track.
 *
 * Jellyfin's `DisplayTitle` reads "English - SUBRIP - External", which says
 * more about the plumbing than the viewer needs. The part before the first
 * separator is the language as Jellyfin resolved it, which is the useful half;
 * `Language` is a three-letter code and only a fallback.
 */
export const subtitleLabel = (stream: MediaStream): string => {
  const fromTitle = stream.DisplayTitle?.split(' - ')[0]?.trim();
  const base = fromTitle || stream.Language || 'Subtitle';
  return stream.IsForced === true ? `${base} (forced)` : base;
};

/**
 * External text subtitle tracks, as `TitleData.textTrack` entries.
 *
 * Only `DeliveryMethod: 'External'` tracks qualify: those are the ones the
 * server will serve as a separate file the player can fetch. `Embed` needs the
 * container, and `Encode` means burning the subtitle into the video — which
 * costs a full transcode and is what the DeviceProfile is shaped to avoid.
 *
 * The URL Jellyfin supplies already carries its own `ApiKey`, and it must: the
 * player fetches subtitles through its own networking and never sees this
 * client's Authorization header — the same reason media URLs carry `api_key`.
 */
export const subtitleTracks = (
  client: JellyfinClient,
  source: MediaSourceInfo,
): TextTrack[] =>
  (source.MediaStreams ?? [])
    .filter(
      (stream) =>
        stream.Type === 'Subtitle' &&
        stream.DeliveryMethod === 'External' &&
        typeof stream.DeliveryUrl === 'string' &&
        stream.DeliveryUrl.length > 0,
    )
    .map((stream) => ({
      label: subtitleLabel(stream),
      language: stream.Language ?? '',
      uri: `${client.http.serverUrl}${stream.DeliveryUrl}`,
      // Always WebVTT: the DeviceProfile claims vtt and nothing else, so the
      // server converts anything it holds on the way out.
      mimeType: 'text/vtt' as const,
    }));

/**
 * Chooses between what the server offers.
 *
 * Direct play is preferred and needs no server work at all, but only for
 * containers the static player can open — Shaka handles HLS and DASH only, so
 * an MKV that the device could technically decode still has to be remuxed.
 * Otherwise the TranscodingUrl is used, which covers both DirectStream (a
 * cheap remux) and a real transcode; the server decides which, and says so in
 * TranscodeReasons.
 */
export interface ResolvePlaybackOptions {
  /**
   * Allow the static player when the server offers direct play. Off by
   * default: it does not work on the virtual device, and asking for HLS costs
   * the server a remux at worst.
   */
  allowDirectPlay?: boolean;
}

export const resolvePlaybackTarget = (
  client: JellyfinClient,
  item: BaseItemDto,
  response: PlaybackInfoResponse,
  options: ResolvePlaybackOptions = {},
): PlaybackTarget => {
  const source = response.MediaSources?.[0] as
    | MediaSourceWithReasons
    | undefined;

  if (!source) {
    throw new NoPlayableSourceError(item.Name ?? 'this title');
  }

  const itemId = item.Id as string;
  const container = (source.Container ?? '').toLowerCase();
  const canDirectPlay =
    options.allowDirectPlay === true &&
    source.SupportsDirectPlay === true &&
    DIRECT_PLAY_CONTAINERS.includes(container);

  const videoStream = streamOfType(source, 'Video');
  const audioStream = streamOfType(source, 'Audio');

  const resumeTicks = item.UserData?.PlaybackPositionTicks ?? 0;

  let uri: string;
  let format: TitleData['format'];
  let playMethod: PlayMethod;
  let startAppliedAtLoad = false;

  if (canDirectPlay) {
    uri = client.getStreamUrl(
      itemId,
      source.Id ?? itemId,
      response.PlaySessionId ?? undefined,
      container,
    );
    format = 'MP4';
    playMethod = 'DirectPlay';
  } else if (
    source.TranscodingUrl &&
    source.TranscodingSubProtocol !== 'http'
  ) {
    // Already a complete relative URL carrying the server's chosen settings,
    // including its own ApiKey — appending anything to it risks contradicting
    // the parameters the server picked.
    uri = `${client.http.serverUrl}${source.TranscodingUrl}`;
    format = 'HLS';
    startAppliedAtLoad = true;
    playMethod =
      source.SupportsDirectStream === true ? 'DirectStream' : 'Transcode';
  } else {
    // Either the server offered nothing, or it offered a progressive HTTP
    // stream — which on this platform means the static player, and the static
    // player cannot open a Jellyfin URL. Ask for HLS explicitly instead, and
    // let the server decide whether that is a remux or a transcode.
    uri = client.getHlsUrl(itemId, {
      mediaSourceId: source.Id ?? itemId,
      playSessionId: response.PlaySessionId ?? undefined,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
    // Note what is deliberately absent: startTimeTicks. Jellyfin does not
    // shift a playlist to a start offset — it returns the same VOD playlist
    // numbered from segment 0 either way — but it does copy the parameter into
    // every segment URL it generates, and then rejects its own request with
    // `System.ArgumentException: StartTimeTicks is not allowed` on
    // /hls1/main/-1.mp4. The playlist already spans the whole title, so the
    // resume point is reached by starting Shaka at it instead.
    startAppliedAtLoad = true;
    format = 'HLS';
    playMethod =
      source.SupportsDirectStream === true ? 'DirectStream' : 'Transcode';
  }

  const titleData: TitleData = {
    id: itemId,
    title: item.Name ?? 'Untitled',
    description: item.Overview ?? '',
    uri,
    format,
    mediaType: 'video',
    mediaSourceType: 'url',
    categories: item.Genres ?? [],
    channelID: '',
    posterUrl: client.getImageUrl(itemId, 'Backdrop', { maxWidth: 1920 }),
    thumbnail: client.getImageUrl(itemId, 'Primary', { maxWidth: 400 }),
    rentAmount: '',
    secure: false,
    uhd: (videoStream?.Width ?? 0) >= 3840,
    duration: item.RunTimeTicks
      ? Math.round(ticksToSeconds(item.RunTimeTicks))
      : undefined,
    vcodec: toShakaVideoCodec(videoStream?.Codec),
    acodec: toShakaAudioCodec(audioStream?.Codec),
    textTrack: subtitleTracks(client, source),
    // Shaka opens here. Only meaningful for the HLS paths; the static player
    // used for direct play ignores it and is seeked instead.
    startTimeSeconds:
      startAppliedAtLoad && resumeTicks > 0
        ? ticksToSeconds(resumeTicks)
        : undefined,
  };

  return {
    titleData,
    playMethod,
    playSessionId: response.PlaySessionId ?? undefined,
    mediaSourceId: source.Id ?? undefined,
    transcodeReasons: normaliseReasons(source),
    startPositionTicks: resumeTicks,
    startAppliedAtLoad,
  };
};
