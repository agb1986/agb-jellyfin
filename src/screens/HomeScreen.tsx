/**
 * HomeScreen Component
 *
 * This is the main home screen of the streaming application that displays:
 * - A rotating banner/hero section at the top
 * - Multiple rows of movie/content grids below
 * - Content preview when items are focused (D-pad mode)
 * - Touch-optimized layout for touch devices
 *
 * The component handles different input methods (D-pad vs touch) and integrates
 * with various Kepler services for channel tuning, content personalization,
 * and account management.
 */

import {
  useFocusEffect,
  useIsFocused,
} from '@amazon-devices/react-navigation__core';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

// Event handling for live channel events

// Redux state management
import { useDispatch, useSelector } from 'react-redux';

// Account login functionality

// UI Components
import ContentPreview from '../components/ContentPreview';
import MovieGrid from '../components/MovieGrid';
import {
  AppStackScreenProps,
  Screens,
} from '../components/navigation/types';
import { OptionType } from '../components/RadioPicker';
import AutoRotator from '../components/rotator/AutoRotator';
import { MovieRotatorGrid } from '../components/touchOptimized/MovieRotatorGrid';

// Configuration and feature flags
import {
  isDpadControllerSupported,
} from '../config/AppConfig';

// Constants and data sources
import { getClassics } from '../data/local/classics';
import { getLatestHits } from '../data/local/latestHits';
import { getNewHits } from '../data/local/newHits';
import { getPremiumCollection } from '../data/local/premiumCollection';
import { getRecommendations } from '../data/local/recommendations';
import { getRotator } from '../data/local/rotator';
import { getTrends } from '../data/local/trends';

// Live TV functionality

// Redux store slices
import { setCurrentFocus } from '../store/focus/focusSlice';
import {
  setCountryCode,
  settingsSelectors,
} from '../store/settings/SettingsSlice';

// Styling and utilities
import { COLORS } from '../styles/Colors';
import { MovieGridData } from '../types/MovieGridData';
import { TitleData } from '../types/TitleData';
import { areComponentPropsEqual } from '../utils/lodashHelper';
import { scaleUxToDp } from '../utils/pixelUtils';
import { getSelectedLocale } from '../utils/translationHelper';

// Data for the rotating banner/hero section at the top of the screen
const AutoRotatorData = getRotator();

/**
 * Configuration for movie grid rows displayed on the home screen
 * Each row represents a different category of content with:
 * - heading: Display name for the row
 * - testID: Identifier for automated testing
 * - data: Function that returns the content for that row
 */
const data: MovieGridData[] = [
  {
    heading: 'Latest Hits',
    testID: 'latest_hits',
    data: getLatestHits,
  },
  {
    heading: 'Classics',
    testID: 'classics',
    data: getClassics,
  },
  {
    heading: 'Recommendation',
    testID: 'recommendations',
    data: getRecommendations,
  },
  {
    heading: 'Premium Collection',
    testID: 'premium_collection',
    data: getPremiumCollection,
  },
  {
    heading: 'New hits',
    testID: 'new_hits',
    data: getNewHits,
  },
  {
    heading: 'Trends',
    testID: 'trends',
    data: getTrends,
  },
];

/**
 * Props interface for the HomeScreen component
 */
interface HomeProps {
  navigation: any;
}

/**
 * HomeScreen Component
 *
 * Main home screen that adapts its layout based on input method:
 * - D-pad mode: Shows content preview area + movie grid
 * - Touch mode: Shows combined rotator + movie grid that scrolls together
 */
