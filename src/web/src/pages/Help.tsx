import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface HelpSection {
  title: string
  items: string[]
}

export default function HelpPage(): JSX.Element {
  const { t } = useTranslation()

  const sections = useMemo<HelpSection[]>(() => {
    const configSteps = t('help.sections.configuration.items', { returnObjects: true }) as string[]
    const usageSteps = t('help.sections.usage.items', { returnObjects: true }) as string[]
    const tips = t('help.sections.tips.items', { returnObjects: true }) as string[]
    return [
      {
        title: t('help.sections.configuration.title'),
        items: configSteps
      },
      {
        title: t('help.sections.usage.title'),
        items: usageSteps
      },
      {
        title: t('help.sections.tips.title'),
        items: tips
      }
    ]
  }, [t])

  const faqItems = t('help.faq.items', { returnObjects: true }) as Array<{ q: string; a: string }>

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{t('help.title')}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('help.intro')}</p>
        <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/60 dark:text-blue-200">
          {t('help.note')}
        </div>
      </header>

      {sections.map((section) => (
        <section key={section.title} className="space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          <ol className="list-decimal space-y-2 pl-6 text-sm text-slate-700 dark:text-slate-300">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      ))}

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">{t('help.faq.title')}</h2>
        <dl className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
          {faqItems.map((item) => (
            <div key={item.q} className="space-y-1">
              <dt className="font-medium text-slate-900 dark:text-slate-100">{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

