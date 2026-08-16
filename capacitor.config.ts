import type { CapacitorConfig } from '@capacitor/cli';

// Android builds should open the hosted Funnel app by default. The Funnel
// exposes both the frontend and the local Node/SQLite/Hermes API under the
// same origin, so range data and review progress work on the phone too.
// Local testing can still override it with CAP_SERVER_URL=http://127.0.0.1:5173
// (or another LAN/Tailscale URL).
const serverUrl = process.env.CAP_SERVER_URL?.trim()
  || 'https://desktop-loi23mp.tail9c076e.ts.net/eng-vocabulary/';

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
