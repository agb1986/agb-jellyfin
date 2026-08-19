// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { ThemeProvider } from '@amazon-devices/kepler-ui-components';
import { getModel } from '@amazon-devices/react-native-device-info';
import {
  Platform,
  useHideSplashScreenCallback,
  usePreventHideSplashScreen,
} from '@amazon-devices/react-native-kepler';
import { NavigationContainer } from '@amazon-devices/react-navigation__native';
import { Store } from '@reduxjs/toolkit';
import React, { useEffect, useMemo, useState } from 'react';
import { Provider } from 'react-redux';
import AppStack from './components/navigation/AppStack';
import {
  APP_VERSION,
  JELLYFIN_CLIENT_NAME,
} from './config/AppConfig';
import { getDevServerUrl } from './config/JellyfinConfig';
import { JellyfinProvider } from './jellyfin/react/JellyfinProvider';
import { asyncKeyValueStore } from './jellyfin/storage/asyncStorage';
import { initializeStore } from './store';
import { createTheme } from './styles/ThemeBuilders';

/**
 * Name shown beside this device in the Jellyfin dashboard. The model is the
 * only distinguishing thing available without asking the user, and five sticks
 * would otherwise be five identical rows; a rename belongs on a settings
 * screen once one exists.
 */
const getDeviceName = (): string => {
  return `Jellyfin Vega (${getModel()})`;
};

const App = () => {
  const [store, setStore] = useState<Store | null>(null);
  const isTv = Platform.isTV;
  const preventHideSplashScreen = usePreventHideSplashScreen;
  const hideSplashScreen = useHideSplashScreenCallback();

  if (isTv) {
    preventHideSplashScreen();
  }

  if (__DEV__) {
    hideSplashScreen();
  }

  const initStore = async () => {
    const initializedStore = await initializeStore();
    setStore(initializedStore);
  };

  useEffect(() => {
    initStore();
  }, []);

  const theme = useMemo(() => createTheme(), []);

  // Identifies this stick in the Jellyfin dashboard and on the Quick Connect
  // approval prompt. Held in a memo because JellyfinProvider re-bootstraps
  // when its inputs change, and a fresh object literal every render would
  // restart the session on each one.
  const clientInfo = useMemo(
    () => ({ name: JELLYFIN_CLIENT_NAME, version: APP_VERSION }),
    [],
  );
  const serverUrl = useMemo(() => getDevServerUrl(), []);

  if (!store) {
    return null;
  }

  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <JellyfinProvider
          store={asyncKeyValueStore}
          clientInfo={clientInfo}
          deviceName={getDeviceName()}
          serverUrl={serverUrl}>
          <NavigationContainer>
            <AppStack />
          </NavigationContainer>
        </JellyfinProvider>
      </ThemeProvider>
    </Provider>
  );
};

export default App;
