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
    userInterfaceStyle: 'automatic',
    owner: process.env.EXPO_OWNER || 'moidys-team',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.match.app',
      infoPlist: {
        UIBackgroundModes: ['remote-notification'],
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#0B0B0F',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      package: 'com.match.app',
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
          backgroundColor: '#0B0B0F',
        },
      ],
      'expo-secure-store',
      [
        'expo-image-picker',
        {
          photosPermission: 'Match needs photo access to set your profile pictures.',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/icon.png',
          color: '#E11D48',
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
