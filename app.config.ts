import type { ConfigContext, ExpoConfig } from 'expo/config';

// Each variant is a separate app (own app ID, name, icon and cookie jar), so
// each stays logged in to its own Instagram account. Variants come from
// variants.json plus the git-ignored local/variants.json (see scripts/variants.js).
//   APP_VARIANT=two npx expo run:android
const { loadVariants, defaultVariantId } = require('./scripts/variants') as typeof import('./scripts/variants');

const variants = loadVariants();
const variantId = defaultVariantId();
const variant = variants.find((v) => v.id === variantId);
if (!variant) {
  throw new Error(`Unknown APP_VARIANT "${variantId}". Use one of: ${variants.map((v) => v.id).join(', ')}`);
}
const asset = (file?: string) => (file ? `./${file}` : undefined);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant.name,
  slug: 'anti-brainrot',
  scheme: variant.appId,
  // CI sets these from the git tag (v1.2.3 -> 1.2.3 / 10203); local builds use the defaults.
  version: process.env.APP_VERSION ?? '1.0.0',
  orientation: 'portrait',
  icon: asset(variant.icon),
  userInterfaceStyle: 'dark',
  backgroundColor: '#000000',
  ios: {
    bundleIdentifier: variant.appId,
    buildNumber: process.env.APP_VERSION_CODE ?? '1',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'Send photos and videos, and join video calls, in your DMs.',
      NSMicrophoneUsageDescription: 'Record voice messages and join calls in your DMs.',
      NSPhotoLibraryUsageDescription: 'Attach photos and videos to your DMs.',
    },
  },
  android: {
    package: variant.appId,
    versionCode: Number(process.env.APP_VERSION_CODE ?? 1),
    adaptiveIcon: {
      backgroundColor: variant.color ?? '#000000',
      // Without a dedicated foreground, the full icon is used and Android crops
      // its edges to the launcher's shape: keep the important part centred.
      foregroundImage: asset(variant.adaptiveForeground ?? variant.icon),
      backgroundImage: asset(variant.adaptiveBackground),
      monochromeImage: asset(variant.monochrome),
    },
    permissions: ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS'],
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-web-browser',
    'expo-sqlite',
    'expo-background-task',
    ['expo-notifications', { icon: asset(variant.monochrome ?? 'assets/variants/monochrome.png'), color: variant.accent ?? '#0095F6' }],
  ],
  extra: { variant: variant.id },
});
