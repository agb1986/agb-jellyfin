import { getModel } from '@amazon-devices/react-native-device-info';
import { Dimensions, Platform } from 'react-native';

const modelValue = getModel();
/* This model AQVV01P was included because the new simulator Kepler Virtual Device is using this identifier
A refactor for this implementation is required, in order to remove hardcoded values for simulators */
const isSimulator =
  modelValue.includes('simulator') || modelValue.includes('AQVV01P');

const isRunningOnAutomotive = () => {
  return !isSimulator && !Platform.isTV;
};

const isRunningOnTVSimulator = () => {
  return modelValue.includes('tv-simulator') && Platform.isTV;
};

const isRunningOnSimulator = () => {
  return isRunningOnAutomotive() || isRunningOnTVSimulator();
};

/*
  Expected outputs for: { isTV: Platform.isTV, model: getModel(), platform: Platform.OS }

  TV SIMULATOR RETURNS {"isTV": true, "model": "tv-simulator", "platform": "kepler"}
  AUTOMOTIVE SIMULATOR RETURNS {"isTV": false, "model": "AQVV01P", "platform": "kepler"}
  CALLIE TV RETURNS {"isTV": true, "model": "AFTCA002", "platform": "kepler"}
*/

/**
 * Version reported to the Jellyfin server; it appears beside this device in
 * the dashboard. Keep in step with `package.json` and `manifest.toml` — those
 * are read by the build, not by the bundle, so there is nothing to import.
 */
const APP_VERSION = '0.1.0';

/** Client name shown in the Jellyfin dashboard and on the approval prompt. */
const JELLYFIN_CLIENT_NAME = 'Jellyfin Vega';

/**
 * Launch into the Jellyfin client rather than the sample's own screens. The
 * sample UI stays reachable while its components are being replaced.
 */
const isJellyfinClientEnabled = () => {
  return true;
};

/**
 * Development-only: launch straight into the playback spike harness instead of
 * the sample's home screen. The spike answers whether Vega can decode the
 * container/codec combinations a Jellyfin server emits, which gates the whole
 * project. Results are recorded in docs/playback-spike-results.md, so this is
 * off; the harness stays in the tree because it still has to be re-run on
 * armv7 hardware, where the HEVC and AC-3 answers may differ.
 */
const isPlaybackSpikeEnabled = () => {
  return false;
};

/**
 * Based on the device dimensions, we can enable or disable the control of the D-pad.
 *
 * @returns flag to indicate if D-pad controller is supported.
 */
const isDpadControllerSupported = () => {
  if (Dimensions.get('window').width < Dimensions.get('window').height) {
    return false;
  }
  return true;
};

export {
  APP_VERSION,
  isJellyfinClientEnabled,
  isPlaybackSpikeEnabled,
  JELLYFIN_CLIENT_NAME,
  isDpadControllerSupported,
  isRunningOnAutomotive,
  isRunningOnTVSimulator,
  isRunningOnSimulator,
};
