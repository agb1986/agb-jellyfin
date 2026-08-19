import type {
  DeviceProfile,
  DirectPlayProfile,
  SubtitleProfile,
  TranscodingProfile,
} from '@jellyfin/sdk/lib/generated-client/models';

/**
 * The DeviceProfile is what the server uses to decide, per title, between
 * DirectPlay, DirectStream (remux) and Transcode. Claim too little and a Fire
 * TV Stick makes the server re-encode video it could have remuxed; claim too
 * much and playback fails on the device instead.
 *
 * Everything here is grounded in `docs/playback-spike-results.md`, measured on
 * the **virtual device**. Two entries are deliberately conservative and should
 * be revisited the moment the spike is re-run on armv7 hardware:
 *
 * - **HEVC is not claimed.** `MediaSource.isTypeSupported` returned true for
 *   `hvc1` and `hev1`, and playback then failed. Real sticks decode HEVC in
 *   hardware, so this is the entry most likely to change — and the one with
 *   the largest payoff, since nearly every 4K remux is HEVC.
 * - **AC-3 and E-AC-3 are not claimed.** `isTypeSupported` returned false for
 *   both, and Shaka dropped those variants from the manifest entirely. Titles
 *   with AC-3 audio will come back with an audio TranscodeReason. Audio-only
 *   transcoding is cheap, so this is an annoyance rather than a blocker.
 *
 * Both are options rather than constants so hardware results can flip them
 * without editing this file's logic.
 */

/**
 * No bitrate cap on a LAN. The value exists because Jellyfin requires one, and
 * setting it too low is a classic own-goal: a 4K remux runs 60–100 Mbps, so a
 * "safe-looking" 50 Mbps cap forces a full transcode of exactly the files that
 * are most expensive to transcode.
 */
const LAN_MAX_BITRATE = 200_000_000;

export interface DeviceProfileOptions {
  /**
   * Claim HEVC video. Leave false until the playback spike passes HEVC on a
   * real Fire TV Stick — the virtual device advertises support and then fails.
   */
  supportsHevc?: boolean;
  /**
   * Claim AC-3 / E-AC-3 audio passthrough. False on the virtual device, which
   * rejects both at the MediaSource level.
   */
  supportsDolbyAudio?: boolean;
  /** Override the bitrate ceiling. Defaults to effectively uncapped. */
  maxStreamingBitrate?: number;
}

/** Audio codecs the device can decode, in preference order. */
const audioCodecs = (supportsDolbyAudio: boolean): string[] => {
  return supportsDolbyAudio ? ['aac', 'mp3', 'ac3', 'eac3'] : ['aac', 'mp3'];
};

/** Video codecs the device can decode, in preference order. */
const videoCodecs = (supportsHevc: boolean): string[] => {
  return supportsHevc ? ['h264', 'hevc'] : ['h264'];
};

/**
 * Builds the profile this client sends with every PlaybackInfo request.
 *
 * Shape rationale: Shaka consumes DASH and HLS only, so direct play of an MKV
 * is off the table no matter what the device can decode. The realistic best
 * case is DirectStream — the server remuxes into fragmented MP4 and serves it
 * over HLS, which the spike confirmed plays.
 */
export const buildDeviceProfile = (
  options: DeviceProfileOptions = {},
): DeviceProfile => {
  const supportsHevc = options.supportsHevc ?? false;
  const supportsDolbyAudio = options.supportsDolbyAudio ?? false;
  const video = videoCodecs(supportsHevc).join(',');
  const audio = audioCodecs(supportsDolbyAudio).join(',');

  const directPlayProfiles: DirectPlayProfile[] = [
    // Progressive MP4 straight from /Videos/{id}/stream. The spike's
    // progressive-mp4 case passed, so true direct play is available for files
    // that are already in a compatible container.
    {
      Container: 'mp4,m4v',
      Type: 'Video',
      VideoCodec: video,
      AudioCodec: audio,
    },
    {
      Container: 'm4a,mp3',
      Type: 'Audio',
      AudioCodec: audio,
    },
  ];

  const transcodingProfiles: TranscodingProfile[] = [
    // The important one. Container mp4 over the hls protocol is what makes
    // Jellyfin emit fragmented MP4 (CMAF) segments rather than MPEG-TS.
    // Whether the server remuxes or re-encodes into it is decided per stream
    // by the codecs above.
    {
      Container: 'mp4',
      Type: 'Video',
      Protocol: 'hls',
      VideoCodec: video,
      AudioCodec: audio,
      Context: 'Streaming',
      // Segments must not be cut on non-key frames; doing so is what produces
      // audible gaps and seek drift in HLS playback.
      BreakOnNonKeyFrames: false,
      MinSegments: 1,
      MaxAudioChannels: '6',
    },
    {
      Container: 'mp3',
      Type: 'Audio',
      Protocol: 'http',
      AudioCodec: 'mp3',
      Context: 'Streaming',
    },
  ];

  // Text subtitles are handed to the player as a separate track. Image-based
  // formats (PGS, DVDSUB) cannot be, so Jellyfin burns them into the picture —
  // which forces a full video transcode. They are omitted here so the server
  // knows not to try; picking a text track, or none, stays cheap.
  //
  // **Only WebVTT is claimed, and that is deliberate.** A format listed here
  // is a promise that the client can parse it, so listing srt/subrip makes
  // Jellyfin hand over the raw SRT file — `Stream.subrip`, which the player
  // does not parse. Claiming vtt alone makes the server convert on the way
  // out: the same stream arrives as `Stream.vtt` with `content-type:
  // text/vtt`. Verified against 10.11.11 by asking for the same subtitle both
  // ways.
  const subtitleProfiles: SubtitleProfile[] = [
    { Format: 'vtt', Method: 'External' },
    { Format: 'vtt', Method: 'Hls' },
  ];

  return {
    Name: 'Jellyfin Vega',
    MaxStreamingBitrate: options.maxStreamingBitrate ?? LAN_MAX_BITRATE,
    MaxStaticBitrate: options.maxStreamingBitrate ?? LAN_MAX_BITRATE,
    DirectPlayProfiles: directPlayProfiles,
    TranscodingProfiles: transcodingProfiles,
    SubtitleProfiles: subtitleProfiles,
    ContainerProfiles: [],
    CodecProfiles: [],
  };
};
