/**
 * Single source of truth for the database schema.
 * drizzle-kit reads this file; the application imports tables from here.
 */
export * from './_shared'
export * from './tenant'
export * from './auth'
export * from './carrier'
export * from './document'
export * from './equipment'
export * from './driver'
export * from './customer'
export * from './load'
export * from './route'
export * from './finance'
export * from './signature'
export * from './messaging'
export * from './tracking'
export * from './platform'
