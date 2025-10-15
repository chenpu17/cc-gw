import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Info, Terminal, Code } from 'lucide-react'
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
    const claudeCodeSteps = t('help.sections.claudeCodeConfig.items', { returnObjects: true }) as string[]
    const codexSteps = t('help.sections.codexConfig.items', { returnObjects: true }) as string[]
    const usageSteps = t('help.sections.usage.items', { returnObjects: true }) as string[]
    const tips = t('help.sections.tips.items', { returnObjects: true }) as string[]
    return [
      {
        title: t('help.sections.configuration.title'),
        items: configSteps
      },
      {
        title: t('help.sections.claudeCodeConfig.title'),
        items: claudeCodeSteps
      },
      {
        title: t('help.sections.codexConfig.title'),
        items: codexSteps
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

      <div className="space-y-8">
        {/* 基础配置流程 */}
        <PageSection title={sections[0].title} className="animate-slide-up" contentClassName="gap-4">
          <StepList items={sections[0].items} />
        </PageSection>

        {/* 客户端配置标题 */}
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t('help.clientConfig.title')}</h2>
          <p className={cn(mutedTextClass, 'text-sm')}>{t('help.clientConfig.subtitle')}</p>
        </div>

        {/* Claude Code 和 Codex 配置区域 */}
        <div className="grid gap-6 lg:grid-cols-2">
          <PageSection
            title={sections[1].title}
            className="h-full animate-slide-up border-2 border-blue-200/60 bg-gradient-to-br from-blue-50/80 via-white/60 to-indigo-50/60 dark:border-blue-700/60 dark:from-blue-900/30 dark:via-slate-900/50 dark:to-indigo-900/30 shadow-lg shadow-blue-100/50 dark:shadow-blue-900/30"
            contentClassName="gap-4"
          >
            <div className="flex items-center gap-3 mb-6 p-3 bg-blue-100/50 rounded-xl dark:bg-blue-900/20">
              <div className="h-10 w-10 rounded-xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Code className="h-5 w-5 text-white" />
              </div>
              <div>
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Claude Code</span>
                <p className="text-xs text-blue-600 dark:text-blue-400">IDE 插件配置</p>
              </div>
            </div>
            <StepList items={sections[1].items} />
          </PageSection>

          <PageSection
            title={sections[2].title}
            className="h-full animate-slide-up border-2 border-green-200/60 bg-gradient-to-br from-green-50/80 via-white/60 to-emerald-50/60 dark:border-green-700/60 dark:from-green-900/30 dark:via-slate-900/50 dark:to-emerald-900/30 shadow-lg shadow-green-100/50 dark:shadow-green-900/30"
            contentClassName="gap-4"
          >
            <div className="flex items-center gap-3 mb-6 p-3 bg-green-100/50 rounded-xl dark:bg-green-900/20">
              <div className="h-10 w-10 rounded-xl bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/30">
                <Terminal className="h-5 w-5 text-white" />
              </div>
              <div>
                <span className="text-sm font-semibold text-green-700 dark:text-green-300">Codex CLI</span>
                <p className="text-xs text-green-600 dark:text-green-400">命令行工具配置</p>
              </div>
            </div>
            <StepList items={sections[2].items} />
          </PageSection>
        </div>

        {/* 使用指南和技巧 */}
        <div className="mt-12">
          <div className="text-center space-y-2 mb-8">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('help.advancedGuide.title')}</h2>
            <p className={cn(mutedTextClass, 'text-sm')}>{t('help.advancedGuide.subtitle')}</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <PageSection title={sections[3].title} className="h-full animate-slide-up" contentClassName="gap-4">
              <StepList items={sections[3].items} />
            </PageSection>
            <PageSection title={sections[4].title} className="h-full animate-slide-up" contentClassName="gap-4">
              <StepList items={sections[4].items} />
            </PageSection>
          </div>
        </div>
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
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 dark:from-blue-400 dark:to-indigo-400 flex-shrink-0">
            {index + 1}
          </span>
          <div className={cn(mutedTextClass, 'text-sm leading-6 flex-1')}>
            <StepContent content={item} />
          </div>
        </li>
      ))}
    </ol>
  )
}

function StepContent({ content }: { content: string }) {
  const { t } = useTranslation()
  // 处理包含代码块的内容
  if (content.includes('```')) {
    const parts = content.split('```')
    return (
      <div className="space-y-2">
        {parts.map((part, index) => {
          if (index % 2 === 0) {
            // 普通文本
            return part ? (
              <div key={index} className="whitespace-pre-line">
                {formatTextWithEmoji(part)}
              </div>
            ) : null
          } else {
            // 代码块
            const [language, ...codeLines] = part.split('\n')
            const code = codeLines.join('\n')
            return (
              <div key={index} className="relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {language || 'bash'}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(code)}
                    className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    {t('common.actions.copy')}
                  </button>
                </div>
                <pre className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 overflow-x-auto text-xs">
                  <code>{code}</code>
                </pre>
              </div>
            )
          }
        })}
      </div>
    )
  }

  // 处理包含换行符的普通文本
  if (content.includes('\n')) {
    return (
      <div className="whitespace-pre-line">
        {formatTextWithEmoji(content)}
      </div>
    )
  }

  // 普通文本
  return <div>{formatTextWithEmoji(content)}</div>
}

function formatTextWithEmoji(text: string) {
  // 保留emoji，处理加粗标记
  const parts = text.split(/(\*\*[^*]+\*\*)/g)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-slate-700 dark:text-slate-200">{part.slice(2, -2)}</strong>
    }
    return <span key={index}>{part}</span>
  })
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
          <dd className={cn(mutedTextClass, 'mt-2 text-sm leading-6')}>
            <FaqAnswer content={item.a} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function FaqAnswer({ content }: { content: string }) {
  const { t } = useTranslation()
  // 处理包含编号列表的内容
  if (content.includes('1)') || content.includes('2)')) {
    const lines = content.split('\n').filter(line => line.trim())

    // 检查是否是编号列表
    const isNumberedList = lines.some(line => /^\d+\)/.test(line.trim()))

    if (isNumberedList) {
      return (
        <div className="space-y-2">
          {lines.map((line, index) => {
            const match = line.match(/^\d+\)\s*(.*)/)
            if (match) {
              return (
                <div key={index} className="flex gap-2">
                  <span className="text-slate-500 dark:text-slate-400">•</span>
                  <span>{match[1]}</span>
                </div>
              )
            }
            return <div key={index}>{line}</div>
          })}
        </div>
      )
    }
  }

  // 处理包含代码块的内容
  if (content.includes('```')) {
    const parts = content.split('```')
    return (
      <div className="space-y-2">
        {parts.map((part, index) => {
          if (index % 2 === 0) {
            // 普通文本
            return part ? (
              <div key={index} className="whitespace-pre-line">
                {part}
              </div>
            ) : null
          } else {
            // 代码块
            const [language, ...codeLines] = part.split('\n')
            const code = codeLines.join('\n')
            return (
              <div key={index} className="relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {language || 'bash'}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(code)}
                    className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    {t('common.actions.copy')}
                  </button>
                </div>
                <pre className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 overflow-x-auto text-xs">
                  <code>{code}</code>
                </pre>
              </div>
            )
          }
        })}
      </div>
    )
  }

  // 处理包含换行符的普通文本
  if (content.includes('\n')) {
    return (
      <div className="whitespace-pre-line">
        {content}
      </div>
    )
  }

  // 普通文本
  return <div>{content}</div>
}
