import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // Next's webpack config resolves the `server-only` marker package to its
      // no-op `react-server` export condition; outside of Next's bundler (i.e.
      // under Vitest) the package's default export throws unconditionally.
      // Every server-side module in this codebase imports it, so any of them
      // being unit-testable at all depends on this alias.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./tests/setup/global-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/lib/**', 'src/server/**', 'src/integrations/**', 'src/jobs/**'],
      exclude: ['**/*.d.ts', '**/index.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['./tests/setup/global-setup.ts', './tests/setup/db-setup.ts'],
          hookTimeout: 120_000,
          testTimeout: 60_000,
          // Integration tests share one database; run their files serially.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['./tests/setup/global-setup.ts', './tests/setup/dom-setup.ts'],
        },
      },
    ],
  },
})
