import { useI18n } from '@/lib/i18n'

/**
 * Un bloque «título + texto + viñetas» a partir de una raíz del diccionario.
 *
 * Las viñetas se leen como bullet1..bulletN y se para en la primera que falta.
 * Es lo que permite que un bloque con dos viñetas y otro con cinco usen el mismo
 * componente sin declarar cuántas tiene cada uno en el código: el diccionario ya
 * lo dice.
 */
export function FeatureBlock({ root, maxBullets = 6 }: { root: string; maxBullets?: number }) {
  const { t, has } = useI18n()

  const bullets: string[] = []
  for (let index = 1; index <= maxBullets; index += 1) {
    const key = `${root}.bullet${index}`
    if (!has(key)) break
    bullets.push(t(key))
  }

  return (
    <div className="border-l-2 border-safety-500 pl-6">
      <h3 className="font-display text-xl font-bold text-navy-700">{t(`${root}.title`)}</h3>
      <p className="mt-3 text-steel-700">{t(`${root}.body`)}</p>
      {bullets.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex gap-3 text-sm text-steel-700">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-safety-600" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
