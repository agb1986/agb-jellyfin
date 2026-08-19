import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SearchInput } from '../../blocks/components/SearchInput/SearchInput';
import { Screens } from '../../components/navigation/types';
import { useJellyfin } from '../../jellyfin/react/JellyfinProvider';
import { COLORS } from '../../styles/Colors';
import { scaleUxToDp } from '../../utils/pixelUtils';
import JellyfinItemScreen from './JellyfinItemScreen';

/**
 * Search across every library.
 *
 * A separate screen rather than a field on the library grid, because the
 * sample's `SearchInput` takes focus on mount — right for a screen that exists
 * to be typed into, wrong for one where the grid should be focused.
 *
 * The search runs on submit, not per keystroke. On a remote every character is
 * several presses, so searching as you type would fire a request per press and
 * show results for prefixes nobody meant to search for.
 */

const POSTER_WIDTH = 240;
const RESULT_LIMIT = 60;

/** Films, shows and individual episodes — what someone would expect to find. */
const SEARCHABLE_TYPES = ['Movie', 'Series', 'Episode'];

export interface JellyfinSearchScreenProps {
  navigation: {
    navigate: (screen: Screens, params: unknown) => void;
  };
  onBack: () => void;
}

/** "The Expanse · S1 E2" — enough to tell two similar hits apart. */
export const resultSubtitle = (item: BaseItemDto): string => {
  if (item.Type === 'Episode') {
    const number =
      item.ParentIndexNumber !== undefined &&
      item.ParentIndexNumber !== null &&
      item.IndexNumber !== undefined &&
      item.IndexNumber !== null
        ? `S${item.ParentIndexNumber} E${item.IndexNumber}`
        : '';
    return [item.SeriesName, number].filter(Boolean).join('  ·  ');
  }
  if (item.Type === 'Series') {
    return ['Series', item.ProductionYear ? String(item.ProductionYear) : '']
      .filter(Boolean)
      .join('  ·  ');
  }
  return item.ProductionYear ? String(item.ProductionYear) : '';
};

const JellyfinSearchScreen = ({
  navigation,
  onBack,
}: JellyfinSearchScreenProps) => {
  const { session } = useJellyfin();
  const [results, setResults] = useState<BaseItemDto[]>([]);
  const [selectedItem, setSelectedItem] = useState<BaseItemDto | null>(null);
  const [term, setTerm] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(
    async (searchTerm: string) => {
      const trimmed = searchTerm.trim();
      setTerm(trimmed);
      if (!session || trimmed.length === 0) {
        setResults([]);
        setSearched(false);
        return;
      }

      setLoading(true);
      setError(null);
      setSearched(true);
      try {
        const result = await session.client.getItems({
          searchTerm: trimmed,
          // No parentId: search means every library, not the one that
          // happened to be open.
          recursive: true,
          includeItemTypes: SEARCHABLE_TYPES,
          limit: RESULT_LIMIT,
        });
        setResults(result.Items ?? []);
      } catch (searchError) {
        setError((searchError as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [session],
  );

  const renderResult = useCallback(
    ({ item }: { item: BaseItemDto }) => {
      // An episode's own poster is usually a still from it; a film's is the
      // poster. Either way Primary is the right image.
      const uri =
        session && item.Id
          ? session.client.getImageUrl(item.Id, 'Primary', {
              maxWidth: POSTER_WIDTH,
              tag: item.ImageTags?.Primary,
            })
          : undefined;
      const subtitle = resultSubtitle(item);

      return (
        <TouchableOpacity
          style={styles.result}
          onPress={() => setSelectedItem(item)}
          testID={`jellyfin-result-${item.Id}`}>
          {uri ? (
            <Image source={{ uri }} style={styles.poster} resizeMode="cover" />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]} />
          )}
          <View style={styles.resultText}>
            <Text style={styles.resultTitle} numberOfLines={1}>
              {item.Name}
            </Text>
            {subtitle.length > 0 && (
              <Text style={styles.resultMeta}>{subtitle}</Text>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [session],
  );

  if (selectedItem) {
    return (
      <JellyfinItemScreen
        item={selectedItem}
        navigation={navigation}
        onBack={() => setSelectedItem(null)}
      />
    );
  }

  return (
    <View style={styles.container} testID="jellyfin-search-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <TouchableOpacity
          onPress={onBack}
          style={styles.back}
          testID="jellyfin-search-back">
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
      </View>

      <SearchInput onSubmit={runSearch} placeholderText="Search Jellyfin" />

      {loading && <ActivityIndicator color={COLORS.WHITE} size="large" />}

      {error && (
        <Text style={styles.error} testID="jellyfin-search-error">
          {error}
        </Text>
      )}

      {!loading && !error && searched && results.length === 0 && (
        <Text style={styles.empty}>{`Nothing found for "${term}".`}</Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => item.Id ?? String(Math.random())}
        renderItem={renderResult}
        contentContainerStyle={styles.list}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BLACK,
    padding: scaleUxToDp(60),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: scaleUxToDp(24),
  },
  title: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(44),
    fontWeight: '600',
  },
  back: {
    paddingHorizontal: scaleUxToDp(28),
    paddingVertical: scaleUxToDp(12),
    borderRadius: scaleUxToDp(8),
    backgroundColor: COLORS.DARK_GRAY,
  },
  backLabel: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(24),
  },
  list: {
    paddingTop: scaleUxToDp(24),
    paddingBottom: scaleUxToDp(40),
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: scaleUxToDp(20),
  },
  poster: {
    width: scaleUxToDp(120),
    height: scaleUxToDp(180),
    borderRadius: scaleUxToDp(6),
  },
  posterPlaceholder: {
    backgroundColor: COLORS.DARK_GRAY,
  },
  resultText: {
    flex: 1,
    marginLeft: scaleUxToDp(28),
  },
  resultTitle: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(30),
    fontWeight: '600',
  },
  resultMeta: {
    color: COLORS.PALE_GRAY,
    fontSize: scaleUxToDp(24),
    marginTop: scaleUxToDp(8),
  },
  empty: {
    color: COLORS.PALE_GRAY,
    fontSize: scaleUxToDp(26),
  },
  error: {
    color: COLORS.RED,
    fontSize: scaleUxToDp(26),
  },
});

export default JellyfinSearchScreen;
