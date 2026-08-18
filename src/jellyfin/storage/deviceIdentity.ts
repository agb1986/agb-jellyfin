import { DeviceInfo } from '../authorization';
import { KeyValueStore } from './KeyValueStore';

/**
 * This device's identity, as Jellyfin sees it.
 *
 * The id must be **stable across launches and unique across sticks**. Jellyfin
 * keys sessions, playback reporting, resume points and token revocation off it,
 * so two devices sharing an id show up as one in the dashboard and fight over
 * Continue Watching. It is generated once and persisted; it is deliberately
 * not derived from the build, the package name, or anything else five
 * identical sideloads would agree on.
 */

export const DEVICE_ID_KEY = 'jellyfin.deviceId';

/** Hex characters in a generated id. 32 gives UUID-equivalent width. */
const DEVICE_ID_LENGTH = 32;

/**
 * Generates a random hex id.
 *
 * Prefers `crypto.getRandomValues` where the runtime provides it and falls
 * back to Math.random otherwise. The fallback is fine here: this is an
 * identifier, not a secret — knowing it grants nothing without the access
 * token, which is issued per device by the server.
 */
export const generateDeviceId = (): string => {
  const bytes = new Uint8Array(DEVICE_ID_LENGTH / 2);
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;

  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Returns this device's persisted id, creating and storing one on first run.
 *
 * @param deviceName shown in the Jellyfin dashboard and on the Quick Connect
 *   approval prompt, so it should be something a person recognises — "Living
 *   Room", not a serial number.
 */
export const loadDeviceInfo = async (
  store: KeyValueStore,
  deviceName: string,
): Promise<DeviceInfo> => {
  // A broken store must not stop the app from running. Persistence is what
  // makes the id stable, not what makes it work: without it the device simply
  // looks new to the server on each launch, which is worse than nothing
  // persisting but far better than a screen the user cannot get past.
  try {
    const existing = await store.getItem(DEVICE_ID_KEY);
    if (existing) {
      return { name: deviceName, id: existing };
    }
  } catch (error) {
    console.warn(
      `[jellyfin] could not read the stored device id: ${(error as Error).message}`,
    );
    return { name: deviceName, id: generateDeviceId() };
  }

  const id = generateDeviceId();
  try {
    await store.setItem(DEVICE_ID_KEY, id);
  } catch (error) {
    console.warn(
      `[jellyfin] could not persist the device id, so this device will look new on every launch: ${(error as Error).message}`,
    );
  }
  return { name: deviceName, id };
};
