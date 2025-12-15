import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Info, Terminal, Code } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { copyToClipboard } from '@/utils/clipboard'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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
    <div className="space-y-6">
      <PageHeader
        icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
        title={t('help.title')}
        description={t('help.intro')}
      />

      <Card>
        <CardContent className="flex items-start gap-4 pt-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Info className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('help.note')}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {/* Basic configuration */}
        <PageSection title={sections[0].title}>
          <StepList items={sections[0].items} />
        </PageSection>

        {/* Client configuration header */}
        <div className="space-y-1 text-center">
          <h2 className="text-xl font-semibold">{t('help.clientConfig.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('help.clientConfig.subtitle')}</p>
        </div>

        {/* Claude Code and Codex configuration */}
        <div className="grid gap-6 lg:grid-cols-2">
          <PageSection title={sections[1].title}>
            <div className="mb-4 flex items-center gap-3 rounded-lg bg-primary/5 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Code className="h-4 w-4" />
              </div>
              <div>
                <span className="text-sm font-medium">Claude Code</span>
                <p className="text-xs text-muted-foreground">IDE 插件配置</p>
              </div>
            </div>
            <StepList items={sections[1].items} />
          </PageSection>

          <PageSection title={sections[2].title}>
            <div className="mb-4 flex items-center gap-3 rounded-lg bg-emerald-500/5 p-3 dark:bg-emerald-500/10">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white">
                <Terminal className="h-4 w-4" />
              </div>
              <div>
                <span className="text-sm font-medium">Codex CLI</span>
                <p className="text-xs text-muted-foreground">命令行工具配置</p>
              </div>
            </div>
            <StepList items={sections[2].items} />
          </PageSection>
        </div>

        {/* Usage guide and tips */}
        <div className="mt-8">
          <div className="mb-6 space-y-1 text-center">
            <h2 className="text-lg font-semibold">{t('help.advancedGuide.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('help.advancedGuide.subtitle')}</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <PageSection title={sections[3].title}>
              <StepList items={sections[3].items} />
            </PageSection>
            <PageSection title={sections[4].title}>
              <StepList items={sections[4].items} />
            </PageSection>
          </div>
        </div>
      </div>

      <PageSection title={t('help.faq.title')}>
        <FaqList items={faqItems} />
      </PageSection>
    </div>
  )
}

function StepList({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li
          key={`${index}-${item}`}
          className="flex gap-3 rounded-lg border p-3"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-medium text-primary-foreground">
            {index + 1}
          </span>
          <div className="flex-1 text-sm text-muted-foreground">
            <StepContent content={item} />
          </div>
        </li>
      ))}
    </ol>
  )
}

function StepContent({ content }: { content: string }) {
  const { t } = useTranslation()
  // Handle content with code blocks
  if (content.includes('```')) {
    const parts = content.split('```')
    return (
      <div className="space-y-2">
        {parts.map((part, index) => {
          if (index % 2 === 0) {
            // Regular text
            return part ? (
              <div key={index} className="whitespace-pre-line">
                {formatTextWithEmoji(part)}
              </div>
            ) : null
          } else {
            // Code block
            const [language, ...codeLines] = part.split('\n')
            const code = codeLines.join('\n')
            return (
              <div key={index} className="relative">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {language || 'bash'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => copyToClipboard(code)}
                  >
                    {t('common.actions.copy')}
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
                  <code>{code}</code>
                </pre>
              </div>
            )
          }
        })}
      </div>
    )
  }

  // Handle content with line breaks
  if (content.includes('\n')) {
    return (
      <div className="whitespace-pre-line">
        {formatTextWithEmoji(content)}
      </div>
    )
  }

  // Regular text
  return <div>{formatTextWithEmoji(content)}</div>
}

function formatTextWithEmoji(text: string) {
  // Preserve emoji, handle bold markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-medium text-foreground">{part.slice(2, -2)}</strong>
    }
    return <span key={index}>{part}</span>
  })
}

function FaqList({ items }: { items: Array<{ q: string; a: string }> }) {
  if (items.length === 0) {
    return null
  }
  return (
    <dl className="flex flex-col gap-3">
      {items.map((item) => (
        <Card key={item.q}>
          <CardContent className="pt-4">
            <dt className="text-sm font-medium">{item.q}</dt>
            <dd className="mt-2 text-sm text-muted-foreground">
              <FaqAnswer content={item.a} />
            </dd>
          </CardContent>
        </Card>
      ))}
    </dl>
  )
}

function FaqAnswer({ content }: { content: string }) {
  const { t } = useTranslation()
  // Handle content with numbered list
  if (content.includes('1)') || content.includes('2)')) {
    const lines = content.split('\n').filter(line => line.trim())

    // Check if it's a numbered list
    const isNumberedList = lines.some(line => /^\d+\)/.test(line.trim()))

    if (isNumberedList) {
      return (
        <div className="space-y-1">
          {lines.map((line, index) => {
            const match = line.match(/^\d+\)\s*(.*)/)
            if (match) {
              return (
                <div key={index} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
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

  // Handle content with code blocks
  if (content.includes('```')) {
    const parts = content.split('```')
    return (
      <div className="space-y-2">
        {parts.map((part, index) => {
          if (index % 2 === 0) {
            // Regular text
            return part ? (
              <div key={index} className="whitespace-pre-line">
                {part}
              </div>
            ) : null
          } else {
            // Code block
            const [language, ...codeLines] = part.split('\n')
            const code = codeLines.join('\n')
            return (
              <div key={index} className="relative">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {language || 'bash'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => copyToClipboard(code)}
                  >
                    {t('common.actions.copy')}
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs">
                  <code>{code}</code>
                </pre>
              </div>
            )
          }
        })}
      </div>
    )
  }

  // Handle content with line breaks
  if (content.includes('\n')) {
    return (
      <div className="whitespace-pre-line">
        {content}
      </div>
    )
  }

  // Regular text
  return <div>{content}</div>
}
