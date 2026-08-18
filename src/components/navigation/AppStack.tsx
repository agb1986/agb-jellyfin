// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createStackNavigator } from '@amazon-devices/react-navigation__stack';
import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import {
  isJellyfinClientEnabled,
  isPlaybackSpikeEnabled,
} from '../../config/AppConfig';
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
const JellyfinScreen = React.lazy(() => import('../../screens/JellyfinScreen'));
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
  // The spike wins when it is on, because it is a measurement run rather than
  // the app. Otherwise the Jellyfin client is the app, and the sample's own
  // screens remain registered behind it while their parts are reused.
  let initialRouteName = Screens.APP_DRAWER;
  if (isPlaybackSpikeEnabled()) {
    initialRouteName = Screens.PLAYBACK_SPIKE_RUNNER_SCREEN;
  } else if (isJellyfinClientEnabled()) {
    initialRouteName = Screens.JELLYFIN_SCREEN;
  }

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
      <Stack.Screen
        name={Screens.JELLYFIN_SCREEN}
        component={WithSuspense(JellyfinScreen)}
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
