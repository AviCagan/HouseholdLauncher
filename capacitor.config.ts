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
  },
}

export default config
