import { MediaItem } from '../blocks/types';

export type MimeType =
  | 'text/plain'
  | 'text/vtt'
  | 'application/x-subtitle' // .srt
  | 'application/x-subtitle-vtt' // .vtt
  | 'application/x-subtitle-sami'
  | 'application/x-subtitle-tmplayer'
  | 'application/x-subtitle-mpl2'
  | 'application/x-subtitle-dks'
  | 'application/x-subtitle-qttext'
  | 'application/x-subtitle-lrc';

export type VideoFormat = 'MPD' | 'HLS' | 'MP4' | 'DASH';

interface TextTrack {
  label: string;
  language: string;
  uri: string;
  mimeType: MimeType;
}

export interface TitleData extends MediaItem {
  title: string;
  uri: string;
  categories: string[];
  channelID: string;
  posterUrl: string;
  format: string;
  descriptionType?: string;
  drm_scheme?: string;
  drm_license_uri?: string;
  textTrack?: TextTrack[];
  uhd: boolean;
  secure: boolean;
  acodec?: string;
  vcodec?: string;
  rentAmount: string;
  bifUrl?: string;
  thumbnailUrl?: string;
  /**
   * Where playback should begin, in seconds. Handed to Shaka at load time
   * rather than seeked to afterwards: Shaka applies it while buffering the
   * first segments, so playback starts at the resume point instead of
   * starting at zero and jumping.
   */
  startTimeSeconds?: number;
}
