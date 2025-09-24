import { useEffect, useMemo } from 'react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import type { ApiError } from '@/services/api'
import packageJson from '../../../../package.json' assert { type: 'json' }

interface StatusResponse {
  port: number
  host?: string
  providers: number
}

const referenceLinks = [
  {
    label: '项目仓库',
    href: 'https://github.com/chenpu/cc-local-gw'
  },
  {
    label: '参考代码 · claude-code-proxy',
    href: 'https://github.com/anthropics/claude-code-proxy'
  },
  {
    label: '参考代码 · claude-code-router',
    href: 'https://github.com/anthropics/claude-code-router'
  }
]

export default function AboutPage() {
  const { pushToast } = useToast()
  const statusQuery = useApiQuery<StatusResponse, ApiError>(
    ['status', 'gateway'],
    { url: '/api/status', method: 'GET' },
    {
      staleTime: 60_000
    }
  )

  useEffect(() => {
    if (statusQuery.isError && statusQuery.error) {
      pushToast({
        title: '状态加载失败',
        description: statusQuery.error.message,
        variant: 'error'
      })
    }
  }, [statusQuery.isError, statusQuery.error, pushToast])

  const appVersion = (packageJson as { version?: string }).version ?? '0.0.0'

  const buildInfo = useMemo(() => {
    const env = import.meta.env
    const buildTime = env.VITE_BUILD_TIME ?? '-'
    const nodeVersion = env.VITE_NODE_VERSION ?? '-'
    return {
      buildTime,
      nodeVersion
    }
  }, [])

  const handleCheckUpdates = () => {
    pushToast({
      title: '功能开发中',
      description: '检查更新功能将在后续版本提供。',
      variant: 'info'
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">关于</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          了解 cc-gw 的版本信息、构建元数据以及参考资源。
        </p>
      </header>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">应用信息</h2>
          <dl className="grid grid-cols-[110px_1fr] gap-2 text-sm text-slate-600 dark:text-slate-300">
            <dt className="font-medium">名称</dt>
            <dd>cc-local-gw</dd>
            <dt className="font-medium">版本</dt>
            <dd>{appVersion}</dd>
            <dt className="font-medium">构建时间</dt>
            <dd>{buildInfo.buildTime}</dd>
            <dt className="font-medium">Node 版本</dt>
            <dd>{buildInfo.nodeVersion}</dd>
          </dl>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">运行状态</h2>
          {statusQuery.isLoading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">正在获取运行状态...</p>
          ) : statusQuery.data ? (
            <dl className="grid grid-cols-[110px_1fr] gap-2 text-sm text-slate-600 dark:text-slate-300">
              <dt className="font-medium">监听地址</dt>
              <dd>{statusQuery.data.host ?? '0.0.0.0'}</dd>
              <dt className="font-medium">监听端口</dt>
              <dd>{statusQuery.data.port}</dd>
              <dt className="font-medium">已配置 Provider</dt>
              <dd>{statusQuery.data.providers}</dd>
            </dl>
          ) : (
            <p className="text-sm text-red-500">未能获取状态信息。</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">参考与支持</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              以下资源可帮助你了解项目背景并获取支持。
            </p>
          </div>
          <button
            type="button"
            onClick={handleCheckUpdates}
            className="rounded-md border border-slate-200 px-3 py-1 text-sm transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            检查更新
          </button>
        </div>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {referenceLinks.map((item) => (
            <li key={item.href} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/50">
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
              >
                <span>{item.label}</span>
                <span aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">致谢</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          感谢 OpenAI 与 Anthropic 提供的 API 与 SDK；本项目参考了 claude-code 系列开源实现，
          并针对本地网关需求进行了定制化开发。
        </p>
      </section>
    </div>
  )
}
