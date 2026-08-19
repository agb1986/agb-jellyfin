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
import { Screens } from '../../components/navigation/types';
import { ticksToSeconds } from '../../jellyfin/JellyfinClient';
import { useJellyfin } from '../../jellyfin/react/JellyfinProvider';
import { COLORS } from '../../styles/Colors';
import { scaleUxToDp } from '../../utils/pixelUtils';
import JellyfinDetailsScreen from './JellyfinDetailsScreen';

/**
 * A series: its seasons, and the episodes of the selected one.
 *
 * This screen exists because a series is the one library item that cannot be
 * played. Routing it to the details screen gives a Play button with nothing
 * behind it — the thing a viewer actually wants to press is an episode, two
 * levels down.
 *
 * Episodes are handed to `JellyfinDetailsScreen` rather than played from here.
 * An episode is an ordinary playable item, so it gets the resume point, the
 * `PlaybackInfo` round trip and the error handling that already exist there,
 * and this screen stays about navigation.
 */

const STILL_WIDTH = 320;

export interface JellyfinSeriesScreenProps {
  series: BaseItemDto;
  navigation: {
    navigate: (screen: Screens, params: unknown) => void;
  };
  onBack: () => void;
}

/** "S1 E2" — the compact form, since the season is already on screen. */
export const formatEpisodeNumber = (episode: BaseItemDto): string => {
  const season = episode.ParentIndexNumber;
  const number = episode.IndexNumber;
  if (season === undefined || season === null) {
    return number === undefined || number === null ? '' : `E${number}`;
  }
  if (number === undefined || number === null) {
    return `S${season}`;
  }
  return `S${season} E${number}`;
};

const formatRuntime = (ticks?: number | null): string => {
  if (!ticks) {
    return '';
  }
  return `${Math.round(ticksToSeconds(ticks) / 60)}m`;
};

/** How far through, as a percentage, for the progress bar under a still. */
export const watchedFraction = (episode: BaseItemDto): number => {
  const position = episode.UserData?.PlaybackPositionTicks ?? 0;
  const runtime = episode.RunTimeTicks ?? 0;
  if (position <= 0 || runtime <= 0) {
    return 0;
  }
  return Math.min(position / runtime, 1);
};

