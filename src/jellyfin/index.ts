/**
 * Public surface of the Jellyfin client.
 *
 * `storage/asyncStorage` is deliberately NOT re-exported here: it is the only
 * file in this directory that imports React Native, and keeping it off the
 * barrel is what lets the rest be imported (and tested) under plain Node.
 * The app wires it in explicitly.
 */
export {
  AUTHORIZATION_HEADER,
  buildAuthorizationHeader,
  type ClientInfo,
  type DeviceInfo,
} from './authorization';
export { buildDeviceProfile, type DeviceProfileOptions } from './deviceProfile';
export {
  JellyfinApiError,
  JellyfinNetworkError,
  JellyfinTimeoutError,
} from './errors';
export {
  JellyfinClient,
  type ItemsQuery,
  type JellyfinClientOptions,
  type PlaybackInfoOptions,
  type PlaybackProgress,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksToSeconds,
} from './JellyfinClient';
export {
  JellyfinSession,
  type JellyfinSessionOptions,
} from './JellyfinSession';
export {
  JellyfinHttp,
  type JellyfinHttpOptions,
  type RequestOptions,
} from './JellyfinHttp';
export {
  authenticateWithQuickConnect,
  initiateQuickConnect,
  isQuickConnectAuthorized,
  isQuickConnectEnabled,
  QuickConnectCancelledError,
  type QuickConnectInitiation,
  QuickConnectTimeoutError,
  waitForQuickConnect,
  type WaitForQuickConnectOptions,
} from './quickConnect';
export {
  CREDENTIALS_KEY,
  clearCredentials,
  type JellyfinCredentials,
  loadCredentials,
  saveCredentials,
} from './storage/credentialStore';
export {
  DEVICE_ID_KEY,
  generateDeviceId,
  loadDeviceInfo,
} from './storage/deviceIdentity';
export {
  type KeyValueStore,
  MemoryKeyValueStore,
} from './storage/KeyValueStore';
export {
  toShakaAudioCodec,
  toShakaVideoCodec,
} from './playback/codecs';
export {
  NoPlayableSourceError,
  type PlaybackTarget,
  type PlayMethod,
  resolvePlaybackTarget,
} from './playback/resolvePlayback';
