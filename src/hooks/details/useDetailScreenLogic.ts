import { useTheme } from '@amazon-devices/kepler-ui-components';
import {
  HWEvent,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Systrace } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';

import { ButtonConfig, Screens } from '../../components/navigation/types';
import { DPADEventType, EVENT_KEY_DOWN } from '../../constants';
import { getClassics } from '../../data/local/classics';
import {
  addToWatchList,
  removeFromWatchList,
  videoDetailSelectors,
} from '../../store/videoDetail/videoDetailSlice';
import { getVerticalCardDimensionsMd } from '../../styles/ThemeAccessors';
import { TitleData } from '../../types/TitleData';
import { focusManager } from '../../utils/FocusManager';

const AddIcon = require('../../assets/add_solid.png');
const DeleteIcon = require('../../assets/delete_icon.png');
const PlayIcon = require('../../assets/play_solid.png');

const Constants = {
  PLAY_MOVIE: 'Play Movie',
  ADD_TO_LIST: 'Add to List',
  RELATED_MOVIES: 'Related Movies:',
  REMOVE_FROM_LIST: 'Remove from List',
};

export const useDetailScreenLogic = (navigation: any, route: any) => {
  const [loading, setLoading] = useState(true);
  const [relatedData, setRelatedData] = useState<Array<TitleData>>([]);
  const [format, setFormat] = useState(route.params.data.format);
  const [showAddToWatchList, setShowAddToWatchList] = useState(true);

  const videoID = route.params.data.id;
  const watchList = useSelector(videoDetailSelectors.watchList);
  const dispatch = useDispatch();

  const currentTitle = useRef<string>(route.params.data.title);
  const focusableElementRef = useRef<any>(null);
  const playMovieButtonRef = useRef<any>(null);

  const headerGuideRef = useRef<any>(null);
  const backFocusedRef = useRef(false);
  const playMovieFocusedRef = useRef(false);

  useTVEventHandler((evt: HWEvent) => {
    if (evt.eventKeyAction !== EVENT_KEY_DOWN) {
      return;
    }
    if (evt.eventType === DPADEventType.DOWN && backFocusedRef.current) {
      playMovieButtonRef.current?.requestTVFocus?.();
    } else if (
      evt.eventType === DPADEventType.UP &&
      playMovieFocusedRef.current
    ) {
      headerGuideRef.current?.requestTVFocus?.();
    }
  });

  const onBackIconFocus = useCallback(() => {
    backFocusedRef.current = true;
  }, []);

  const onBackIconBlur = useCallback(() => {
    backFocusedRef.current = false;
  }, []);

  const onPlayMovieFocus = useCallback(() => {
    playMovieFocusedRef.current = true;
  }, []);

  const rating = route.params.data.rating ?? '';

  const theme = useTheme();
  const cardDimensions = useMemo(
    () => getVerticalCardDimensionsMd(theme),
    [theme],
  );

  useEffect(() => {
    let isMounted = true;

    // Can make this async if it is needed
    const loadData = () => {
      setLoading(true);
      const data = getClassics();
      if (isMounted) {
        setRelatedData(data);
        setLoading(false);
      }
    };
    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const navigateBack = useCallback(() => {
    navigation.goBack();
    return true;
  }, [navigation]);

  useEffect(() => {
    if (Systrace.isEnabled()) {
      Systrace.beginEvent('nav_details_screen');
      Systrace.endEvent();
    }
  }, []);

  useEffect(() => {
    if (Platform.isTV) {
      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        navigateBack,
      );
      return () => backHandler.remove();
    }
  }, [navigateBack]);

  useEffect(() => {
    if (playMovieButtonRef?.current?.requestTVFocus) {
      playMovieButtonRef.current.requestTVFocus();
    }

    return () => {
      // Restore focus when leaving this screen
      if (route.params.focusId) {
        const focusKey = `tile_${route.params.focusId}`;
        focusManager.restoreFocus(focusKey);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check for screen changes and update format
  const checkDetailScreenChanged = useCallback(() => {
    return currentTitle.current !== route.params.data.title;
  }, [currentTitle, route.params.data.title]);

  useEffect(() => {
    const { data } = route.params;
    if (checkDetailScreenChanged()) {
      console.info('Moved onto new Detail Screen');
      setFormat(data.format);
    }
  }, [route.params, checkDetailScreenChanged]);

  const onPressAddToListHandler = useCallback(() => {
    dispatch(addToWatchList(videoID));
    setShowAddToWatchList(false);
  }, [dispatch, videoID]);

  const onPressRemoveFromListHandler = useCallback(() => {
    dispatch(removeFromWatchList(videoID));
    setShowAddToWatchList(true);
  }, [dispatch, videoID]);

  const navigateToPlayer = useCallback(async () => {
    // Register focus restoration callback
    const focusKey = `player_return_${route.params.data.id}`;
    focusManager.registerFocusCallback(focusKey, () => {
      if (focusableElementRef.current?.requestTVFocus) {
        focusableElementRef.current.requestTVFocus();
      }
      if (playMovieButtonRef.current?.requestTVFocus) {
        playMovieButtonRef.current.requestTVFocus();
      }
    });

    const data = {
      data: route.params.data,
      focusId: route.params.data.id,
    };

    navigation.navigate(Screens.PLAYER_SCREEN, data);
  }, [
    navigation,
    route.params.data,
    focusableElementRef,
    playMovieButtonRef,
  ]);

  // Button configuration
  const buttonConfig: ButtonConfig[] = [
    {
      onPress: navigateToPlayer,
      image: PlayIcon,
      label: Constants.PLAY_MOVIE,
      ref: focusableElementRef,
      testID: 'details-action-play-movie-btn',
    },
    {
      onPress: showAddToWatchList
        ? onPressAddToListHandler
        : onPressRemoveFromListHandler,
      image: showAddToWatchList ? AddIcon : DeleteIcon,
      label: showAddToWatchList
        ? Constants.ADD_TO_LIST
        : Constants.REMOVE_FROM_LIST,
      testID: 'details-action-add-remove-btn',
    },
  ];

  useEffect(() => {
    if (videoID) {
      setShowAddToWatchList(!watchList.includes(videoID));
    }
  }, [videoID, watchList]);

  const onBlurPlayMovie = () => {
    playMovieFocusedRef.current = false;
    if (playMovieButtonRef?.current?.blur) {
      playMovieButtonRef.current.blur();
    }
  };

  return {
    loading,
    relatedData,
    buttonConfig,
    cardDimensions,
    playMovieButtonRef,
    navigateBack,
    onBlurPlayMovie,
    format,
    rating,
    headerGuideRef,
    onBackIconFocus,
    onBackIconBlur,
    onPlayMovieFocus,
  };
};
