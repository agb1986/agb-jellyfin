# Playback spike results

**Date:** 2026-08-17
**Device:** Vega Virtual Device (x86_64), SDK 0.24.9914, Vega CLI 1.3.4
**Build:** `agbjellyfin_x86_64.vpkg`, Release, Shaka Player 4.8.5 via
`@amazon-devices/react-native-w3cmedia`

This is Phase 1 of `HANDOFF.md`: proving that Vega's Shaka integration can play
what a Jellyfin server emits. It was run without a Jellyfin server, against
public test streams chosen to match Jellyfin's output shapes.

Harness: `src/screens/PlaybackSpikeRunnerScreen.tsx` and `src/spike/spikeStreams.ts`.
It runs unattended (the Vega CLI cannot inject D-pad input) and prints results to
the device log behind the marker `SPIKE_RESULT`:

```bash
vega run-app build/x86_64-release/agbjellyfin_x86_64.vpkg
vega device start-log-stream | grep SPIKE_RESULT
```

A run takes roughly four minutes.

## Read this before trusting the table

**These are virtual-device results.** The VVD is x86_64 with software decode. A
Fire TV Stick is armv7 with a hardware decoder, and the two disagree in both
directions. Nothing here is final until the same harness is run on a stick —
that is the first thing to do once hardware is available.

## Results

| Stream | Container | Video | Audio | Verdict |
|---|---|---|---|---|
| `ts-h264-aac` | HLS / MPEG-TS | H.264 | AAC | **PASS** |
| `fmp4-h264-aac` | HLS / fMP4 | H.264 | AAC | **PASS** |
| `fmp4-h264-ac3` | HLS / fMP4 | H.264 | AC-3 | **MISMATCH** — AC-3 never offered |
| `fmp4-h264-eac3` | HLS / fMP4 | H.264 | E-AC-3 | **MISMATCH** — E-AC-3 never offered |
| `fmp4-hevc-aac` | HLS / fMP4 | HEVC | AAC | **FAIL** — player error |
| `fmp4-hevc-eac3` | HLS / fMP4 | HEVC | E-AC-3 | **FAIL** — player error |
| `dash-h264` | DASH / fMP4 | H.264 | AAC | **PASS** |
| `progressive-mp4` | MP4 | H.264 | AAC | **PASS** |

`MISMATCH` means playback worked but on a fallback variant — the requested codec
was never selectable, so the codec itself was not exercised.

## What MediaSource admits

Probed with `MediaSource.isTypeSupported` on the same device, before any stream
was loaded:

| Codec string | Supported |
|---|---|
| `video/mp4; codecs="avc1.640028"` | true |
| `video/mp4; codecs="hvc1.2.4.L123.B0"` | true |
| `video/mp4; codecs="hev1.2.4.L123.B0"` | true |
| `audio/mp4; codecs="mp4a.40.2"` | true |
| `audio/mp4; codecs="ac-3"` | **false** |
| `audio/mp4; codecs="ec-3"` | **false** |
| `audio/mp4; codecs="flac"` | true |
| `audio/mp4; codecs="opus"` | true |

## Conclusions

**Fragmented MP4 HLS works.** This was the make-or-break question, because
Jellyfin DirectStream remuxes into fMP4/CMAF and the sample app only ever
exercised MPEG-TS. H.264 + AAC in fMP4 plays, as does DASH and progressive MP4.
DirectStream is viable.

**AC-3 and E-AC-3 are not available on the virtual device.** `isTypeSupported`
returns false for both, so Shaka filters those variants out of the manifest
entirely: Apple's test master advertises AAC, AC-3 and E-AC-3 renditions, but the
variant list Shaka exposed contained only `mp4a.40.2`. Consequence for Phase 3:
unless a real stick says otherwise, the DeviceProfile must not claim `ac3` or
`eac3`, and any title with AC-3 or E-AC-3 audio will come back with an audio
`TranscodeReason`. Audio-only transcoding is cheap, so this is an annoyance
rather than a blocker — but it will show up on a large share of remuxes.

**HEVC advertises support and then fails.** `isTypeSupported` returns true for
both `hvc1` and `hev1`, Shaka selected an HEVC variant, and playback then raised
a player error. On the VVD this is expected — x86_64 software decode — and it is
the single result most likely to differ on real hardware, where Fire TV sticks
decode HEVC in hardware. **Do not build the DeviceProfile around this result.**

**`isTypeSupported` is not sufficient on its own.** HEVC returned true and did
not play. Any future capability detection has to confirm with actual playback,
which is what this harness does.

## Notes for whoever runs this next

Three things silently produced believable-but-wrong results while building the
harness; all are now guarded against, and all are worth knowing before changing
it.

1. **`VideoHandler` cannot be reused across streams.** It builds
   `preBufferVideo` and friends with `useCallback(..., [])` inside its
   constructor, so a handler constructed on a later render calls the *first*
   instance's methods, bound to the first instance's data. The first working
   version of this harness replayed stream one eight times and reported eight
   passes with identical variant data. Each stream now gets its own
   `<SpikeStreamProbe key={stream.id}>`.

2. **`preferredAudioCodecs` is a hint, not a constraint.** Shaka will happily
   play a different variant, which reports an AC-3 pass that was really AAC. The
   harness pins the variant with `selectVariantTrack` and refuses to call a
   stream a pass until the active variant matches what was asked for.

3. **Passing `componentInstance` to `preBufferVideo` hangs the run.**
   VideoHandler awaits `setMediaControlFocus`, and on the VVD that await never
   settles — the log stops at `KMC : set Media Control Focus` and `initialize()`
   is never reached. Media Controls are not what the spike measures, so it is
   omitted. This is worth revisiting for the real app, since Vega Media Controls
   is a manifest feature the app declares.

Two device-log quirks cost time as well: the log stream does not deliver an
app's first seconds of output (so anything printed at mount is lost, hence the
capability probe firing after the first stream settles), and the app crashed with
signal 6 on one run of eight — reruns were consistent, but a single run is not
proof.

## Still open

- Rerun on armv7 Fire TV Stick hardware. HEVC and the AC-3/E-AC-3 answers may
  all change.
- Nothing here touched a Jellyfin server. Phase 2 — the library survey and the
  `POST /Items/{id}/PlaybackInfo` probe loop that reads `TranscodeReasons` — is
  still blocked on the server URL and credentials.
