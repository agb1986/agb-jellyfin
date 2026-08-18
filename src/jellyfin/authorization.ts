/**
 * Jellyfin identifies a client with an `Authorization: MediaBrowser ...` header
 * rather than a query parameter. That matters here: the access token stays out
 * of request URLs, and therefore out of the server's access logs.
 */

/** Identifies this application to the server. Shown in the Jellyfin dashboard. */
export interface ClientInfo {
  name: string;
  version: string;
}

/**
 * Identifies this device. `id` must be stable across launches and unique per
 * stick — Jellyfin keys sessions, playback state and token revocation off it,
 * so two devices sharing an id collide in the dashboard and in Continue
 * Watching. Generate it once and persist it; never derive it from the build.
 */
export interface DeviceInfo {
  name: string;
  id: string;
}

/**
 * Builds the value of the `Authorization` header.
 *
 * Field order and the `encodeURIComponent` call match Jellyfin's own SDK
 * (`@jellyfin/sdk/lib/utils/authentication`); the encoding is what keeps a
 * quote or comma in a device name from splitting the header into extra fields.
 *
 * @param accessToken empty before sign-in — the header is still required, as
 *   the server reads Client/Device/DeviceId on unauthenticated calls too.
 */
export const buildAuthorizationHeader = (
  clientInfo: ClientInfo,
  deviceInfo: DeviceInfo,
  accessToken = '',
): string => {
  return [
    `MediaBrowser Client="${encodeURIComponent(clientInfo.name)}"`,
    `Device="${encodeURIComponent(deviceInfo.name)}"`,
    `DeviceId="${encodeURIComponent(deviceInfo.id)}"`,
    `Version="${encodeURIComponent(clientInfo.version)}"`,
    `Token="${encodeURIComponent(accessToken)}"`,
  ].join(', ');
};

export const AUTHORIZATION_HEADER = 'Authorization';
