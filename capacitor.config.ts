import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vikmix.dj',
  appName: 'VikMix DJ',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
