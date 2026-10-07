import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config. EAS projectId comes from env after `eas init`,
 * or stays as the explicit placeholder until then.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const easProjectId =
    process.env.EAS_PROJECT_ID ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    'replace-after-eas-init';

  return {
    ...config,
    name: 'Match',
    slug: 'match',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'match',
    userInterfaceStyle: 'automatic',
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
    owner: process.env.EXPO_OWNER || undefined,
  };
};
