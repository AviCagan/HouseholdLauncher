import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.avicagan.household',
  appName: 'Household',
  webDir: 'dist',
  android: {
    // https scheme so the WebView origin is secure — required for the service
    // worker, crypto.randomUUID, and clipboard access.
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0e0e12',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0e0e12',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#7c5cff',
    },
    /*
      Over-the-air updates, self-hosted: lib/appUpdate.ts decides when and
      where from (this repository's releases), and the plugin only downloads,
      checks and swaps. Its own update checks, channels and its crash and
      usage reporting all go to Capgo's servers by default, so all three are
      switched off — nothing about the phone or the app leaves for them.
    */
    CapacitorUpdater: {
      autoUpdate: 'off',
      updateUrl: '',
      channelUrl: '',
      statsUrl: '',
      // A bundle that can't confirm it started within this long is undone.
      appReadyTimeout: 15000,
      // A newly installed APK starts from its own bundle again.
      resetWhenUpdate: true,
    },
  },
}

export default config
