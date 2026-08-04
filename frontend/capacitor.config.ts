import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.hexallm.app',
  appName: 'HexaLLM AI',
  webDir: 'dist',
  server: {
    // Point to your hosted backend in production.
    // For local dev with `npx cap run android`, set this to your machine's LAN IP,
    // e.g. http://192.168.1.x:8001
    // Leave androidScheme as https for production builds.
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
