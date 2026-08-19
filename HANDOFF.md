# Handoff — Jellyfin client for Vega OS Fire TV Sticks

**Written:** 2026-08-13 · **Repo:** `/home/agb86/workspace/repos/agb-jellyfin` (empty, one empty commit) · **Remote:** https://github.com/agb1986/agb-jellyfin (public)

**Next session focus:** carry out the build. This doc is the work plan and the step sequence.

---

## 1. Read these first (do not re-derive)

Verified findings already live in the project memory directory — read them before acting, they overturn several claims in the source material:

- `~/.claude/projects/-home-agb86-workspace-repos-agb-jellyfin/memory/vega-handoff-doc-unreliable.md` — what is verified true vs. false about the Vega toolchain, the `vega` CLI, npm registry access, and `manifest.toml` schema.
- `~/.claude/projects/-home-agb86-workspace-repos-agb-jellyfin/memory/jellyfin-vega-project.md` — project premise and motivation.

**Upstream reference implementation:** https://github.com/AmazonAppDev/vega-video-sample — React Native 0.83, Shaka Player via `@amazon-devices/react-native-w3cmedia`, focus management, W3C media. This is the base to fork. Its `README.md`, `package.json`, and `manifest.toml` are the authoritative schema/command references; prefer them over any prose doc.

**Vega docs (version-pinned; `latest` redirects):** https://developer.amazon.com/docs/vega/0.24/

> ⚠️ The user was given a "Jellyfin Vega App - Local Deployment Handoff" doc (v1.0, Aug 2026). It is roughly half fabricated. Treat every command in it as unverified. Corrections are in the memory file above.

---

## 2. Environment state

| Item | Status |
|---|---|
| Ubuntu 24.04.4 LTS, x86_64, 1.7T free | ✅ supported (docs say 20.04+) |
| Node v22.14.0 / npm 11.10.0 | ⚠️ version conflict — see risks |
| Python 3.12.3 | ⚠️ docs mention python3.8 / libpython3.8-dev on Ubuntu |
| Docker | ✅ present |
| **Java** | ❌ **not installed** — required (JRE 21+) |
| **Vega SDK / `vega` CLI** | ❌ **not installed** |
| Jellyfin server | Assumed reachable at `http://<JELLYFIN_SERVER>:8096`; confirm with user |

No gated access is required: `@amazon-devices/*` packages are on the **public npm registry**, and the SDK installer contains no login/token step.

---

## 3. Work to carry out

### Phase 0 — Toolchain up (blocking, ~1 hr)

```bash
sudo apt-get install -y openjdk-21-jdk          # shaka-setup runs on npm postinstall
curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh | bash && source ~/vega/env
vega --version

git clone https://github.com/AmazonAppDev/vega-video-sample.git
cd vega-video-sample && npm install && npm run build:app

vega virtual-device start
vega run-app build/x86_64-release/keplervideoapp_x86_64.vpkg
```

**Exit criterion:** unmodified sample runs on the Vega Virtual Device. No Fire TV hardware needed for this phase — the VVD runs on the x86_64 host.

### Phase 1 — Playback spike ⭐ (the project's make-or-break)

Everything downstream depends on this. Do it before writing any app code.

1. Pick one item from the Jellyfin library; get its HLS URL (`/Videos/{id}/master.m3u8`).
2. Hardcode it into the sample's player screen (see `src/w3cmedia/`).
3. Run on the VVD and observe.

**Question being answered:** can Vega's Shaka integration play what this Jellyfin server emits? Note Shaka consumes DASH/HLS only — **direct play of MKV is off the table**, so the realistic target is Jellyfin *DirectStream* (remux to fMP4/HLS, cheap) rather than *Transcode* (full re-encode, expensive).

**If this fails, stop and reassess before building anything else.**

### Phase 2 — DeviceProfile calibration ⭐

The single biggest omission in the source doc. Determines whether five sticks remux or melt the server.

1. **Library survey.** Script the Jellyfin API to tabulate every item's container, video codec, audio codec, subtitle format, bitrate, HDR flag. Output a table of what the profile must handle.
2. **Probe loop.** `POST /Items/{id}/PlaybackInfo` with a candidate DeviceProfile. The response states whether Jellyfin chose DirectPlay / DirectStream / Transcode, plus a `TranscodeReasons` field explaining why. Pure HTTP — iterate without any device.
3. Tune until the worst offenders from step 1 direct-stream. Watch server CPU to confirm.

**Known traps:**
- `maxBitrate: 50000000` (from the source doc) is backwards — a 4K remux runs 60–100 Mbps, so a 50 Mbps cap *forces* transcode. On LAN, no cap.
- PGS/ASS subtitles can't be handed to Shaka as text → Jellyfin burns them in → forces full video transcode. Decide a strategy (prefer SRT/WebVTT; possibly convert server-side offline).
- EAC3/Atmos gets downmixed to stereo AAC unless the profile declares support.
- HDR tone-mapping on transcode is very expensive.

### Phase 3 — Device enablement (parallelisable with 1–2)

Per stick, one-time. **USB cable required first** — network mode can only be enabled from an established USB connection.

