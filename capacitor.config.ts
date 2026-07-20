import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAP_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'com.morphemedesk.vocabulary',
  appName: 'Morpheme Desk',
  webDir: 'dist',
  loggingBehavior: 'none',
  ...(serverUrl
    ? {
      server: {
        url: serverUrl,
        cleartext: serverUrl.startsWith('http://'),
      },
    }
    : {}),
};

export default config;
