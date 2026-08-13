import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.hexallm.app',
  appName: 'HexaLLM',
  webDir: 'dist',
  server: {
    // Point to your hosted backend in production.
    // For local dev with `npx cap run android`, set this to your machine's LAN IP,
    // e.g. http://192.168.1.x:8001
    // Leave androidScheme as https for production builds.
    androidScheme: 'https',
    // Only allow mixed content (http) when pointing at a LAN dev host.
    // With androidScheme: 'https', allowing mixed content lets the production
    // webview silently load http:// resources (MITM risk) — keep it off.
    allowMixedContent: false,
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
