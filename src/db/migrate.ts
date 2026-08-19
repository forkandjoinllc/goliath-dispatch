import 'dotenv/config'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

/**
 * Runs the generated Drizzle migrations, then applies the hand-written SQL in
 * `drizzle/custom/` (triggers and constraints Drizzle cannot express). Custom
 * files are idempotent and safe to re-run.
 */
async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const client = postgres(url, { max: 1, onnotice: () => {} })
  const db = drizzle(client)

  console.log('▸ applying drizzle migrations…')
  await migrate(db, { migrationsFolder: './drizzle' })

  const customDir = join(process.cwd(), 'drizzle', 'custom')
  if (existsSync(customDir)) {
    const files = readdirSync(customDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of files) {
      console.log(`▸ applying custom SQL: ${file}`)
      const sqlText = readFileSync(join(customDir, file), 'utf8')
      await client.unsafe(sqlText)
    }
  }

  console.log('✓ migrations complete')
  await client.end()
}

main().catch((error) => {
  console.error('✗ migration failed:', error)
  process.exit(1)
})
