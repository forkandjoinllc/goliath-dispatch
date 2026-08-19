import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { scanI18nUsage } from '../../../scripts/check-i18n-usage'

/**
 * Regression guard for `npm run check:i18n`: every `t('…')` / `messageKey:
 * '…'` string-literal call site in `src/**` must resolve against the English
 * dictionary. This is what makes a typo'd or renamed key (e.g.
 * `t('factoring.manualNoticeShort')` missing its `finance.` namespace
 * prefix) fail CI instead of shipping as a raw, untranslated key string in
 * the UI.
 *
 * Template-literal keys (`t(\`status.${status}\`)`) cannot be resolved
 * statically and are intentionally excluded — those are spot-checked by hand
 * against the enums that drive them.
 */
describe('static i18n usage sweep', () => {
  it('every statically-resolvable t()/messageKey key resolves in the dictionary', () => {
    const root = resolve(__dirname, '../../..')
    const { missing } = scanI18nUsage(root)

    expect(
      missing,
      missing.map((m) => `${m.file}:${m.line}  "${m.key}"  (${m.reason})`).join('\n'),
    ).toEqual([])
  })
})
