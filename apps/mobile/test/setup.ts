/* Global mocks for the screen smoke tests. */
jest.mock('@/lib/supabase', () => require('./supabaseMock'));

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: async () => undefined,
}));

jest.mock('react-native-purchases', () => {
  const Purchases = {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    logIn: jest.fn(async () => ({})),
    logOut: jest.fn(async () => ({})),
    getOfferings: jest.fn(async () => ({ current: null, all: {} })),
    getCustomerInfo: jest.fn(async () => ({ entitlements: { active: {} } })),
    purchasePackage: jest.fn(async () => ({})),
    restorePurchases: jest.fn(async () => ({ entitlements: { active: {} } })),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
  };
  return { __esModule: true, default: Purchases, LOG_LEVEL: { WARN: 'WARN', DEBUG: 'DEBUG' }, PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' } };
});

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 38.72, longitude: -9.14 } })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  reverseGeocodeAsync: jest.fn(async () => []),
  Accuracy: { Balanced: 3 },
}));

jest.mock('expo-video', () => {
  const { View } = require('react-native');
  return { VideoView: View, useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn(), loop: false, muted: true }) };
});

jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), remove: jest.fn() }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0 }),
  useAudioRecorder: () => ({ prepareToRecordAsync: jest.fn(), record: jest.fn(), stop: jest.fn(), uri: null }),
  useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: false })),
  setAudioModeAsync: jest.fn(async () => undefined),
  RecordingPresets: { HIGH_QUALITY: {} },
}));

jest.mock('expo-blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});

// Icons: a lightweight stand-in (the real package ships ESM-only for RN and
// thousands of modules, which only slows the smoke tests down).
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const icons: Record<string, unknown> = {};
  return new Proxy(
    { __esModule: true },
    {
      get(target: Record<string, unknown>, name: string) {
        if (name in target) return target[name];
        if (!icons[name]) {
          const Icon = (props: Record<string, unknown>) => React.createElement(View, { testID: `icon-${name}`, style: props.style });
          Icon.displayName = name;
          icons[name] = Icon;
        }
        return icons[name];
      },
    }
  );
});
