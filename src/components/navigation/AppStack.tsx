// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createStackNavigator } from '@amazon-devices/react-navigation__stack';
import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { isPlaybackSpikeEnabled } from '../../config/AppConfig';
import { AppDispatch } from '../../store';
import { fetchPlaylists } from '../../store/search/searchSlice';
import { WithSuspense } from '../../utils/WithSuspense';
import AppDrawer from './AppDrawer';
import { AppStackParamList, Screens } from './types';

const DetailsScreen = React.lazy(() => import('../../screens/DetailsScreen'));
const PlayerScreen = React.lazy(() => import('../../screens/PlayerScreen'));
const SearchResultsScreen = React.lazy(
  () => import('../../screens/SearchResultsScreen'),
);
const FeedBackScreen = React.lazy(() => import('../../screens/FeedbackScreen'));
const PlaybackSpikeScreen = React.lazy(
  () => import('../../screens/PlaybackSpikeScreen'),
);
const PlaybackSpikeRunnerScreen = React.lazy(
  () => import('../../screens/PlaybackSpikeRunnerScreen'),
);

const Stack = createStackNavigator<AppStackParamList>();
const AppStack = () => {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    //fetching local file data for search flow
    dispatch(fetchPlaylists());
  }, [dispatch]);

  const navigationOptions = {
    headerShown: false,
    animationEnabled: false,
  };

  // While the spike is enabled the app opens on the runner, which drives the
  // whole stream matrix unattended — the Vega CLI cannot inject D-pad input, so
  // an unattended run is the only way to get results out of a headless device.
  // The manual list screen stays registered for driving it by hand on a device
  // you can actually see. The rest of the sample remains reachable behind both.
  const initialRouteName = isPlaybackSpikeEnabled()
    ? Screens.PLAYBACK_SPIKE_RUNNER_SCREEN
    : Screens.APP_DRAWER;

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={navigationOptions}>
      <Stack.Screen
        name={Screens.PLAYBACK_SPIKE_RUNNER_SCREEN}
        component={WithSuspense(PlaybackSpikeRunnerScreen)}
      />
      <Stack.Screen
        name={Screens.PLAYBACK_SPIKE_SCREEN}
        component={WithSuspense(PlaybackSpikeScreen)}
      />
      <Stack.Screen name={Screens.APP_DRAWER} component={AppDrawer} />
      <Stack.Screen
        name={Screens.DETAILS_SCREEN}
        component={WithSuspense(DetailsScreen)}
      />
      <Stack.Screen
        name={Screens.PLAYER_SCREEN}
        component={WithSuspense(PlayerScreen)}
      />

      <Stack.Screen
        name={Screens.SEARCH_RESULTS_SCREEN}
        component={WithSuspense(SearchResultsScreen)}
      />

      <Stack.Screen
        name={Screens.FEEDBACK_SCREEN}
        component={WithSuspense(FeedBackScreen)}
      />
    </Stack.Navigator>
  );
};

export default React.memo(AppStack);
