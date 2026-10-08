import type { ConfigContext, ExpoConfig } from 'expo/config';

const PROJECT_ID = 'ec207fec-1ece-43a1-b5ef-d4383bc933f3';

export default ({ config }: ConfigContext): ExpoConfig => {
  const easProjectId =
    process.env.EAS_PROJECT_ID ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    PROJECT_ID;

  return {
    ...config,
    name: 'Match',
    slug: 'match',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'match',
    userInterfaceStyle: 'dark',
    backgroundColor: '#15121C',
    owner: process.env.EXPO_OWNER || 'moidys-team',
    // EAS Update (OTA). Each build profile has its own channel in eas.json
    // (development / preview / production). The runtime is the native
    // fingerprint: an update only reaches builds whose native code it matches.
    // If a native dependency or config changes, the fingerprint changes, and
    // old installs simply don't get that update (they need a new build) instead
    // of crashing on a missing native module.
    runtimeVersion: { policy: 'fingerprint' },
    updates: {
      url: `https://u.expo.dev/${easProjectId}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.moidy.match',
      infoPlist: {
        UIBackgroundModes: ['remote-notification'],
        // Only standard HTTPS/TLS is used → exempt from export compliance docs.
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#15121C',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      package: 'com.moidy.match',
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON || undefined,
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          resizeMode: 'contain',
          imageWidth: 220,
          backgroundColor: '#15121C',
        },
      ],
      'expo-secure-store',
      [
        'expo-video',
        {
          supportsBackgroundPlayback: false,
          supportsPictureInPicture: false,
        },
      ],
      [
        'expo-audio',
        {
          microphonePermission: 'Match needs the microphone to record voice messages.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Match needs photo access for your profile pictures, stories and chat photos.',
          cameraPermission: 'Match uses the camera so you can take photos and record video stories.',
          microphonePermission: 'Match uses the microphone to record voice messages and the sound of your video stories.',
        },
      ],
      // LiveKit (real video lives) — native modules, only active in dev/production builds, not Expo Go.
      ['@livekit/react-native-expo-plugin', { android: { audioType: 'communication' } }],
      [
        '@config-plugins/react-native-webrtc',
        {
          cameraPermission: 'Match uses the camera when you go live.',
          microphonePermission: 'Match uses the microphone when you go live or record voice messages.',
        },
      ],
      'expo-dev-client',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Match uses your approximate location (rounded to about 1.5 km) to show distance and people & events near you. Your exact location is never stored or shared.',
          isAndroidBackgroundLocationEnabled: false,
          isIosBackgroundLocationEnabled: false,
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-icon.png',
          color: '#FF5573',
          defaultChannel: 'default',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId: easProjectId,
      },
      router: {},
    },
  };
};
