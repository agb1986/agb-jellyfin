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
