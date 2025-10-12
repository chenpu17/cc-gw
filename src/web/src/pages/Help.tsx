import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Info } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { cn } from '@/utils/cn'
import { mutedTextClass } from '@/styles/theme'

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
    <div className="space-y-8">
      <PageHeader
        icon={<BookOpen className="h-6 w-6" aria-hidden="true" />}
        title={t('help.title')}
        description={t('help.intro')}
      />

      <div className="rounded-3xl border border-blue-200/40 bg-gradient-to-br from-blue-50/90 via-white/90 to-purple-50/80 p-6 shadow-lg shadow-blue-100/40 backdrop-blur-sm dark:border-blue-900/30 dark:from-blue-900/40 dark:via-slate-900/70 dark:to-indigo-900/30 dark:shadow-indigo-900/40">
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-200">
            <Info className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className={cn(mutedTextClass, 'text-sm leading-6')}>
            {t('help.note')}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {sections.map((section) => (
          <PageSection key={section.title} title={section.title} className="h-full" contentClassName="gap-4">
            <StepList items={section.items} />
          </PageSection>
        ))}
      </div>

      <PageSection title={t('help.faq.title')} contentClassName="gap-4">
        <FaqList items={faqItems} />
      </PageSection>
    </div>
  )
}

function StepList({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((item, index) => (
        <li
          key={`${index}-${item}`}
          className="group flex gap-4 rounded-3xl border border-slate-200/60 bg-white p-4 shadow-sm shadow-slate-200/30 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200/60 hover:shadow-md hover:shadow-blue-200/40 dark:border-slate-700/60 dark:bg-slate-900/80 dark:shadow-slate-900/40 dark:hover:border-blue-500/40"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 dark:from-blue-400 dark:to-indigo-400">
            {index + 1}
          </span>
          <p className={cn(mutedTextClass, 'text-sm leading-6')}>
            {item}
          </p>
        </li>
      ))}
    </ol>
  )
}

function FaqList({ items }: { items: Array<{ q: string; a: string }> }) {
  if (items.length === 0) {
    return null
  }
  return (
    <dl className="flex flex-col gap-4">
      {items.map((item) => (
        <div
          key={item.q}
          className="rounded-3xl border border-slate-200/60 bg-white p-5 shadow-sm shadow-slate-200/30 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200/60 hover:shadow-md hover:shadow-blue-200/40 dark:border-slate-700/60 dark:bg-slate-900/80 dark:shadow-slate-900/40 dark:hover:border-blue-500/40"
        >
          <dt className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.q}</dt>
          <dd className={cn(mutedTextClass, 'mt-2 text-sm leading-6')}>{item.a}</dd>
        </div>
      ))}
    </dl>
  )
}
