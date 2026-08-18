import AsyncStorage from '@react-native-async-storage/async-storage';
import { KeyValueStore } from './KeyValueStore';

/**
 * The on-device implementation of KeyValueStore.
 *
 * Isolated in its own file so nothing else under `src/jellyfin/` imports a
 * React Native module — that is what keeps the rest of the client runnable and
 * testable under Node.
 *
 * AsyncStorage is plaintext. That is acceptable for a Jellyfin access token,
 * which is scoped to one device and revocable from the server dashboard; it
 * would not be acceptable for anything with wider reach, which is one more
 * reason this project does not embed an admin API key.
 */
export const asyncKeyValueStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
