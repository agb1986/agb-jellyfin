/**
 * Playback spike fixtures.
 *
 * Phase 1 of the project plan asks a single make-or-break question: can Vega's
 * Shaka integration play what a Jellyfin server actually emits? This file
 * answers it without needing a Jellyfin server, by pointing the existing player
 * at public streams whose container/codec shapes match Jellyfin's output.
 *
 * Why these shapes:
 *
 * - Jellyfin DirectStream remuxes into **fragmented MP4 (CMAF) HLS**. The
 *   sample app only ever exercised MPEG-TS HLS, so fMP4 is untested here.
 * - A library of remuxes will be H.264 or HEVC video with AAC, AC-3 or E-AC-3
 *   audio. Each of those is a separate "can the device decode it" question, and
 *   each one that fails turns into a `TranscodeReason` on the server — i.e. a
 *   Fire TV Stick transcoding in real time, which is what this project is
 *   trying to avoid.
 *
 * How the codec is forced: `ShakaPlayer.load()` passes `content.vcodec` and
 * `content.acodec` straight through to Shaka's `preferredVideoCodecs` /
 * `preferredAudioCodecs`. Apple's test masters carry every audio rendition in
 * one playlist, so setting `acodec` is what actually selects AC-3 over AAC.
 * ABR is disabled in `VideoHandler`, so the preference decides the variant.
 *
 * Caveat: the Vega Virtual Device is x86_64 software decode. A stream that
 * plays on the VVD is not proof it plays on an armv7 Fire TV Stick, and a
 * stream that fails on the VVD may still work on real hardware. Treat VVD
 * results as a first signal; re-run this screen on a stick before locking down
 * the Jellyfin DeviceProfile in Phase 3.
 */
import { TitleData } from '../types/TitleData';

/** Apple's fMP4 (CMAF) test master: H.264 with AAC, AC-3 and E-AC-3 renditions. */
const APPLE_FMP4 =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8';

/** Apple's HEVC test master: adds hvc1.2.4.L123.B0 variants alongside H.264. */
const APPLE_HEVC =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8';

/** Fields every TitleData needs but which carry no meaning for the spike. */
const COMMON = {
  description: '',
  mediaType: 'video' as const,
  mediaSourceType: 'url' as const,
  categories: [],
  channelID: '',
  posterUrl: '',
  rentAmount: '',
  secure: false,
  uhd: false,
};

export interface SpikeStream extends TitleData {
  /** What a pass or fail here tells us about the Jellyfin integration. */
  rationale: string;
}

export const SPIKE_STREAMS: SpikeStream[] = [
  {
    ...COMMON,
    id: 'ts-h264-aac',
    title: 'HLS / MPEG-TS — H.264 + AAC',
    uri: 'https://storage.googleapis.com/shaka-demo-assets/bbb-dark-truths-hls/hls.m3u8',
    format: 'HLS',
    vcodec: 'avc1',
    acodec: 'mp4a',
    rationale:
      'Control. This is the stream the unmodified sample shipped with, so a ' +
      'failure here means the spike setup is broken, not the codec.',
  },
  {
    ...COMMON,
    id: 'fmp4-h264-aac',
    title: 'HLS / fMP4 — H.264 + AAC',
    uri: APPLE_FMP4,
    format: 'HLS',
    vcodec: 'avc1',
    acodec: 'mp4a',
    rationale:
      'The baseline Jellyfin DirectStream shape. If this fails, DirectStream ' +
      'is off the table entirely and every title has to be transcoded.',
  },
  {
    ...COMMON,
    id: 'fmp4-h264-ac3',
    title: 'HLS / fMP4 — H.264 + AC-3',
    uri: APPLE_FMP4,
    format: 'HLS',
    vcodec: 'avc1',
    acodec: 'ac-3',
    rationale:
      'AC-3 passthrough. Common in DVD-era remuxes. A failure means the ' +
      'DeviceProfile must exclude ac3 and let the server transcode audio.',
  },
  {
    ...COMMON,
    id: 'fmp4-h264-eac3',
    title: 'HLS / fMP4 — H.264 + E-AC-3',
    uri: APPLE_FMP4,
    format: 'HLS',
    vcodec: 'avc1',
    acodec: 'ec-3',
    rationale:
      'E-AC-3 (Dolby Digital Plus) passthrough. Common in Blu-ray and ' +
      'streaming rips; same DeviceProfile consequence as AC-3.',
  },
  {
    ...COMMON,
    id: 'fmp4-hevc-aac',
    title: 'HLS / fMP4 — HEVC + AAC',
    uri: APPLE_HEVC,
    format: 'HLS',
    vcodec: 'hvc1',
    acodec: 'mp4a',
    rationale:
      'HEVC decode. Nearly every 4K remux is HEVC, and software-transcoding ' +
      'HEVC on a Fire TV Stick is not viable, so this decides whether 4K ' +
      'content is usable at all.',
  },
  {
    ...COMMON,
    id: 'fmp4-hevc-eac3',
    title: 'HLS / fMP4 — HEVC + E-AC-3',
    uri: APPLE_HEVC,
    format: 'HLS',
    vcodec: 'hvc1',
    acodec: 'ec-3',
    rationale:
      'The realistic 4K remux combination. Both halves have to pass at once ' +
      'for a 4K title to DirectStream.',
  },
  {
    ...COMMON,
    id: 'dash-h264',
    title: 'DASH / fMP4 — H.264',
    uri: 'https://dash.akamaized.net/envivio/dashpr/clear/Manifest.mpd',
    format: 'MPD',
    vcodec: 'avc1',
    acodec: 'mp4a',
    rationale:
      'Cross-check against the other adaptive protocol. Jellyfin can emit ' +
      'DASH as well as HLS, so this is the fallback if HLS misbehaves.',
  },
  {
    ...COMMON,
    id: 'progressive-mp4',
    title: 'Progressive MP4 — H.264 + AAC',
    // Not the sample's MP4 fixture: edge-vod-media.cdn01.net no longer resolves
    // from the device, which reads as a decode failure rather than a dead host.
    uri: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
    format: 'MP4',
    vcodec: 'avc1',
    acodec: 'mp4a',
    rationale:
      'Bypasses Shaka entirely and uses the static player. Jellyfin can serve ' +
      'a raw MP4 via /Videos/{id}/stream, which would be true direct play.',
  },
];
