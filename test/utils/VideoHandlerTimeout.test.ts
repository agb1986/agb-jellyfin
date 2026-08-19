import { VideoHandler } from '../../src/utils/VideoHandler';

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  // VideoHandler builds its methods with useCallback inside the constructor;
  // outside a component that has to be the identity function.
  useCallback: (fn: unknown) => fn,
}));

jest.mock('@amazon-devices/react-native-w3cmedia');

jest.mock('../../src/utils/AppOverrideMediaControlHandler', () => ({
  AppOverrideMediaControlHandler: jest.fn(),
}));

/**
 * Covers the one behaviour that decides whether anything plays at all on a
 * device where Kepler Media Controls never answers.
 */
describe('preBufferVideo when media controls never answer', () => {
  const titleData = {
    id: 'item-1',
    title: 'Arrival',
    description: '',
    uri: 'http://jellyfin.local:8096/videos/item-1/master.m3u8',
    format: 'HLS',
    mediaType: 'video' as const,
    mediaSourceType: 'url' as const,
    categories: [],
    channelID: '',
    posterUrl: '',
    rentAmount: '',
    secure: false,
    uhd: false,
  };

  it('initializes the player even when setMediaControlFocus hangs', async () => {
    // The virtual device does exactly this: the promise never settles, and
    // because initialize() runs after it the player silently never starts.
    jest.useFakeTimers();

    const initialize = jest.fn().mockResolvedValue(undefined);
    const videoRef = {
      current: {
        // A promise that is never resolved or rejected.
        setMediaControlFocus: jest.fn(() => new Promise(() => {})),
        initialize,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        deinitializeSync: jest.fn(),
        clearSurfaceHandle: jest.fn(),
        clearCaptionViewHandle: jest.fn(),
      },
    } as any;

    const handler = new VideoHandler(
      videoRef,
      { current: null } as any,
      titleData,
      jest.fn(),
      jest.fn(),
      jest.fn(),
      jest.fn(),
      jest.fn(),
    );

    const prebuffer = handler.preBufferVideo({} as any);

    // Nothing can happen until the timeout fires.
    await Promise.resolve();
    jest.advanceTimersByTime(3000);
    await prebuffer;

    expect(videoRef.current.setMediaControlFocus).toHaveBeenCalled();
    expect(initialize).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