const JellyfinSeriesScreen = ({
  series,
  navigation,
  onBack,
}: JellyfinSeriesScreenProps) => {
  const { session } = useJellyfin();
  const [seasons, setSeasons] = useState<BaseItemDto[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<BaseItemDto[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<BaseItemDto | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !series.Id) {
      return;
    }

    let cancelled = false;
    const loadSeasons = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await session.client.getSeasons(series.Id as string);
        if (cancelled) {
          return;
        }
        const loaded = result.Items ?? [];
        setSeasons(loaded);
        // Open on the first season rather than an empty screen — the same
        // reason the library opens on the first view, and it means a device
        // with no way to send input still exercises the episode call.
        setSelectedSeasonId(loaded[0]?.Id ?? null);
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

    loadSeasons();
    return () => {
      cancelled = true;
    };
  }, [session, series.Id]);

  useEffect(() => {
    if (!session || !series.Id || !selectedSeasonId) {
      return;
    }

    let cancelled = false;
    const loadEpisodes = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await session.client.getEpisodes(series.Id as string, {
          seasonId: selectedSeasonId,
        });
        if (!cancelled) {
          setEpisodes(result.Items ?? []);
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

    loadEpisodes();
    return () => {
      cancelled = true;
    };
  }, [session, series.Id, selectedSeasonId]);

  const renderEpisode = useCallback(
    ({ item }: { item: BaseItemDto }) => {
      const stillUri =
        session && item.Id
          ? session.client.getImageUrl(item.Id, 'Primary', {
              maxWidth: STILL_WIDTH,
              tag: item.ImageTags?.Primary,
            })
          : undefined;
      const progress = watchedFraction(item);
      const number = formatEpisodeNumber(item);
      const runtime = formatRuntime(item.RunTimeTicks);

      return (
        <TouchableOpacity
          style={styles.episode}
          onPress={() => setSelectedEpisode(item)}
          testID={`jellyfin-episode-${item.Id}`}>
          <View>
            {stillUri ? (
              <Image
                source={{ uri: stillUri }}
                style={styles.still}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.still, styles.stillPlaceholder]} />
            )}
            {progress > 0 && (
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${progress * 100}%` }]}
                  testID={`jellyfin-episode-progress-${item.Id}`}
                />
              </View>
            )}
          </View>

          <View style={styles.episodeText}>
            <Text style={styles.episodeTitle} numberOfLines={1}>
              {[number, item.Name].filter(Boolean).join('  ·  ')}
            </Text>
            {runtime.length > 0 && (
              <Text style={styles.episodeMeta}>{runtime}</Text>
            )}
            {item.Overview && (
              <Text style={styles.episodeOverview} numberOfLines={3}>
                {item.Overview}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [session],
  );

  if (selectedEpisode) {
    return (
      <JellyfinDetailsScreen
        item={selectedEpisode}
        navigation={navigation}
        onBack={() => setSelectedEpisode(null)}
      />
    );
  }

  return (
    <View style={styles.container} testID="jellyfin-series-screen">
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {series.Name}
        </Text>
        <TouchableOpacity
          onPress={onBack}
          style={styles.back}
          testID="jellyfin-series-back">
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.seasons}>
        {seasons.map((season, index) => (
          <TouchableOpacity
            key={season.Id}
            onPress={() => setSelectedSeasonId(season.Id ?? null)}
            hasTVPreferredFocus={index === 0}
            style={[
              styles.season,
              season.Id === selectedSeasonId && styles.seasonSelected,
            ]}
            testID={`jellyfin-season-${season.Id}`}>
            <Text style={styles.seasonLabel}>{season.Name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && <ActivityIndicator color={COLORS.WHITE} size="large" />}

      {error && (
        <Text style={styles.error} testID="jellyfin-series-error">
          {error}
        </Text>
      )}

      {!loading && !error && episodes.length === 0 && (
        <Text style={styles.empty}>No episodes in this season.</Text>
      )}

      <FlatList
        data={episodes}
        keyExtractor={(episode) => episode.Id ?? String(Math.random())}
        renderItem={renderEpisode}
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
    flex: 1,
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
  seasons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: scaleUxToDp(24),
  },
  season: {
    paddingHorizontal: scaleUxToDp(24),
    paddingVertical: scaleUxToDp(10),
    marginRight: scaleUxToDp(12),
    marginBottom: scaleUxToDp(12),
    borderRadius: scaleUxToDp(8),
    backgroundColor: COLORS.DARK_GRAY,
  },
  seasonSelected: {
    backgroundColor: COLORS.KASHMIR_BLUE,
  },
  seasonLabel: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(24),
  },
  list: {
    paddingBottom: scaleUxToDp(40),
  },
  episode: {
    flexDirection: 'row',
    marginBottom: scaleUxToDp(24),
  },
  still: {
    width: scaleUxToDp(320),
    height: scaleUxToDp(180),
    borderRadius: scaleUxToDp(6),
  },
  stillPlaceholder: {
    backgroundColor: COLORS.DARK_GRAY,
  },
  progressTrack: {
    height: scaleUxToDp(6),
    marginTop: scaleUxToDp(6),
    borderRadius: scaleUxToDp(3),
    backgroundColor: COLORS.DARK_GRAY,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.WHITE,
  },
  episodeText: {
    flex: 1,
    marginLeft: scaleUxToDp(28),
  },
  episodeTitle: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(28),
    fontWeight: '600',
  },
  episodeMeta: {
    color: COLORS.PALE_GRAY,
    fontSize: scaleUxToDp(22),
    marginTop: scaleUxToDp(6),
  },
  episodeOverview: {
    color: COLORS.PALE_GRAY,
    fontSize: scaleUxToDp(22),
    marginTop: scaleUxToDp(10),
    lineHeight: scaleUxToDp(30),
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

export default JellyfinSeriesScreen;
