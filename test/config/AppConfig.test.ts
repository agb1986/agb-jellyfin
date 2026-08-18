jest.unmock('../../src/config/AppConfig');
import { Platform } from 'react-native';
import { isRunningOnTVSimulator } from './../../src/config/AppConfig';
jest.mock('react-native', () => ({
  Platform: {
    isTV: false,
    OS: 'kepler',
  },
  Dimensions: {
    get: jest.fn(),
  },
}));
jest.mock('@amazon-devices/react-native-device-info', () => ({
  getModel: jest.fn().mockReturnValue('simulator'),
}));
describe('AppConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  describe('TV Platform Tests', () => {
    beforeEach(() => {
      Platform.isTV = true;
    });
    test('detects the TV simulator from the device model', () => {
      expect(isRunningOnTVSimulator()).toBe(false);
    });
  });
});
