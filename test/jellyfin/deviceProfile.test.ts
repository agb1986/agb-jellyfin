import { buildDeviceProfile } from '../../src/jellyfin/deviceProfile';

describe('buildDeviceProfile', () => {
  it('asks for fragmented MP4 over HLS, which is what the spike proved plays', () => {
    // Container mp4 + protocol hls is what makes Jellyfin emit CMAF segments
    // rather than MPEG-TS. Getting this wrong silently changes what the
    // server sends.
    const video = buildDeviceProfile().TranscodingProfiles?.find(
      (p) => p.Type === 'Video',
    );
    expect(video?.Container).toBe('mp4');
    expect(video?.Protocol).toBe('hls');
  });

  it('does not claim HEVC by default', () => {
    // The virtual device advertised HEVC support via isTypeSupported and then
    // failed to decode it. Claiming it would make the server hand over streams
    // that do not play.
    const profile = buildDeviceProfile();
    const codecs = profile.TranscodingProfiles?.map((p) => p.VideoCodec).join();
    expect(codecs).toContain('h264');
    expect(codecs).not.toContain('hevc');
  });

  it('claims HEVC once hardware has been shown to decode it', () => {
    const profile = buildDeviceProfile({ supportsHevc: true });
    expect(
      profile.TranscodingProfiles?.find((p) => p.Type === 'Video')?.VideoCodec,
    ).toContain('hevc');
  });

  it('does not claim AC-3 or E-AC-3 by default', () => {
    // MediaSource.isTypeSupported returned false for both, and Shaka filtered
    // those variants out of the manifest entirely.
    const audio = buildDeviceProfile()
      .TranscodingProfiles?.map((p) => p.AudioCodec)
      .join();
    expect(audio).toContain('aac');
    expect(audio).not.toContain('ac3');
    expect(audio).not.toContain('eac3');
  });

  it('claims Dolby audio when told the device handles it', () => {
    const audio = buildDeviceProfile({ supportsDolbyAudio: true })
      .TranscodingProfiles?.map((p) => p.AudioCodec)
      .join();
    expect(audio).toContain('ac3');
    expect(audio).toContain('eac3');
  });

  it('leaves the bitrate effectively uncapped on a LAN', () => {
    // A 50 Mbps cap forces a transcode of any 4K remux, which is the exact
    // workload a Fire TV Stick cannot afford to make the server do.
    const profile = buildDeviceProfile();
    expect(profile.MaxStreamingBitrate).toBeGreaterThan(100_000_000);
  });

  it('honours an explicit bitrate cap', () => {
    expect(
      buildDeviceProfile({ maxStreamingBitrate: 20_000_000 })
        .MaxStreamingBitrate,
    ).toBe(20_000_000);
  });

  it('offers only text subtitle formats', () => {
    // Image subtitles (PGS, DVDSUB) cannot be handed to Shaka as a track, so
    // Jellyfin burns them in — which forces a full video transcode.
    const formats = buildDeviceProfile().SubtitleProfiles?.map((p) => p.Format);
    expect(formats).toEqual(
      expect.arrayContaining(['vtt', 'srt', 'subrip', 'webvtt']),
    );
    expect(formats).not.toContain('pgssub');
    expect(formats).not.toContain('dvdsub');
    expect(formats).not.toContain('ass');
  });

  it('never asks the server to burn subtitles in', () => {
    const methods = buildDeviceProfile().SubtitleProfiles?.map((p) => p.Method);
    expect(methods).not.toContain('Encode');
  });
});
