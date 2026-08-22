import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  /*
    The same build-time constants vite.config.ts injects.

    They are not real globals, so any module that reads one throws
    ReferenceError the moment a test imports it — even transitively, and even
    when the test has no interest in it. That is how adding one import to
    lib/notifications.ts took out the store and tour suites, neither of which
    knows what a build stamp is.

    Fixed values rather than the real ones on purpose: a test that depends on
    the commit it runs against is a test that fails on someone else's machine.
    FCM_CONFIGURED is false so the default path through the push code is the
    one a plain checkout actually has — google-services.json is never
    committed.
  */
  define: {
    __BUILD_SHA__: JSON.stringify('test'),
    __BUILD_TIME__: JSON.stringify('2026-01-01T00:00:00.000Z'),
    __BUILD_RUN__: JSON.stringify(''),
    __FCM_CONFIGURED__: JSON.stringify(false),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
