import 'dotenv/config'
import postgres from 'postgres'

/**
 * Drops and recreates the public schema. Development and test only — refuses to
 * run against anything that looks like a production database.
 */
async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset the database in a production environment')
  }

  const client = postgres(url, { max: 1, onnotice: () => {} })
  console.log('▸ dropping schemas public and drizzle…')
  await client.unsafe(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  )
  console.log('✓ schema reset')
  await client.end()
}

main().catch((error) => {
  console.error('✗ reset failed:', error)
  process.exit(1)
})
