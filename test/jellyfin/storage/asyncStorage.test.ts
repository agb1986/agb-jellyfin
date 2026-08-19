import AsyncStorage from '@react-native-async-storage/async-storage';
import { asyncKeyValueStore } from '../../../src/jellyfin/storage/asyncStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue('stored'),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('asyncKeyValueStore', () => {
  it('satisfies KeyValueStore against the real AsyncStorage module', async () => {
    // The point of this test is the wiring: everything else in src/jellyfin
    // stays free of React Native imports, and this is the one adapter.
    await expect(asyncKeyValueStore.getItem('k')).resolves.toBe('stored');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('k');

    await asyncKeyValueStore.setItem('k', 'v');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('k', 'v');

    await asyncKeyValueStore.removeItem('k');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('k');
  });
});