```bash
# On stick: Settings > My Fire TV > About > press center on DEVICE NAME 7x > Continue
# Note the 6-digit code (5 min expiry) AND the IP address (see trap below)

vega devmode login                              # browser auth, Amazon dev account
vega devmode enable-device --code <6-digit>

vega exec vda tcpip 5555
vega exec vda connect <device_ip>:5555          # device reboots

vega device list
vega device -d <DSN> install-app --packagePath build/armv7-release/<app>_armv7.vpkg
vega device -d <DSN> launch-app --appName <component-id>
```

**Traps:** capture the IP *before* switching to TCP/IP (unretrievable over USB afterwards) · disabling Developer Mode requires a **factory reset** · only non-`com.amazon` package IDs may be sideloaded (`com.amazondeveloper.*` is fine — don't shorten it).

### Phase 4 — Build the app

Ordered by risk, not by visibility. The Jellyfin half is plain HTTP and unit-testable under Node without any device.

1. **Auth — Jellyfin Quick Connect.** `/QuickConnect/Initiate` → poll → `/Users/AuthenticateWithQuickConnect`. Purpose-built device-code flow for TVs. **Do not embed an admin API key** (the source doc's approach): Jellyfin API keys are non-expiring, effectively server-wide, travel as `?api_key=` in URLs (→ server logs), and would be extractable from any of five sideloaded devices. Per-device tokens also make per-user watch state work for free.
2. **API client + types.** Generate TypeScript types from the server's OpenAPI spec rather than hand-writing. Client is ordinary `fetch`.
3. **Playback reporting.** `/Sessions/Playing`, `/Sessions/Playing/Progress` (~10s interval), `/Sessions/Playing/Stopped`. This is what makes resume, watched state, and Continue Watching work. **Server-side, not AsyncStorage** — the source doc stores locally while simultaneously promising cross-device resume; those contradict.
4. **`manifest.toml`.** Rewrite by editing the sample's real one. Correct IDs, drop LiveTV/EPG/IAP components, keep media/audio/network privileges. The source doc's manifest is fabricated — no `android.permission.*` exists on Vega.
5. **Screens.** Home (libraries), Details (metadata + resume), Player, Search. Largely adapting sample screens to Jellyfin's data model.
6. **Focus / D-pad.** Sample already demonstrates the patterns.
7. **Config.** `.env` is read via `react-native-dotenv` (`import { X } from '@env'`) — **not** `process.env`, which does not exist at RN runtime. Values are inlined at build time, so they are not secrets.

### Phase 5 — Fleet & maintenance

- Deploy script iterating DSNs from `vega device list` (parse its real output — the source doc's `grep -o 'ID: '` pattern is invented).
- Update strategy: sideloaded apps do not auto-update. Decide how five sticks get new builds over time.
- CI: Jest is already fully configured in the sample and unused.

---

## 4. Open questions for the user

1. Jellyfin server URL + a token/credentials for the survey and probe work (Phases 2).
2. How many sticks, and are they already purchased? (Affects whether Phase 3's per-stick USB pairing is worth it vs. swapping hardware.)
3. Library composition — mostly remuxes, or transcoded already? Changes Phase 2's difficulty materially.

## 5. Risks

- **Node version conflict, unresolved.** SDK docs say 18+, sample README says 18–20, sample `package.json` `engines` says `>=22`. User has 22.14.0. If `npm install` misbehaves, `nvm use 20`.
- **Python 3.8 vs 3.12.** Ubuntu 24.04 ships 3.12; Vega Ubuntu docs reference python3.8/libpython3.8-dev. May need attention during SDK install.
- **The SDK installer is a piped shell script** (`curl … | bash`) from `labcollab.net`, ~20GB, modifies shell profile. It is the officially documented command and was read during this session (no auth/login steps, pulls from public Artifactory). User has not yet green-lit running it.
- **Phase 1 is an unhedged bet.** If Vega+Shaka can't play Jellyfin's output acceptably, the project has no cheap fallback.

---

## 6. Suggested skills

| Skill | Use for |
|---|---|
| `mattpocock-skills:prototype` | Phase 1 playback spike — throwaway code to answer one design question. Exactly its purpose. |
| `mattpocock-skills:research` | Phase 2/3 specifics against primary sources (Jellyfin API, Vega docs). Captures findings as Markdown in-repo, which this project badly needs. |
| `mattpocock-skills:domain-modeling` | Record ADRs for decisions already made (HLS-only, Quick Connect, server-side progress) plus Jellyfin/Vega vocabulary. |
| `mattpocock-skills:tdd` | Phase 4.1–4.3 (auth, API client, playback reporting) — pure HTTP, no device, ideal test-first. |
| `mattpocock-skills:codebase-design` | Seam between the Jellyfin service layer and the Vega/RN UI layer. Keeping it clean is what makes the API half testable without hardware. |
| `mattpocock-skills:diagnosing-bugs` | When Phase 1 or 2 misbehaves — playback failures here are opaque and multi-layered. |
| `security-review` | Before shipping to the fleet — token storage, transport, what ends up inlined in the bundle. |
| `run` | Launching the app on VVD / stick once Phase 0 lands. |

---

## 7. Style note

The user asked for analysis and opinion, pushed back productively, and caught the value in verification over recall. Two of this session's claims were wrong (the `vega` CLI was called fabricated; npm registry access was called gated) — both were corrected after checking primary sources. **Verify against the sample repo and version-pinned Vega docs before asserting anything about this toolchain.**
