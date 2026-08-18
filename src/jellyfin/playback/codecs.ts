/**
 * Jellyfin names codecs the way ffmpeg does; Shaka wants the MP4 registration
 * names it can hand to MediaSource. `h264` and `avc1` are the same decoder,
 * but only one of them survives `isTypeSupported`.
 *
 * These feed `TitleData.vcodec` / `acodec`, which ShakaPlayer passes through
 * as `preferredVideoCodecs` / `preferredAudioCodecs`. They are hints — the
 * playback spike found Shaka will happily choose a different variant — so
 * getting them wrong degrades selection rather than breaking playback.
 */

const VIDEO_CODECS: Record<string, string> = {
  h264: 'avc1',
  avc: 'avc1',
  avc1: 'avc1',
  hevc: 'hvc1',
  h265: 'hvc1',
  hvc1: 'hvc1',
  hev1: 'hvc1',
  vp9: 'vp09',
  av1: 'av01',
};

const AUDIO_CODECS: Record<string, string> = {
  aac: 'mp4a',
  mp4a: 'mp4a',
  mp3: 'mp4a.40.34',
  ac3: 'ac-3',
  eac3: 'ec-3',
  flac: 'flac',
  opus: 'opus',
};

export const toShakaVideoCodec = (codec?: string | null): string | undefined =>
  codec ? VIDEO_CODECS[codec.toLowerCase()] : undefined;

export const toShakaAudioCodec = (codec?: string | null): string | undefined =>
  codec ? AUDIO_CODECS[codec.toLowerCase()] : undefined;
