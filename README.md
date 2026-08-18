# agb-jellyfin

A [Jellyfin](https://jellyfin.org/) client for **Amazon Vega OS** Fire TV Sticks.

Vega OS is not Android, so the existing Jellyfin Android/Fire OS app cannot run on it,
and no Jellyfin client exists for the platform. This is one.

## Origin

Forked from [`AmazonAppDev/vega-video-sample`](https://github.com/AmazonAppDev/vega-video-sample)
(MIT-0) at `ef8e4da` — React Native 0.83, `@amazon-devices/*` Kepler packages, and
Shaka Player via `@amazon-devices/react-native-w3cmedia`. The upstream `LICENSE` and
`LICENSE-THIRD-PARTY` are retained.

A pristine copy of the upstream sample is kept beside this repo at
`../vega-video-sample` for diffing and re-pulling.

## Prerequisites

| Requirement | Notes |
|---|---|
| Ubuntu 20.04+ | Verified on 24.04 |
| **JRE 21+** | Needed by the Shaka build during `npm install` |
| **Node** | Verified on **v22.14.0**. `package.json` `engines` requires `>=22`; upstream's README claims v18–v20, which is stale for this branch. |
| Python 3 | Verified on 3.12 |
| Vega SDK + CLI | `curl -fsSL https://sdk-installer.vega.labcollab.net/get_vvm.sh \| bash && source ~/vega/env` |

Verified against SDK 0.24.9914 / Vega CLI 1.3.4.

## Build and run

```bash
source ~/vega/env
npm install                 # also clones + builds Shaka Player (see caveat below)
npm run build:app           # produces .vpkg for all targets

vega virtual-device start
vega run-app build/x86_64-release/agbjellyfin_x86_64.vpkg
```

Artifacts land in `build/{armv7,x86_64,aarch64}-{release,debug}/`.
**armv7** is the Fire TV Stick; **x86_64** is the Vega Virtual Device on the host.

Useful checks:

```bash
vega device list            # lists the VVD and any connected sticks
vega device running-apps    # confirm the app is actually running
```

### Caveat: `npm install` and flaky networks

`shaka-setup/build.sh` (run from `postinstall`) does a plain full `git clone` of
`shaka-project/shaka-player`. On a connection that drops long TLS transfers this
fails repeatedly — `curl 92`, `curl 56`, and `curl 18` mid-transfer disconnects — and
the script's `ERR` trap rolls back, so retrying `npm install` alone gets nowhere.

Workaround — pre-populate the clone, then let `postinstall` take its
"repository already exists" path:

```bash
cd shaka-setup
# single-branch: --no-single-branch pulls 42k objects and will not complete
until git -c http.version=HTTP/1.1 clone --depth 1 --branch v4.8.5 \
      https://github.com/shaka-project/shaka-player.git shaka-player; do
  rm -rf shaka-player; echo retrying; sleep 5
done
cd shaka-player && git branch main HEAD && git branch amz_4.8.5 HEAD && cd ../..
npm install
```

`build.sh` aborts unless both a `main` branch and an `amz_4.8.5` branch exist, hence
the two `git branch` calls. The shallow history does not upset the `git am -3` patch
application.

## Configuration

Jellyfin server details are **not** checked in. `react-native-dotenv` is wired
into `babel.config.js`, so a `.env` at the repo root feeds the virtual `@env`
module:

```bash
cp .env.example .env
# JELLYFIN_SERVER_URL=http://192.168.1.10:8096
```

Read it through `src/config/JellyfinConfig.ts` (`getDevServerUrl()`), never by
importing `@env` directly — that keeps the "not set" case in one place. With no
`.env` present the value inlines as `undefined` and the build still succeeds.

**`.env` is not a secret store.** The plugin substitutes values at build time,
so they become plain strings inside the JavaScript bundle, inside the `.vpkg`
that gets sideloaded onto every stick. Anyone holding a `.vpkg` can read them.
Only non-secrets belong there: the server URL is a development convenience so a
build can reach a server before the setup screen exists. Credentials come from
Quick Connect at runtime and are stored per device.

## Jellyfin API client

`src/jellyfin/` is the server half of the app: plain `fetch`, no React, no
device APIs, so it runs and is tested under Node. `test/jellyfin/` covers it
with an injected `fetchImpl` — there is no network in the suite.

| Module | Role |
|---|---|
| `JellyfinHttp` | transport: base URL, `Authorization` header, query building, timeouts, typed errors |
| `JellyfinClient` | the endpoints — system info, library, `PlaybackInfo`, playback reporting |
| `quickConnect` | the device-code sign-in flow, including the polling loop |
| `deviceProfile` | the DeviceProfile sent with `PlaybackInfo` |
| `authorization` | builds the `MediaBrowser` header |
| `errors` | network / timeout / API failures as distinct types |

### Why not `@jellyfin/sdk` at runtime

Jellyfin publishes an official TypeScript SDK, and it does bundle — Metro
handled it, ESM and all. It is used here **for its generated types only**,
which are `import type` and therefore erased at build time. Measured against
the same baseline bundle:

| | Added to the bundle |
|---|---|
| SDK runtime (`new Jellyfin(...)`) + axios | ~134 KB |
| This client, SDK types only | ~16 KB |

The SDK also needs axios, whose React Native behaviour on Vega is unverified,
and the endpoints that matter most here — `PlaybackInfo` with a hand-tuned
DeviceProfile — are exactly the ones worth controlling directly. `@jellyfin/sdk`
is therefore a **devDependency**: importing a runtime value from it would fail
the build, which is the intended guard rail.

### Sign-in

Quick Connect only. The user never types a password on a D-pad, and no shared
API key ships inside the `.vpkg`. The token that comes back is per-device and
revocable from the Jellyfin dashboard, which is why `DeviceInfo.id` must be
stable per stick and unique across them.

Not yet wired up: persisting the token and device id (AsyncStorage), and the
screens. The client itself takes them as inputs.

## What was stripped from the sample

The sample ships features a Jellyfin client has no use for. All of them are gone —
manifest entries, dependencies, and source:

| Feature | What went |
|---|---|
| **LiveTV** | EPG sync source component, EPG sync + install/update tasks, `src/livetv/`, `LiveForceSync.tsx` |
| **In-App Purchasing** | services and modules, `src/iap/`, the Rent / Purchase Subscription buttons on Details |
| **Content Personalization** | data refresh service, datastore, privileges, `src/personalization/`, every `reportNew*` call in the player and tiles |
| **Content Launcher** | the external launch handler on Home |
| **Account Login** | `AccountLoginWrapper`, the Settings login toggle |
| **Headless tasks** | `service.js`, `task.js`, `src/headless/` |

Retained: the single interactive component, media/audio/network/DRM privileges, and
**Vega Media Controls** (`IMediaPlaybackServer`) for transport controls during playback.

The redux `loginStatus` slice survives — it is self-contained and will likely back
Jellyfin's own auth state.

### Editing the manifest is not enough

`npm run build:app` **rewrites `manifest.toml` in place**, appending a
`[[needs.module]]` entry for every native module the JS dependency tree autolinks.
The first build after the manifest strip grew the file from 178 to 319 lines and put
back modules for exactly the features that had been removed:

```
/com.amazon.kepler.kepler_epg_provider_1@IKeplerEpgProvider_9
/com.amazon.kepler.kepler_content_personalization_1@IKeplerContentPersonalization_3
/com.amazon.kepler.kepler_media_account_login_1@IKeplerMediaAccountLogin_1
/com.amazon.kepler.appstore_iap_lib_2@IAppstoreIapLib_12
...
```

Autolinking keys off `package.json` **dependencies**, not off the manifest, so
hand-editing `[needs]` gets reverted on the next build. Dropping a feature takes
three steps, in order:

1. remove every import of it from `src/` (and its tests)
2. remove its `@amazon-devices/*` entry from `package.json`, then `npm prune` —
   the autolinker reads `node_modules`, so leaving the package installed keeps the
   module in the manifest even after `package.json` no longer lists it
3. delete the stale `[[needs.module]]` block from `manifest.toml`

The manifest now sits at 295 lines / 26 modules and survives a rebuild unchanged.

## Status

Phase 0 (toolchain + unmodified sample running on the VVD) is complete, the port to
this repo is done, and the **playback spike** has run on the virtual device. Results
are in [`docs/playback-spike-results.md`](docs/playback-spike-results.md); the short
version is that fragmented-MP4 HLS plays, which is what Jellyfin DirectStream emits,
while AC-3/E-AC-3 audio is unavailable and HEVC fails on the virtual device. The
HEVC result in particular is expected to change on real armv7 hardware.

Note that Shaka consumes DASH/HLS only, so direct play of MKV is off the table; the
realistic target is Jellyfin **DirectStream** (remux to fMP4/HLS) rather than a full
transcode. See `HANDOFF.md` for the full plan.

### Running the spike

The spike is dev scaffolding and is currently the app's launch screen, gated by
`isPlaybackSpikeEnabled()` in `src/config/AppConfig.ts`. It runs unattended — the
Vega CLI cannot inject D-pad input — and takes about four minutes:

```bash
vega run-app build/x86_64-release/agbjellyfin_x86_64.vpkg
vega device start-log-stream | grep SPIKE_RESULT
```

Set the flag to `false` to get the sample's own UI back.
