import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const compat = new FlatCompat({ baseDirectory: __dirname })

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      'drizzle/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'dist/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/client'],
              importNames: ['unsafeDb'],
              message:
                'Use tenantDb()/withTenant() so tenant scoping is enforced. unsafeDb is only for migrations, seeds and platform-level jobs.',
            },
          ],
        },
      ],
    },
  },
  {
    // Layers that legitimately operate above a single tenant:
    //  • src/db/**        — migrations, seeds, the tenant-scoped wrapper itself
    //  • src/jobs/**      — schedulers that sweep every tenant in turn
    //  • src/lib/auth/**  — sessions and identity are global, not tenant-owned
    //  • src/lib/audit.ts — writes platform-level events with no active tenant
    //  • src/server/context.ts — resolves which tenant the actor is even in
    //  • src/server/platform/** — Super Admin tooling
    files: [
      'src/db/**',
      'src/jobs/**',
      'src/lib/auth/**',
      'src/lib/audit.ts',
      'src/lib/rate-limit.ts',
      'src/server/context.ts',
      'src/server/platform/**',
      // Identity, tenancy and billing are global by definition: a user, a
      // session, a tenant row and a subscription exist above any one tenant.
      'src/server/auth/**',
      'src/server/tenants/**',
      'src/server/search/**',
      'src/app/api/**',
      'tests/**',
      'scripts/**',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
    rules: { 'no-restricted-imports': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
]

export default config
