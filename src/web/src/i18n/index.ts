import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const resources = {
  zh: {
    translation: {
      app: {
        title: 'cc-gw 控制台',
        skipToContent: '跳转到主要内容'
      },
      nav: {
        dashboard: '仪表盘',
        logs: '请求日志',
        models: '模型管理',
        settings: '设置',
        about: '关于'
      },
      language: {
        zh: '简体中文',
        en: 'English'
      },
      common: {
        loading: '加载中...',
        loadingShort: '加载中...',
        noData: '暂无数据',
        languageSelector: '语言选择',
        actions: {
          refresh: '刷新',
          refreshing: '刷新中...',
          manualRefresh: '手动刷新',
          reset: '重置',
          close: '关闭',
          openNavigation: '打开导航',
          closeNavigation: '关闭导航',
          save: '保存设置',
          saving: '保存中...',
          cancel: '取消',
          copy: '复制',
          testConnection: '测试连接',
          testingConnection: '测试中...',
          cleanup: '清理历史日志',
          cleaning: '清理中...',
          checkUpdates: '检查更新'
        },
        theme: {
          label: '主题',
          light: '亮色',
          dark: '暗色',
          system: '跟随系统'
        },
        status: {
          success: '成功',
          error: '失败'
        },
        notifications: {
          featureInProgress: '功能开发中，敬请期待。'
        },
        units: {
          request: '次',
          ms: 'ms',
          token: 'Tokens',
          msPerToken: 'ms/Token'
        }
      },
      dashboard: {
        description: '快速了解请求规模与实时运行状态。',
        status: {
          listening: '监听：{{host}}:{{port}}',
          providers: 'Provider 数量：{{value}}',
          todayRequests: '今日请求：{{value}}',
          active: '活动请求：{{value}}',
          dbSize: '数据库：{{value}}'
        },
        toast: {
          overviewError: '统计数据获取失败',
          dailyError: '趋势数据获取失败',
          modelError: '模型统计获取失败',
          statusError: '状态信息获取失败',
          dbError: '数据库信息获取失败',
          recentError: '最近请求获取失败'
        },
        cards: {
          todayRequests: '今日请求数',
          todayInput: '今日输入 Tokens',
          todayOutput: '今日输出 Tokens',
          avgLatency: '平均响应耗时'
        },
        charts: {
          requestsTitle: '请求趋势',
          requestsDesc: '最近 14 天请求与 Token 走势',
          modelTitle: '模型调用分布',
          modelDesc: '近 7 天不同模型的调用次数',
          barRequests: '请求数',
          lineInput: '输入 Tokens',
          lineOutput: '输出 Tokens',
          ttftLabel: 'TTFT(ms)',
          tpotLabel: 'TPOT(ms/Token)',
          axisLatency: '耗时 (ms)'
        },
        recent: {
          title: '最新请求',
          subtitle: '仅展示最近 {{count}} 条记录',
          loading: '加载中...',
          empty: '暂无请求记录',
          routePlaceholder: '未指定',
          columns: {
            time: '时间',
            provider: 'Provider',
            route: '路由',
            latency: '耗时(ms)',
            status: '状态'
          }
        },
        modelTable: {
          title: '模型性能摘要',
          description: '统计每个后端模型的请求数、平均耗时、TTFT 与 TPOT。',
          empty: '暂无模型统计数据。',
          columns: {
            model: 'Provider/模型',
            requests: '请求数',
            latency: '平均耗时',
            ttft: 'TTFT',
            tpot: 'TPOT'
          }
        }
      },
      logs: {
        title: '请求日志',
        description: '查看近期请求，支持筛选 Provider、模型、成功状态及时间范围。',
        summary: {
          total: '记录总数：{{value}}'
        },
        filters: {
          provider: 'Provider',
          modelId: '模型 ID',
          modelPlaceholder: '如 deepseek-chat',
          status: '状态',
          statusAll: '全部',
          statusSuccess: '成功',
          statusError: '失败',
          startDate: '起始日期',
          endDate: '结束日期'
        },
        actions: {
          manualRefresh: '手动刷新',
          refreshing: '刷新中...',
          viewDetail: '查看详情'
        },
        table: {
          loading: '正在加载日志...',
          empty: '未找到符合条件的日志记录。',
          requestedModelFallback: '未指定',
          columns: {
            time: '时间',
            provider: 'Provider',
            requestedModel: '请求模型',
            routedModel: '路由模型',
            inputTokens: '输入 Tokens',
            cachedTokens: '缓存 Tokens',
            outputTokens: '输出 Tokens',
            latency: '耗时(ms)',
            ttft: 'TTFT(ms)',
            tpot: 'TPOT(ms/Token)',
            status: '状态',
            error: '错误信息',
            actions: '操作'
          },
          pagination: {
            perPage: '每页',
            unit: '条',
            previous: '上一页',
            next: '下一页',
            pageLabel: '第 {{page}} / {{total}} 页'
          }
        },
        toast: {
          listError: {
            title: '日志获取失败',
            desc: '错误信息：{{message}}'
          },
          providerError: {
            title: 'Provider 列表获取失败',
            desc: '错误信息：{{message}}'
          }
        },
        detail: {
          title: '日志详情',
          id: 'ID #{{id}}',
          infoSection: '基本信息',
          info: {
            time: '时间',
            sessionId: 'Session ID',
            provider: 'Provider',
            requestedModel: '请求模型',
            noRequestedModel: '未指定',
            model: '路由模型',
            latency: '耗时',
            status: '状态',
            inputTokens: '输入 Tokens',
            cachedTokens: '缓存 Tokens',
            outputTokens: '输出 Tokens',
            ttft: 'TTFT (首 Token 耗时)',
            tpot: 'TPOT (平均 ms/Token)',
            error: '错误信息'
          },
          summary: {
            route: '{{from}} → {{to}}',
            latency: '耗时：{{value}}',
            ttft: 'TTFT：{{value}}',
            tpot: 'TPOT：{{value}}'
          },
          payload: {
            request: '请求体',
            response: '响应体',
            emptyRequest: '暂无请求内容',
            emptyResponse: '暂无响应内容'
          },
          copy: {
            requestSuccess: '请求体已复制到剪贴板。',
            responseSuccess: '响应体已复制到剪贴板。',
            empty: '{{label}}为空，无法复制。',
            failure: '复制失败',
            failureFallback: '无法复制内容，请稍后再试。'
          },
          loadError: '无法加载日志详情。'
        }
      },

      providers: {
        title: '模型提供商',
        description: '管理集成的模型服务，查看默认模型及支持能力。',
        emptyState: '暂无 Provider，请点击“新增提供商”以开始配置。',
        count: '已配置：{{count}} 个 Provider',
        toast: {
          createSuccess: '已添加 Provider：{{name}}',
          updateSuccess: '已更新 Provider：{{name}}',
          testSuccess: 'Provider 连通性检查通过。',
          testSuccessDesc: '状态：{{status}} · 耗时：{{duration}}',
          testFailure: 'Provider 连通性检查失败：{{message}}',
          loadFailure: '获取配置失败：{{message}}',
          deleteSuccess: '已删除 Provider：{{name}}',
          deleteFailure: '删除 Provider 失败：{{message}}'
        },
        actions: {
          add: '新增提供商',
          refresh: '刷新',
          refreshing: '刷新中...',
          edit: '编辑',
          delete: '删除',
          test: '测试连接'
        },
        card: {
          defaultModel: '默认模型：{{model}}',
          noDefault: '未设置默认模型',
          modelsTitle: '支持模型',
          noModels: '尚未配置模型。'
        },
        drawer: {
          createTitle: '新增 Provider',
          editTitle: '编辑 Provider',
          description: '配置基础信息、模型列表与能力标记。',
          modelsDescription: '维护支持的模型列表及能力标记。',
          defaultHint: '当前默认模型：{{model}}',
          fields: {
            id: 'Provider ID',
            idPlaceholder: '如 openai',
            label: '显示名称',
            labelPlaceholder: '如 OpenAI 官方',
            baseUrl: 'Base URL',
            baseUrlPlaceholder: 'https://api.example.com/v1',
            type: 'Provider 类型',
            apiKey: 'API Key（可选）',
            apiKeyPlaceholder: '可留空以从环境变量读取',
            models: '模型配置',
            addModel: '新增模型',
            modelId: '模型 ID',
            modelIdPlaceholder: '如 claude-sonnet-4-20250514',
            modelLabel: '显示名称（可选）',
            modelLabelPlaceholder: '如 GPT-4 旗舰',
            maxTokens: '最大 Tokens（可选）',
            capabilities: '能力标签',
            capabilityThinking: 'Thinking',
            capabilityTools: 'Tools',
            setDefault: '设为默认模型',
            removeModel: '删除模型'
          },
          errors: {
            idRequired: '请填写 Provider ID',
            idDuplicate: '该 Provider ID 已存在',
            labelRequired: '请填写显示名称',
            baseUrlInvalid: 'Base URL 格式无效',
            modelsRequired: '请至少配置一个模型',
            modelInvalid: '模型 ID 不可为空或重复',
            defaultInvalid: '默认模型必须在模型列表中'
          },
          toast: {
            saveFailure: '保存失败：{{message}}'
          }
        },
        confirm: {
          delete: '确认删除 Provider「{{name}}」？'
        }
      },

      modelManagement: {
        title: '模型管理',
        description: '统一维护模型提供商配置与模型路由映射。',
        actions: {
          saveRoutes: '保存路由'
        },
        routing: {
          selectTarget: '请选择目标 Provider:模型'
        },
        toast: {
          routesSaved: '模型路由已更新。',
          routesSaveFailure: '保存模型路由失败：{{message}}'
        }
      },
      settings: {
        title: '系统设置',
        description: '调整网关端口、日志策略及其他运行参数。',
        toast: {
          loadFailure: '配置加载失败：{{message}}',
          saveSuccess: '系统配置已更新。',
          saveFailure: '保存失败：{{message}}',
          copySuccess: '配置文件路径已复制到剪贴板。',
          copyFailure: '复制失败：{{message}}',
          cleanupSuccess: '已删除 {{count}} 条历史日志。',
          cleanupNone: '没有需要删除的日志。',
          cleanupFailure: '清理失败：{{message}}',
          missingConfig: '未能加载配置，请刷新或稍后再试。'
        },
        sections: {
          basics: '基础配置',
          routing: '模型路由',
          configFile: '配置文件',
          cleanup: '日志清理'
        },
        fields: {
          port: '监听端口',
          host: '监听地址（可选）',
          hostPlaceholder: '默认 0.0.0.0',
          retention: '日志保留天数',
          defaults: '默认模型配置',
          storePayloads: '保存请求/响应内容',
          storePayloadsHint: '关闭后仅记录元数据，可减少磁盘占用。'
        },
        validation: {
          port: '请输入 1-65535 之间的端口号',
          retention: '日志保留天数需为 1-365 之间的数字',
          routePair: '请填写完整的来源模型与目标模型配置。',
          routeDuplicate: '模型 {{model}} 已存在映射，请勿重复配置。'
        },
        defaults: {
          completion: '对话：{{model}}',
          reasoning: '推理：{{model}}',
          background: '后台：{{model}}',
          none: '未设置默认模型'
        },
        routing: {
          title: '模型路由映射',
          description: '为 Claude Code 发起的模型请求指定实际 Provider 与模型 ID（如将 claude 系列映射至 Kimi）。如需禁用映射，可留空或移除。',
          add: '新增映射',
          empty: '尚未配置映射，系统将使用默认模型策略。',
          sourceLabel: '来源模型',
          sourcePlaceholder: '如 claude-sonnet-4-20250514',
          targetLabel: '目标 Provider:模型',
          targetPlaceholder: '如 kimi:kimi-k2-0905-preview',
          remove: '移除',
          suggested: '常用 Claude 模型'
        },
        file: {
          description: '当前配置存储在本地文件，可通过编辑该文件进行离线修改。',
          unknown: '未知路径'
        },
        cleanup: {
          description: '立即清理早于当前保留天数的日志记录。'
        }
      },

      about: {
        title: '关于',
        description: '查看 cc-gw 的版本信息、构建元数据与运行状态。',
        app: {
          title: '应用信息',
          labels: {
            name: '名称',
            version: '版本',
            buildTime: '构建时间',
            node: 'Node 版本'
          }
        },
        status: {
          title: '运行状态',
          loading: '正在获取运行状态...',
          empty: '未能获取状态信息。',
          labels: {
            host: '监听地址',
            port: '监听端口',
            providers: '已配置 Provider',
            active: '活动请求'
          }
        },
        support: {
          title: '使用提示',
          subtitle: '运行维护说明',
          description: '通过 Web UI 管理 Provider、模型路由与日志，高级配置可直接编辑 ~/.cc-gw/config.json。',
          actions: {
            checkUpdates: '检查更新'
          }
        },
        toast: {
          statusError: {
            title: '状态加载失败'
          },
          updatesPlanned: '检查更新功能将在后续版本提供。'
        }
      }
    }
  },
  en: {
    translation: {
      app: {
        title: 'cc-gw Console',
        skipToContent: 'Skip to main content'
      },
      nav: {
        dashboard: 'Dashboard',
        logs: 'Logs',
        models: 'Model Management',
        settings: 'Settings',
        about: 'About'
      },
      language: {
        zh: 'Simplified Chinese',
        en: 'English'
      },
      common: {
        loading: 'Loading...',
        loadingShort: 'Loading...',
        noData: 'No data available',
        languageSelector: 'Language selector',
        actions: {
          refresh: 'Refresh',
          refreshing: 'Refreshing...',
          manualRefresh: 'Manual refresh',
          reset: 'Reset',
          close: 'Close',
          openNavigation: 'Open navigation',
          closeNavigation: 'Close navigation',
          save: 'Save changes',
          saving: 'Saving...',
          cancel: 'Cancel',
          copy: 'Copy',
          testConnection: 'Test connection',
          testingConnection: 'Testing...',
          cleanup: 'Clean up logs',
          cleaning: 'Cleaning...',
          checkUpdates: 'Check for updates'
        },
        theme: {
          label: 'Theme',
          light: 'Light',
          dark: 'Dark',
          system: 'System'
        },
        status: {
          success: 'Success',
          error: 'Error'
        },
        notifications: {
          featureInProgress: 'Feature under development. Stay tuned!'
        },
        units: {
          request: 'req',
          ms: 'ms',
          token: 'tokens',
          msPerToken: 'ms/token'
        }
      },
      dashboard: {
        description: 'Monitor request volume and runtime health at a glance.',
        status: {
          listening: 'Listening: {{host}}:{{port}}',
          providers: 'Providers: {{value}}',
          todayRequests: 'Requests today: {{value}}',
          active: 'Active requests: {{value}}',
          dbSize: 'Database: {{value}}'
        },
        toast: {
          overviewError: 'Failed to load overview metrics',
          dailyError: 'Failed to load trend metrics',
          modelError: 'Failed to load model statistics',
          statusError: 'Failed to load gateway status',
          dbError: 'Failed to load database info',
          recentError: 'Failed to load recent requests'
        },
        cards: {
          todayRequests: 'Requests Today',
          todayInput: 'Input Tokens Today',
          todayOutput: 'Output Tokens Today',
          avgLatency: 'Average Latency'
        },
        charts: {
          requestsTitle: 'Request Trends',
          requestsDesc: 'Requests and token usage over the last 14 days',
          modelTitle: 'Model Distribution',
          modelDesc: 'Call counts by model in the past 7 days',
          barRequests: 'Requests',
          lineInput: 'Input Tokens',
          lineOutput: 'Output Tokens',
          ttftLabel: 'TTFT (ms)',
          tpotLabel: 'TPOT (ms/token)',
          axisLatency: 'Latency (ms)'
        },
        recent: {
          title: 'Recent Requests',
          subtitle: 'Showing the latest {{count}} records',
          loading: 'Loading...',
          empty: 'No recent requests',
          routePlaceholder: 'Not specified',
          columns: {
            time: 'Time',
            provider: 'Provider',
            route: 'Route',
            latency: 'Latency (ms)',
            status: 'Status'
          }
        },
        modelTable: {
          title: 'Model Performance Snapshot',
          description: 'Requests, average latency, TTFT, and TPOT by downstream model.',
          empty: 'No model statistics available.',
          columns: {
            model: 'Provider/Model',
            requests: 'Requests',
            latency: 'Avg Latency',
            ttft: 'TTFT',
            tpot: 'TPOT'
          }
        }
      },
      logs: {
        title: 'Request Logs',
        description: 'Inspect recent traffic with provider/model/status filters and date range.',
        summary: {
          total: 'Total records: {{value}}'
        },
        filters: {
          provider: 'Provider',
          modelId: 'Model ID',
          modelPlaceholder: 'e.g. deepseek-chat',
          status: 'Status',
          statusAll: 'All',
          statusSuccess: 'Success',
          statusError: 'Error',
          startDate: 'Start date',
          endDate: 'End date'
        },
        actions: {
          manualRefresh: 'Manual refresh',
          refreshing: 'Refreshing...',
          viewDetail: 'View detail'
        },
        table: {
          loading: 'Loading logs...',
          empty: 'No records match the current filters.',
          requestedModelFallback: 'Not specified',
          columns: {
            time: 'Time',
            provider: 'Provider',
            requestedModel: 'Requested model',
            routedModel: 'Routed model',
            inputTokens: 'Input Tokens',
            cachedTokens: 'Cached Tokens',
            outputTokens: 'Output Tokens',
            latency: 'Latency (ms)',
            ttft: 'TTFT (ms)',
            tpot: 'TPOT (ms/token)',
            status: 'Status',
            error: 'Error',
            actions: 'Actions'
          },
          pagination: {
            perPage: 'per page',
            unit: 'items',
            previous: 'Previous',
            next: 'Next',
            pageLabel: 'Page {{page}} / {{total}}'
          }
        },
        toast: {
          listError: {
            title: 'Failed to fetch logs',
            desc: 'Error: {{message}}'
          },
          providerError: {
            title: 'Failed to fetch providers',
            desc: 'Error: {{message}}'
          }
        },
        detail: {
          title: 'Log Detail',
          id: 'ID #{{id}}',
          infoSection: 'Overview',
          info: {
            time: 'Time',
            sessionId: 'Session ID',
            provider: 'Provider',
            requestedModel: 'Requested model',
            noRequestedModel: 'Not specified',
            model: 'Routed model',
            latency: 'Latency',
            status: 'Status',
            inputTokens: 'Input Tokens',
            cachedTokens: 'Cached Tokens',
            outputTokens: 'Output Tokens',
            ttft: 'TTFT (first token latency)',
            tpot: 'TPOT (avg ms/token)',
            error: 'Error'
          },
          summary: {
            route: '{{from}} → {{to}}',
            latency: 'Latency: {{value}}',
            ttft: 'TTFT: {{value}}',
            tpot: 'TPOT: {{value}}'
          },
          payload: {
            request: 'Request body',
            response: 'Response body',
            emptyRequest: 'No request content',
            emptyResponse: 'No response content'
          },
          copy: {
            requestSuccess: 'Request body copied to clipboard.',
            responseSuccess: 'Response body copied to clipboard.',
            empty: 'Cannot copy empty {{label}}.',
            failure: 'Copy failed',
            failureFallback: 'Unable to copy content. Please try again later.'
          },
          loadError: 'Unable to load log detail.'
        }
      },

      providers: {
        title: 'Model Providers',
        description: 'Manage integrated services, default models, and capabilities.',
        emptyState: 'No providers yet. Click "Add provider" to get started.',
        count: '{{count}} providers configured',
        toast: {
          createSuccess: 'Provider added: {{name}}',
          updateSuccess: 'Provider updated: {{name}}',
          testSuccess: 'Connection test succeeded.',
          testSuccessDesc: 'HTTP {{status}} · {{duration}} elapsed',
          testFailure: 'Connection test failed: {{message}}',
          loadFailure: 'Failed to load config: {{message}}',
          deleteSuccess: 'Provider removed: {{name}}',
          deleteFailure: 'Failed to remove provider: {{message}}'
        },
        actions: {
          add: 'Add provider',
          refresh: 'Refresh',
          refreshing: 'Refreshing...',
          edit: 'Edit',
          delete: 'Delete',
          test: 'Test connection'
        },
        card: {
          defaultModel: 'Default model: {{model}}',
          noDefault: 'No default model',
          modelsTitle: 'Supported models',
          noModels: 'No models configured yet.'
        },
        drawer: {
          createTitle: 'Add Provider',
          editTitle: 'Edit Provider',
          description: 'Configure base settings, model list, and capabilities.',
          modelsDescription: 'Maintain supported models and capability flags.',
          defaultHint: 'Current default model: {{model}}',
          fields: {
            id: 'Provider ID',
            idPlaceholder: 'e.g. openai',
            label: 'Display name',
            labelPlaceholder: 'e.g. OpenAI Official',
            baseUrl: 'Base URL',
            baseUrlPlaceholder: 'https://api.example.com/v1',
            type: 'Provider type',
            apiKey: 'API Key (optional)',
            apiKeyPlaceholder: 'Leave blank to read from environment',
            models: 'Model configuration',
            addModel: 'Add model',
            modelId: 'Model ID',
            modelIdPlaceholder: 'e.g. claude-sonnet-4-20250514',
            modelLabel: 'Display name (optional)',
            modelLabelPlaceholder: 'e.g. GPT-4 Flagship',
            maxTokens: 'Max tokens (optional)',
            capabilities: 'Capabilities',
            capabilityThinking: 'Thinking',
            capabilityTools: 'Tools',
            setDefault: 'Set as default',
            removeModel: 'Remove model'
          },
          errors: {
            idRequired: 'Provider ID is required',
            idDuplicate: 'Provider ID already exists',
            labelRequired: 'Display name is required',
            baseUrlInvalid: 'Invalid Base URL',
            modelsRequired: 'Configure at least one model',
            modelInvalid: 'Model IDs must be unique and non-empty',
            defaultInvalid: 'Default model must exist in the list'
          },
          toast: {
            saveFailure: 'Save failed: {{message}}'
          }
        },
        confirm: {
          delete: 'Remove provider “{{name}}”?'
        }
      },

      modelManagement: {
        title: 'Model Management',
        description: 'Configure providers and maintain model routing rules in one place.',
        actions: {
          saveRoutes: 'Save routes'
        },
        routing: {
          selectTarget: 'Select provider:model'
        },
        toast: {
          routesSaved: 'Model routes updated successfully.',
          routesSaveFailure: 'Failed to save model routes: {{message}}'
        }
      },
      settings: {
        title: 'System Settings',
        description: 'Adjust gateway port, log retention, and runtime parameters.',
        toast: {
          loadFailure: 'Failed to load config: {{message}}',
          saveSuccess: 'Settings saved successfully.',
          saveFailure: 'Save failed: {{message}}',
          copySuccess: 'Config path copied to clipboard.',
          copyFailure: 'Copy failed: {{message}}',
          cleanupSuccess: '{{count}} old logs removed.',
          cleanupNone: 'No logs met the cleanup criteria.',
          cleanupFailure: 'Cleanup failed: {{message}}',
          missingConfig: 'Configuration not available. Refresh and try again.'
        },
        sections: {
          basics: 'Basic configuration',
          routing: 'Model routing',
          configFile: 'Configuration file',
          cleanup: 'Log cleanup'
        },
        fields: {
          port: 'Listen port',
          host: 'Listen host (optional)',
          hostPlaceholder: 'Defaults to 0.0.0.0',
          retention: 'Log retention days',
          defaults: 'Default models',
          storePayloads: 'Store request & response bodies',
          storePayloadsHint: 'Disable to keep only metadata and save disk space.'
        },
        validation: {
          port: 'Enter a port between 1 and 65535',
          retention: 'Retention days must be between 1 and 365',
          routePair: 'Fill both the source and target models.',
          routeDuplicate: 'A route for {{model}} already exists.'
        },
        defaults: {
          completion: 'Conversation: {{model}}',
          reasoning: 'Reasoning: {{model}}',
          background: 'Background: {{model}}',
          none: 'No defaults configured'
        },
        routing: {
          title: 'Model routing map',
          description: 'Override Claude Code model requests with provider:model targets (e.g., map Claude to Kimi). Leave empty to fall back to defaults.',
          add: 'Add route',
          empty: 'No custom routes configured. Default strategy will be used.',
          sourceLabel: 'Source model',
          sourcePlaceholder: 'e.g. claude-sonnet-4-20250514',
          targetLabel: 'Target provider:model',
          targetPlaceholder: 'e.g. kimi:kimi-k2-0905-preview',
          remove: 'Remove',
          suggested: 'Claude presets'
        },
        file: {
          description: 'Configuration is stored locally; edit the file for offline adjustments.',
          unknown: 'Unknown path'
        },
        cleanup: {
          description: 'Immediately purge logs older than the retention window.'
        }
      },

      about: {
        title: 'About',
        description: 'Review cc-gw version details, build metadata, and current runtime status.',
        app: {
          title: 'Application',
          labels: {
            name: 'Name',
            version: 'Version',
            buildTime: 'Build time',
            node: 'Node version'
          }
        },
        status: {
          title: 'Runtime status',
          loading: 'Fetching status...',
          empty: 'Unable to retrieve status information.',
          labels: {
            host: 'Listen host',
            port: 'Listen port',
            providers: 'Providers configured',
            active: 'Active requests'
          }
        },
        support: {
          title: 'Operational notes',
          subtitle: 'Maintenance guidance',
          description: 'Manage providers, routing, and logs in the Web UI; advanced settings live in ~/.cc-gw/config.json.',
          actions: {
            checkUpdates: 'Check for updates'
          }
        },
        toast: {
          statusError: {
            title: 'Failed to load status'
          },
          updatesPlanned: 'Update checks will arrive in a future release.'
        }
      }
    }
  }
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: 'zh',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  })
}

export default i18n
