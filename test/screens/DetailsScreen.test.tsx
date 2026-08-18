import { RouteProp } from '@amazon-devices/react-navigation__core';
import { StackNavigationProp } from '@amazon-devices/react-navigation__stack';
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import {
  AppStackParamList,
  Screens,
} from '../../src/components/navigation/types';
import DetailsScreen from '../../src/screens/DetailsScreen';

jest.mock('../../src/utils/translationHelper', () => ({
  getSelectedLocale: jest.fn().mockReturnValue('en-US'),
  translate: jest.fn().mockReturnValue('mocked translation'),
}));

// Override the global react-native-kepler mock (jest.setup.ts) so that
// TVFocusGuideView renders its children.
jest.mock('@amazon-devices/react-native-kepler', () => ({
  __esModule: true,
  HWEvent: jest.fn(),
  useTVEventHandler: jest.fn(),
  TVFocusGuideView: (props) => <div {...props}>{props.children}</div>,
}));

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.Systrace.isEnabled = jest.fn().mockImplementation(() => true);
  RN.Systrace.beginEvent = jest.fn();
  RN.Systrace.endEvent = jest.fn();
  RN.BackHandler = {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    exitApp: jest.fn(),
  };
  return RN;
});

const mockNavigation: any = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as StackNavigationProp<AppStackParamList, Screens.DETAILS_SCREEN>;
const mockRoute: any = {
  params: {
    data: {
      title: 'Test Movie',
      id: '123',
      description: 'Test description',
      posterUrl: 'https://example.com/poster.jpg',
      rating: 4.5,
    },
  },
} as unknown as RouteProp<AppStackParamList, Screens.PLAYER_SCREEN>;

const mockStore = configureMockStore();

const renderDetailsScreen = (route: any = mockRoute) => {
  return <DetailsScreen navigation={mockNavigation} route={route} />;
};

describe('Details Component', () => {
  let store: any;
  let mockDispatch: any;

  beforeEach(() => {
    store = mockStore({
      videoDetail: {
        watchList: [],
        purchasedList: [],
        rentList: [],
      },
      settingsSelectors: {
        countryCode: {},
        loginStatus: false,
      },
    });
    mockDispatch = jest.fn();
    (useDispatch as unknown as jest.Mock).mockReturnValue(mockDispatch);
    (useSelector as unknown as jest.Mock).mockImplementation(
      (callback: (state: any) => any) => callback(store.getState()),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly with given props', () => {
    const { getByTestId } = render(renderDetailsScreen());

    expect(getByTestId('details-action-play-movie-btn')).toBeTruthy();
    expect(getByTestId('details-action-add-remove-btn')).toBeTruthy();
  });

  it('renders detail container on mount', () => {
    const { getByTestId } = render(renderDetailsScreen());
    expect(
      getByTestId(`detail-container-${mockRoute.params.data.id}`),
    ).toBeTruthy();
  });

  it('navigates back when the hardware back button is pressed', () => {
    const RN = require('react-native');
    jest.spyOn(RN.Platform, 'isTV', 'get').mockReturnValue(true);
    const addEventListenerSpy = jest.spyOn(RN.BackHandler, 'addEventListener');

    render(renderDetailsScreen());

    const backHandlerCall = addEventListenerSpy.mock.calls.find(
      ([event]) => event === 'hardwareBackPress',
    );
    expect(backHandlerCall).toBeDefined();

    act(() => {
      (backHandlerCall![1] as () => void)();
    });
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('handles play movie button press', async () => {
    const { getByTestId } = render(renderDetailsScreen());
    const playMovieButton = getByTestId('details-action-play-movie-btn');
    await act(async () => {
      fireEvent.press(playMovieButton);
    });
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Player', {
      data: mockRoute.params.data,
      focusId: mockRoute.params.data.id,
    });
  });

  it('updates selectedFileType when route params title changes', () => {
    const initialRoute = {
      params: { data: { ...mockRoute.params.data, title: 'Old Title' } },
    };
    const updatedRoute = {
      params: { data: { ...mockRoute.params.data, title: 'New Title' } },
    };

    const { rerender, getByTestId } = render(renderDetailsScreen(initialRoute));
    // Pass a brand-new route reference so React.memo's deep-equality comparator
    // (areDetailsPropsEqual -> lodash/isEqual) detects the title change and
    // re-renders the header with the updated title.
    rerender(renderDetailsScreen(updatedRoute));

    const headerTitle = getByTestId('detail-header_title');
    expect(headerTitle.props.children).toBe('New Title');
  });
});
