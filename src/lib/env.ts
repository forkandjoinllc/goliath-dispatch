import { z } from 'zod'

/**
 * Runtime environment contract. Parsed once, lazily, so that importing this
 * module in an edge/client bundle does not throw — only reading `env` does.
 *
 * Secrets are never re-exported to the client; the only values allowed through
 * are those under `publicEnv`, which are compile-time inlined by Next.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())))

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  TEST_DATABASE_URL: z.string().optional(),

  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  ENCRYPTION_KEY: z.string().min(16, 'ENCRYPTION_KEY must be at least 16 characters'),
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  SIGNATURE_HASH_PEPPER: z.string().min(16),
  PUBLIC_TRACKING_TOKEN_SECRET: z.string().min(16),
  CRON_SECRET: z.string().min(16),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('goliath-dispatch-dev'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default(false),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  LOCAL_STORAGE_ROOT: z.string().default('./.local-storage'),

  STRIPE_DRIVER: z.enum(['mock', 'live']).default('mock'),
  STRIPE_SECRET_KEY: z.string().default('sk_test_placeholder'),
  STRIPE_WEBHOOK_SECRET: z.string().default('whsec_placeholder'),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_GROWTH: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),

  SMS_DRIVER: z.enum(['mock', 'twilio']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  EMAIL_DRIVER: z.enum(['mock', 'mailgun']).default('mock'),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MAILGUN_REGION: z.enum(['us', 'eu']).default('us'),
  EMAIL_FROM: z.string().default('Goliath Dispatch <no-reply@example.com>'),

  GEO_DRIVER: z.enum(['mock', 'google']).default('mock'),
  GOOGLE_MAPS_SERVER_API_KEY: z.string().optional(),

  FMCSA_DRIVER: z.enum(['mock', 'qcmobile']).default('mock'),
  FMCSA_WEBKEY: z.string().optional(),
  FMCSA_BASE_URL: z.string().default('https://mobile.fmcsa.dot.gov/qc/services'),

  OCR_DRIVER: z.enum(['mock', 'textract', 'docai']).default('mock'),
  MALWARE_SCAN_DRIVER: z.enum(['noop', 'clamav']).default('noop'),

  TRACKING_DEFAULT_PROVIDER: z
    .enum(['mock', 'trucker_tools', 'macropoint', 'highway'])
    .default('mock'),

  JOBS_DRIVER: z.enum(['database', 'qstash']).default('database'),
  RATE_LIMIT_DRIVER: z.enum(['memory', 'database']).default('memory'),
  PUBLIC_FORM_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),

  SEED_DEMO_PASSWORD: z.string().default('DemoPassw0rd!2026'),
  ALLOW_DEMO_SEED: booleanish.default(true),
})

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Goliath Dispatch'),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().default('pk_test_placeholder'),
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY: z.string().optional(),
})

export type ServerEnv = z.infer<typeof serverSchema>
export type PublicEnv = z.infer<typeof publicSchema>

let cachedServerEnv: ServerEnv | null = null

/** Server-only configuration. Throws with a readable summary if misconfigured. */
export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv
  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the required values.`,
    )
  }
  cachedServerEnv = parsed.data
  return cachedServerEnv
}

/**
 * Public configuration. Reads the literal `process.env.NEXT_PUBLIC_*` members so
 * the Next compiler can inline them into the client bundle.
 */
export const publicEnv: PublicEnv = publicSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY,
})

export const isProduction = () => serverEnv().APP_ENV === 'production'
export const isTest = () => process.env.NODE_ENV === 'test' || process.env.APP_ENV === 'test'
