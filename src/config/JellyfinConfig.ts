import { JELLYFIN_SERVER_URL } from '@env';

/**
 * Build-time Jellyfin configuration.
 *
 * `@env` values are inlined into the bundle by react-native-dotenv, so this
 * file may only ever carry non-secrets. Credentials — the access token from
 * Quick Connect — are obtained at runtime and stored per device; they must not
 * pass through here, because the bundle ships inside a .vpkg that is sideloaded
 * onto every stick.
 */

/**
 * Strips whitespace and any trailing slashes so callers can concatenate paths
 * without doubling separators. Returns undefined for a missing or blank value.
 */
const normalizeServerUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, '');
};

const devServerUrl = normalizeServerUrl(JELLYFIN_SERVER_URL);

/**
 * Server address baked in from `.env` at build time, or undefined if none was
 * set. This is a development convenience for reaching a server before the
 * setup screen exists — it is a default, not the source of truth. Once a
 * server address is stored on the device, that value wins.
 *
 * @returns the base URL with no trailing slash, or undefined.
 */
const getDevServerUrl = (): string | undefined => {
  return devServerUrl;
};

export { getDevServerUrl };
