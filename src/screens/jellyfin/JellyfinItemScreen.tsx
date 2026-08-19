import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import React from 'react';
import { Screens } from '../../components/navigation/types';
import JellyfinDetailsScreen from './JellyfinDetailsScreen';
import JellyfinSeriesScreen from './JellyfinSeriesScreen';

/**
 * Opens whichever screen an item deserves.
 *
 * A series has nothing to play — its episodes do — so it opens on its seasons
 * rather than on a details screen offering a Play button with no stream behind
 * it. Everything else is playable and goes straight to details.
 *
 * This lives on its own because more than one screen leads to an item: the
 * library grid and search results both do, and the choice must not drift
 * between them.
 */

export interface JellyfinItemScreenProps {
  item: BaseItemDto;
  navigation: {
    navigate: (screen: Screens, params: unknown) => void;
  };
  onBack: () => void;
}

const JellyfinItemScreen = ({
  item,
  navigation,
  onBack,
}: JellyfinItemScreenProps) => {
  if (item.Type === 'Series') {
    return (
      <JellyfinSeriesScreen
        series={item}
        navigation={navigation}
        onBack={onBack}
      />
    );
  }

  return (
    <JellyfinDetailsScreen
      item={item}
      navigation={navigation}
      onBack={onBack}
    />
  );
};

export default JellyfinItemScreen;