const HomeScreen = ({}: AppStackScreenProps<Screens.HOME_SCREEN>) => {
  // Redux hooks for state management
  const dispatch = useDispatch();
  const countryCode = useSelector(settingsSelectors.countryCode);

  // Local state for tracking the currently selected/focused title
  const [selectedTitle, setSelectedTitle] = useState<TitleData | undefined>(
    undefined,
  );

  // Reference to the first tile for focus management
  const firstTileRef = React.useRef<any>(null);

  // Initialize country code from locale if not already set
  if (!countryCode) {
    const selectedLocale = getSelectedLocale();
    if (selectedLocale) {
      dispatch(setCountryCode(selectedLocale as OptionType));
    }
  }

  // Hook to track if this screen is currently focused/active
  const isFocused = useIsFocused();

  /**
   * Focus effect hook - runs when screen gains/loses focus
   * Updates the global focus state to track which screen is currently active
   */
  useFocusEffect(
    useCallback(() => {
      // Set this screen as the currently focused screen
      dispatch(
        setCurrentFocus({
          currentFocusedScreen: Screens.HOME_SCREEN,
        }),
      );

      // Cleanup function - clear focus state when screen loses focus
      return () => {
        dispatch(
          setCurrentFocus({
            currentFocusedScreen: '',
          }),
        );
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  /**
   * Callback function triggered when a movie tile receives focus
   * Updates the selected title state to show content preview
   *
   * @param title - The title data of the focused tile
   */
  const onTileFocus = useCallback(
    (title?: TitleData) => {
      setSelectedTitle(title);
    },
    [setSelectedTitle],
  );

  /**
   * Sets focus to the first movie tile when transitioning from the rotator
   * Used in D-pad navigation to move focus from banner to content grid
   */
  const setFocusDestinationFromRotator = () => {
    firstTileRef?.current?.requestTVFocus();
  };
  /**
   * TOUCH MODE LAYOUT
   *
   * For devices without D-pad support (touch devices):
   * - Renders a combined rotator + movie grid that scrolls as one unit
   * - Optimized for touch/swipe interactions
   * - No separate content preview area needed
   */
  if (!isDpadControllerSupported()) {
    return (
      <View style={styles.movieGridContainer}>
        <MovieRotatorGrid rotatorData={AutoRotatorData} movieGridData={data} />
      </View>
    );
  }

  /**
   * D-PAD MODE LAYOUT
   *
   * For devices with D-pad support (TV remotes, game controllers):
   * - Top area: Shows content preview when tile is focused, or auto-rotator when nothing is focused
   * - Bottom area: Movie grid with focus-based navigation
   * - Allows users to see details of focused content before selecting
   */
  return (
    <View style={styles.container}>
      {/* Top section: Content preview or auto-rotator */}
      <View style={styles.contentPreviewAndRotatorContainer}>
        {selectedTitle ? (
          // Show preview of the currently focused title
          <ContentPreview tile={selectedTitle} />
        ) : (
          // Show auto-rotating banner when no title is focused
          <AutoRotator
            data={AutoRotatorData}
            onFocus={setFocusDestinationFromRotator}
          />
        )}
      </View>

      {/* Bottom section: Movie grid with multiple content rows */}
      <View style={styles.movieGridContainer}>
        <MovieGrid
          key={`movie-grid-${isFocused}`} // Re-render when screen focus changes
          data={data} // Array of movie grid row configurations
          initialColumnsToRender={6} // Performance optimization - render 6 columns initially
          onTileFocus={onTileFocus} // Callback when a tile receives focus
          ref={firstTileRef} // Reference for focus management
          testID={'movieGrid'} // Test identifier
        />
      </View>
    </View>
  );
};

/**
 * Props comparison function for React.memo optimization
 * Prevents unnecessary re-renders by comparing previous and next props
 *
 * @param prevProps - Previous component props
 * @param nextProps - New component props
 * @returns true if props are equal (skip re-render), false if different (re-render)
 */
const areHomePropsEqual = (prevProps: HomeProps, nextProps: HomeProps) => {
  return areComponentPropsEqual(prevProps, nextProps);
};

// Export memoized component to prevent unnecessary re-renders
export default React.memo(HomeScreen, areHomePropsEqual);

/**
 * Stylesheet for HomeScreen component
 *
 * Defines layouts for both D-pad and touch modes:
 * - container: Main wrapper for D-pad mode (two-section layout)
 * - contentPreviewAndRotatorContainer: Top section for preview/rotator
 * - movieGridContainer: Bottom section for movie grid (used in both modes)
 */
const styles = StyleSheet.create({
  // Main container for D-pad mode layout
  container: {
    flex: 1,
    backgroundColor: COLORS.BLACK,
  },

  // Top section: Content preview and auto-rotator area
  contentPreviewAndRotatorContainer: {
    flex: 0.8, // Takes 80% of available height
    paddingLeft: scaleUxToDp(29), // Left padding scaled for different screen sizes
    marginBottom: 20, // Space between preview and movie grid
  },

  // Bottom section: Movie grid area (used in both D-pad and touch modes)
  movieGridContainer: {
    flex: 1, // Takes remaining available space
    width: '100%',
    height: '100%',
    marginBottom: scaleUxToDp(30), // Bottom margin scaled for different screen sizes
    backgroundColor: COLORS.BLACK,
  },
});
