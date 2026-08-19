/**
 * Type declarations for `headers.mjs`, kept as plain ESM JS (not TS) so
 * `next.config.mjs` — evaluated before any TypeScript transpile — can import
 * it directly. This file exists only so `middleware.ts` gets real types
 * instead of an implicit `any` when it imports the same module.
 */
export function contentSecurityPolicy(nonce?: string): string

export interface SecurityHeaderOptions {
  includeCsp?: boolean
}

export function securityHeaders(
  nonce?: string,
  options?: SecurityHeaderOptions,
): Array<{ key: string; value: string }>
