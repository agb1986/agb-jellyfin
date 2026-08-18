import LinearGradient from '@amazon-devices/react-linear-gradient';
import {
  HWEvent,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import { VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Seekbar from '../../components/Seekbar';
import { isRunningOnAutomotive } from '../../config/AppConfig';
import { DPADEventType, EVENT_KEY_DOWN } from '../../constants';
import { FrameImageSource } from '../../services/bif/FrameImageSource';
import { COLORS } from '../../styles/Colors';
import { TitleData } from '../../types/TitleData';
import { areComponentPropsEqual } from '../../utils/lodashHelper';
import ControlBar from './ControlBar';
import ControlBarMenu from './ControlBarMenu';
import PlaybackControls from './PlaybackControls';
import { useMediaControls } from './types/useMediaControls';
import Header from './VideoPlayerHeader';

interface VideoPlayerUIProps {
  videoRef: React.MutableRefObject<VideoPlayer | null>;
  navigateBack: () => void;
  title: string;
  setCaptionStatus: (status: boolean) => void;
  setSelectedCaptionInVideoPlayer: (id: string) => void;
  bifFrameImagesRef: React.MutableRefObject<FrameImageSource | null>;
  videoData: TitleData;
}
export const areVideoPlayerUIPropsEqual = (
  prevProps: VideoPlayerUIProps,
  nextProps: VideoPlayerUIProps,
) => {
  return areComponentPropsEqual(prevProps.title, nextProps.title);
};

export const VideoPlayerUI = React.memo(
  ({
    navigateBack,
    title,
    videoRef,
    setCaptionStatus,
    setSelectedCaptionInVideoPlayer,
    bifFrameImagesRef,
    videoData,
  }: VideoPlayerUIProps) => {
    const [captionMenuVisibility, setCaptionMenuVisibility] =
      useState<boolean>(false);

    const setSelectedCaptionInMenuBar = (id: string) => {
      setSelectedCaptionInVideoPlayer(id);
    };

    const [playerControlType, setPlayerControlType] = useState<string>('');
    const [isCaptionButtonFocused, setCaptionButtonFocused] = useState(false);
    const [showMediaControls, setShowMediaControls] = useState(true);
    const { handleShowControls, handleShowControlsOnKeyEvent, cancelTimer } =
      useMediaControls(showMediaControls, setShowMediaControls);

    useEffect(() => {
      handleShowControls();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      // Hide and show controls on caption menu toggel actions
      if (captionMenuVisibility) {
        cancelTimer();
      } else {
        handleShowControlsOnKeyEvent();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [captionMenuVisibility]);

    const playPauseVideo = useCallback(() => {
      const isVideoPaused = videoRef.current?.paused;
      if (videoRef.current) {
        isVideoPaused ? videoRef.current.play() : videoRef.current.pause();
      }
    }, [videoRef]);

    useTVEventHandler((evt: HWEvent) => {
      if (!Platform.isTV) {
        return;
      }

      if (evt && evt.eventKeyAction === EVENT_KEY_DOWN) {
        setPlayerControlType(evt.eventType);

        if (!captionMenuVisibility) {
          showMediaControls
            ? handleShowControlsOnKeyEvent()
            : handleShowControls();
        }

        if (videoRef.current) {
          switch (evt.eventType) {
            case DPADEventType.BACK: {
              console.info('[VideoPlayerUI.tsx]: VideoPlayerUI : back');
              if (captionMenuVisibility) {
                setCaptionMenuVisibility(false);
              }
              setCaptionStatus(captionMenuVisibility);
              setCaptionButtonFocused(captionMenuVisibility);
              break;
            }

            case DPADEventType.SELECT: {
              // pause video
              if (!showMediaControls) {
                playPauseVideo();
              }
              break;
            }
          }
        }
      }
    });

    const toggleCaption = useCallback(() => {
      setCaptionMenuVisibility(!captionMenuVisibility);
    }, [captionMenuVisibility]);

    const seekBarRef = useRef<any>(null);

    const setCaptionVisibility = (captionVisibility: boolean) => {
      setCaptionMenuVisibility(captionVisibility);
      seekBarRef?.current?.requestTVFocus();
    };

    return (
      <View style={styles.uiContainer} testID="video-player-ui-view">
        {showMediaControls && (
          <LinearGradient
            colors={[
              COLORS.SEMI_TRANSPARENT,
              COLORS.TRANSPARENT,
              COLORS.SEMI_TRANSPARENT,
            ]}
            style={styles.ui}>
            <Header navigateBack={navigateBack} title={title} />

            {isRunningOnAutomotive() && (
              <PlaybackControls videoRef={videoRef} />
            )}

            <Seekbar
              seekBarRef={seekBarRef}
              videoRef={videoRef}
              bifFrameImagesRef={bifFrameImagesRef}
              videoData={videoData}
              handleShowControlsOnKeyEvent={handleShowControlsOnKeyEvent}
            />
            <ControlBar
              videoRef={videoRef}
              captions={toggleCaption}
              captionMenuVisibility={captionMenuVisibility}
              playerControlType={playerControlType}
              isCaptionButtonFocused={isCaptionButtonFocused}
            />
            <ControlBarMenu
              captionMenuVisibility={captionMenuVisibility}
              videoRef={videoRef}
              setSelectedCaptionInMenuBar={setSelectedCaptionInMenuBar}
              setCaptionMenuVisibility={setCaptionVisibility}
            />
          </LinearGradient>
        )}
      </View>
    );
  },
  areVideoPlayerUIPropsEqual,
);

const styles = StyleSheet.create({
  ui: {
    height: '100%',
    width: '100%',
    justifyContent: 'space-between',
  },
  uiContainer: {
    position: 'absolute',
    zIndex: 5,
    height: '100%',
    width: '100%',
  },
});

export default VideoPlayerUI;
