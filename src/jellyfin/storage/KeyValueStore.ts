/**
 * The storage seam.
 *
 * Everything that persists in this module goes through this interface rather
 * than importing AsyncStorage directly, so the session logic is testable under
 * Node and so the backing store can be swapped later — Vega offers no keychain
 * (`@amazon-devices/security-manager-lib` handles privileges, not secrets), and
 * if that changes only the implementations need to.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** In-memory store, for tests and for anywhere persistence is not wanted. */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    const value = this.values.get(key);
    return value === undefined ? null : value;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}
