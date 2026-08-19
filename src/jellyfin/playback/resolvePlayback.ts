import type {
  BaseItemDto,
  MediaSourceInfo,
  PlaybackInfoResponse,
} from '@jellyfin/sdk/lib/generated-client/models';
import { TitleData } from '../../types/TitleData';
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
   * True when the resume point is baked into the stream, so the player must
   * NOT seek — a server-side HLS playlist built with startTimeTicks begins at
   * the resume point, and its own timeline starts at zero.
   *
   * Seeking into it instead asks for a segment index the server has not
   * produced: Jellyfin logs "cannot serve ... no transcode is running",
   * restarts ffmpeg at the new offset, and the fetches in flight fail
   * meanwhile — which reads as playback ending the moment it starts.
   */
  startAppliedServerSide: boolean;
  /**
   * Ticks to add to the element's currentTime before reporting it. Non-zero
   * exactly when the offset is server-side, since the stream's clock restarts
   * at the resume point.
   */
  positionOffsetTicks: number;
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
  let startAppliedServerSide = false;

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
    // Resume is deliberately not applied here yet. Two approaches have been
    // tried on device and both fail:
    //
    //  - Seeking client-side asks for a segment the server has not written.
    //    Jellyfin logs "cannot serve ... no transcode is running", restarts
    //    ffmpeg at the new offset, and the fetches in flight fail meanwhile.
    //  - Passing startTimeTicks on the playlist URL is worse: Jellyfin copies
    //    the query into the segment URLs it generates and then rejects its own
    //    request with `System.ArgumentException: StartTimeTicks is not
    //    allowed` on /hls1/main/-1.mp4, so playback never gets an init
    //    segment.
    //
    // Playback from the start works, so that is what happens until resume is
    // solved properly.
    startAppliedServerSide = false;
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
  };

  // No resume for a generated HLS playlist yet — see above.
  const seekTicks = canDirectPlay ? resumeTicks : 0;

  return {
    titleData,
    playMethod,
    playSessionId: response.PlaySessionId ?? undefined,
    mediaSourceId: source.Id ?? undefined,
    transcodeReasons: normaliseReasons(source),
    startPositionTicks: seekTicks,
    startAppliedServerSide,
    positionOffsetTicks: startAppliedServerSide ? resumeTicks : 0,
  };
};
