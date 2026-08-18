import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useJellyfin } from '../../jellyfin/react/JellyfinProvider';
import { COLORS } from '../../styles/Colors';
import { scaleUxToDp } from '../../utils/pixelUtils';

/**
 * The signed-in landing screen: the user's libraries, and the items in the
 * selected one.
 *
 * Deliberately thin. It exists to prove the round trip — real credentials,
 * real /UserViews and /Items responses, real artwork over the network — before
 * any of the sample's grid, focus and rotator machinery is adapted to
 * Jellyfin's data model.
 */

const POSTER_WIDTH = 240;
const POSTER_HEIGHT = 360;
const PAGE_SIZE = 60;

const LibraryScreen = () => {
  const { session, signOut } = useJellyfin();
  const [views, setViews] = useState<BaseItemDto[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [items, setItems] = useState<BaseItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadViews = useCallback(async () => {
    if (!session) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await session.client.getUserViews();
      const loaded = result.Items ?? [];
      setViews(loaded);
      // Opening straight into the first library saves a press and, more
      // usefully, exercises /Items without any interaction — which matters on
      // a device the CLI cannot send input to.
      setSelectedViewId(loaded[0]?.Id ?? null);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadViews();
  }, [loadViews]);

  useEffect(() => {
    if (!session || !selectedViewId) {
      return;
    }

    let cancelled = false;
    const loadItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await session.client.getItems({
          parentId: selectedViewId,
          recursive: true,
          includeItemTypes: ['Movie', 'Series'],
          sortBy: ['SortName'],
          limit: PAGE_SIZE,
        });
        if (!cancelled) {
          setItems(result.Items ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadItems();
    return () => {
      cancelled = true;
    };
  }, [session, selectedViewId]);

  const renderItem = useCallback(
    ({ item }: { item: BaseItemDto }) => {
      const uri =
        session && item.Id
          ? session.client.getImageUrl(item.Id, 'Primary', {
              maxWidth: POSTER_WIDTH,
              // Passing the image tag lets the server and any cache treat a
              // changed poster as a different URL.
              tag: item.ImageTags?.Primary,
            })
          : undefined;

      return (
        <View style={styles.tile}>
          {uri ? (
            <Image
              source={{ uri }}
              style={styles.poster}
              resizeMode="cover"
              testID={`jellyfin-item-poster-${item.Id}`}
            />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]} />
          )}
          <Text style={styles.tileLabel} numberOfLines={2}>
            {item.Name}
          </Text>
        </View>
      );
    },
    [session],
  );

  return (
    <View style={styles.container} testID="jellyfin-library-screen">
      <View style={styles.header}>
        <Text style={styles.title}>
          {session?.storedCredentials?.userName
            ? `Jellyfin — ${session.storedCredentials.userName}`
            : 'Jellyfin'}
        </Text>
        <TouchableOpacity
          onPress={signOut}
          style={styles.signOut}
          testID="jellyfin-sign-out">
          <Text style={styles.signOutLabel}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.views}>
        {views.map((view, index) => (
          <TouchableOpacity
            key={view.Id}
            onPress={() => setSelectedViewId(view.Id ?? null)}
            hasTVPreferredFocus={index === 0}
            style={[
              styles.viewChip,
              view.Id === selectedViewId && styles.viewChipSelected,
            ]}
            testID={`jellyfin-view-${view.Id}`}>
            <Text style={styles.viewChipLabel}>{view.Name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && (
        <Text style={styles.error} testID="jellyfin-library-error">
          {error}
        </Text>
      )}

      {loading && <ActivityIndicator size="large" color={COLORS.WHITE} />}

      {!loading && !error && items.length === 0 && (
        <Text style={styles.empty}>Nothing in this library yet.</Text>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.Id)}
        renderItem={renderItem}
        numColumns={6}
        contentContainerStyle={styles.grid}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BLACK,
    padding: scaleUxToDp(40),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: scaleUxToDp(24),
  },
  title: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(40),
  },
  signOut: {
    paddingVertical: scaleUxToDp(10),
    paddingHorizontal: scaleUxToDp(24),
    borderRadius: scaleUxToDp(6),
    backgroundColor: COLORS.DARK_GRAY,
  },
  signOutLabel: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(22),
  },
  views: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: scaleUxToDp(24),
  },
  viewChip: {
    paddingVertical: scaleUxToDp(10),
    paddingHorizontal: scaleUxToDp(24),
    marginRight: scaleUxToDp(12),
    borderRadius: scaleUxToDp(6),
    backgroundColor: COLORS.DARK_GRAY,
  },
  viewChipSelected: {
    backgroundColor: COLORS.KASHMIR_BLUE,
  },
  viewChipLabel: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(24),
  },
  grid: {
    paddingBottom: scaleUxToDp(40),
  },
  tile: {
    width: scaleUxToDp(POSTER_WIDTH),
    marginRight: scaleUxToDp(20),
    marginBottom: scaleUxToDp(20),
  },
  poster: {
    width: scaleUxToDp(POSTER_WIDTH),
    height: scaleUxToDp(POSTER_HEIGHT),
    borderRadius: scaleUxToDp(6),
  },
  posterPlaceholder: {
    backgroundColor: COLORS.DARK_GRAY,
  },
  tileLabel: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(20),
    marginTop: scaleUxToDp(8),
  },
  error: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(24),
    marginBottom: scaleUxToDp(16),
  },
  empty: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(24),
  },
});

export default LibraryScreen;
