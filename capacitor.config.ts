import type { CapacitorConfig } from '@capacitor/cli';

// Android builds should open the hosted app by default. This keeps every APK
// on the same GitHub Pages frontend/API configuration as the web app. Local
// testing can still override it with CAP_SERVER_URL=http://127.0.0.1:5173.
const serverUrl = process.env.CAP_SERVER_URL?.trim()
  || 'https://a131805956-ctrl.github.io/english-vocabulary-desk/';

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
