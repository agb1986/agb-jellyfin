import { LinearGradientProps } from '@amazon-devices/react-linear-gradient';
import { render } from '@testing-library/react-native';
import React from 'react';
import { useDispatch } from 'react-redux';
import { areComponentPropsEqual } from '../../src/utils/lodashHelper';

import { RouteProp } from '@amazon-devices/react-navigation__core';
import { StackNavigationProp } from '@amazon-devices/react-navigation__stack';
import {
  AppStackParamList,
  AppStackScreenProps,
  Screens,
} from '../../src/components/navigation/types';
import HomeScreen from '../../src/screens/HomeScreen';
import {
  getSelectedLocale,
  localeOptions,
} from '../../src/utils/translationHelper';

jest.mock('@amazon-devices/react-linear-gradient', () => ({
  __esModule: true,

  default: ({ children }: LinearGradientProps) => <>{children}</>,
}));

// mock useFocusEffect
jest.mock('@amazon-devices/react-navigation__core', () => ({
  ...jest.requireActual('@amazon-devices/react-navigation__core'),
  useFocusEffect: jest.fn((callback) => callback()),
  useIsFocused: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/data/videos', () => ({
  DEFAULT_FILE_TYPE: 'video/mp4',
}));

jest.mock('@amazon-devices/react-native-kepler', () => ({
  useHideSplashScreenCallback: jest.fn(),
  useKeplerAppStateManager: jest.fn().mockReturnValue({
    getComponentInstance: jest.fn().mockReturnValue({
      setSurfaceHandle: jest.fn(),
      setCaptionViewHandle: jest.fn(),
    }),
    addAppStateListener: jest.fn().mockReturnValue({
      remove: jest.fn(),
    }),
  }),
}));

const mockedNavigate = jest.fn();
const mockedNavigation = {
  navigate: mockedNavigate,
  goBack: mockedNavigate,
} as unknown as StackNavigationProp<
  AppStackParamList,
  Screens.HOME_SCREEN,
  undefined
>;
const mockRoute = {
  key: '',
  name: Screens.PLAYER_SCREEN,
} as unknown as RouteProp<AppStackParamList, Screens.HOME_SCREEN>;

const props: AppStackScreenProps<Screens.HOME_SCREEN> = {
  navigation: mockedNavigation,
  route: mockRoute,
};

describe('HomeScreen', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  let mockDispatch: any;
  beforeEach(() => {
    mockDispatch = jest.fn();
    (useDispatch as unknown as jest.Mock).mockReturnValue(mockDispatch);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('renders correctly and matches snapshot', () => {
    const { toJSON } = render(<HomeScreen {...props} />);
    expect(toJSON()).toMatchSnapshot();
  });

});
describe('HomeScreen with React.memo', () => {
  it('does not re-renders when props are unchanged', async () => {
    const { rerender } = render(<HomeScreen {...props} />);
    rerender(<HomeScreen {...props} />);
    expect(areComponentPropsEqual).toHaveBeenCalledWith(
      {
        navigation: mockedNavigation,
        route: mockRoute,
      },
      {
        navigation: mockedNavigation,
        route: mockRoute,
      },
    );

    expect(areComponentPropsEqual).toHaveBeenCalledTimes(1);
  });
});

describe('HomeScreen with touch optimized UX', () => {
  beforeEach(() => {
    jest
      .spyOn(require('../../src/config/AppConfig'), 'isDpadControllerSupported')
      .mockReturnValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly and matches snapshot', () => {
    const { toJSON } = render(<HomeScreen {...props} />);
    expect(toJSON()).toMatchSnapshot();
  });
});

describe('getSelectedLocale', () => {
  it('should return a valid OptionType object', () => {
    const result = getSelectedLocale();

    expect(result).toBeDefined();
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('value');

    expect(result).toMatchObject({
      code: expect.any(String),
      label: expect.any(String),
      value: expect.any(String),
    });
  });

  it('should return the default OptionType if currentCountry is undefined', () => {
    jest.mock('../../src/utils/translationHelper', () => ({
      getSelectedLocale: jest.fn().mockReturnValue(undefined),
    }));

    const result = getSelectedLocale();

    expect(result).toEqual(localeOptions[0]);
  });
});
