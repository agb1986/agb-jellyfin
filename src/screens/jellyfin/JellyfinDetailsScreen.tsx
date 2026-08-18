import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screens } from '../../components/navigation/types';
import { ticksToSeconds } from '../../jellyfin/JellyfinClient';
import { resolvePlaybackTarget } from '../../jellyfin/playback/resolvePlayback';
import { useJellyfin } from '../../jellyfin/react/JellyfinProvider';
import { COLORS } from '../../styles/Colors';
import { scaleUxToDp } from '../../utils/pixelUtils';

/**
 * Item details, and the button that starts playback.
 *
 * Pressing play is where the two halves of the app meet: the server is asked
 * how it intends to deliver the title, the answer is turned into the
 * `TitleData` the sample's player consumes, and the player screen takes over.
 */

interface JellyfinDetailsScreenProps {
  item: BaseItemDto;
  navigation: {
    navigate: (screen: Screens, params: unknown) => void;
  };
  onBack: () => void;
}

const formatRuntime = (ticks?: number | null): string => {
  if (!ticks) {
    return '';
  }
  const totalMinutes = Math.round(ticksToSeconds(ticks) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const JellyfinDetailsScreen = ({
  item,
  navigation,
  onBack,
}: JellyfinDetailsScreenProps) => {
  const { session } = useJellyfin();
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const play = useCallback(async () => {
    if (!session || !item.Id) {
      return;
    }

    setResolving(true);
    setError(null);

    try {
      const response = await session.client.getPlaybackInfo(item.Id);
      const target = resolvePlaybackTarget(session.client, item, response);

      // The one line worth having in the device log for every playback: it
      // says whether the DeviceProfile did its job, and when it did not, which
      // codec or container is to blame. This is the Phase 2 feedback loop.
      console.error(
        `[jellyfin] play "${target.titleData.title}" method=${target.playMethod} ` +
          `format=${target.titleData.format} vcodec=${target.titleData.vcodec} ` +
          `acodec=${target.titleData.acodec} reasons=${
            target.transcodeReasons.join(',') || 'none'
          }`,
      );

      navigation.navigate(Screens.PLAYER_SCREEN, {
        data: target.titleData,
        focusId: item.Id,
      });
    } catch (playError) {
      console.error(
        `[jellyfin] could not start "${item.Name}": ${(playError as Error).message}`,
      );
      setError((playError as Error).message);
    } finally {
      setResolving(false);
    }
  }, [session, item, navigation]);

  const posterUri =
    session && item.Id
      ? session.client.getImageUrl(item.Id, 'Primary', {
          maxWidth: 400,
          tag: item.ImageTags?.Primary,
        })
      : undefined;

  const meta = [
    item.ProductionYear ? String(item.ProductionYear) : '',
    formatRuntime(item.RunTimeTicks),
    item.OfficialRating ?? '',
    (item.Genres ?? []).slice(0, 3).join(', '),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="jellyfin-details-screen">
      <View style={styles.row}>
        {posterUri && (
          <Image
            source={{ uri: posterUri }}
            style={styles.poster}
            resizeMode="cover"
          />
        )}

        <View style={styles.details}>
          <Text style={styles.title}>{item.Name}</Text>
          {meta.length > 0 && <Text style={styles.meta}>{meta}</Text>}
          {item.Overview && (
            <Text style={styles.overview} numberOfLines={6}>
              {item.Overview}
            </Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.button}
              onPress={play}
              hasTVPreferredFocus
              disabled={resolving}
              testID="jellyfin-play-button">
              {resolving ? (
                <ActivityIndicator color={COLORS.WHITE} />
              ) : (
                <Text style={styles.buttonLabel}>
                  {item.UserData?.PlaybackPositionTicks
                    ? 'Resume'
                    : 'Play'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onBack}
              testID="jellyfin-details-back">
              <Text style={styles.buttonLabel}>Back</Text>
            </TouchableOpacity>
          </View>

          {error && (
            <Text style={styles.error} testID="jellyfin-details-error">
              {error}
            </Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BLACK,
  },
  content: {
    padding: scaleUxToDp(60),
  },
  row: {
    flexDirection: 'row',
  },
  poster: {
    width: scaleUxToDp(300),
    height: scaleUxToDp(450),
    borderRadius: scaleUxToDp(8),
    marginRight: scaleUxToDp(40),
  },
  details: {
    flex: 1,
  },
  title: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(52),
    marginBottom: scaleUxToDp(12),
  },
  meta: {
    color: COLORS.SMOKE_WHITE,
    fontSize: scaleUxToDp(24),
    marginBottom: scaleUxToDp(24),
  },
  overview: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(24),
    lineHeight: scaleUxToDp(34),
    marginBottom: scaleUxToDp(32),
  },
  actions: {
    flexDirection: 'row',
  },
  button: {
    backgroundColor: COLORS.KASHMIR_BLUE,
    paddingVertical: scaleUxToDp(16),
    paddingHorizontal: scaleUxToDp(48),
    borderRadius: scaleUxToDp(8),
    marginRight: scaleUxToDp(16),
    minWidth: scaleUxToDp(200),
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: COLORS.DARK_GRAY,
    paddingVertical: scaleUxToDp(16),
    paddingHorizontal: scaleUxToDp(48),
    borderRadius: scaleUxToDp(8),
  },
  buttonLabel: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(28),
  },
  error: {
    color: COLORS.WHITE,
    fontSize: scaleUxToDp(22),
    marginTop: scaleUxToDp(24),
  },
});

export default JellyfinDetailsScreen;
