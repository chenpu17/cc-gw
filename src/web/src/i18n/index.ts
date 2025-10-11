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
        apiKeys: 'API 密钥',
        settings: '设置',
        help: '使用指南',
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
        filters: {
          endpoint: '端点筛选',
          endpointAll: '全部端点',
          endpointAnthropic: 'anthropic',
          endpointOpenAI: 'openai'
        },
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
          modelDesc: '近 7 天不同模型的调用次数与 Token 走势',
          barRequests: '请求数',
          lineInput: '输入 Tokens',
          lineOutput: '输出 Tokens',
          axisTokens: 'Tokens',
          ttftLabel: 'TTFT(ms)',
          tpotLabel: 'TPOT(ms/Token)',
          ttftTitle: 'TTFT 模型对比',
          ttftDesc: '比较不同模型的首 Token 耗时 (TTFT)',
          ttftEmpty: '暂无 TTFT 数据。',
          tpotTitle: 'TPOT 模型对比',
          tpotDesc: '比较不同模型的平均 Token 耗时 (TPOT)',
          tpotEmpty: '暂无 TPOT 数据。',
          ttftAxis: 'TTFT (ms)',
          tpotAxis: 'TPOT (ms/Token)',
          empty: '暂无数据'
        },
        recent: {
          title: '最新请求',
          subtitle: '仅展示最近 {{count}} 条记录',
          loading: '加载中...',
          empty: '暂无请求记录',
          routePlaceholder: '未指定',
          columns: {
            time: '时间',
            endpoint: '端点',
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
          providerAll: '全部 Provider',
          endpoint: '请求端点',
          endpointAll: '全部端点',
          endpointAnthropic: 'anthropic',
          endpointOpenAI: 'openai',
          apiKey: 'API Key',
          apiKeyHint: '可多选，不选择时将展示全部密钥。',
          modelId: '模型 ID',
          modelPlaceholder: '如 deepseek-chat',
          status: '状态',
          statusAll: '全部',
          statusSuccess: '成功',
          statusError: '失败',
          startDate: '起始日期',
          endDate: '结束日期',
          apiKeyAll: '全部密钥',
          apiKeySelected: '{{count}} 个已选'
        },
        actions: {
          manualRefresh: '手动刷新',
          refreshing: '刷新中...',
          detail: '详情'
        },
        table: {
          loading: '正在加载日志...',
          empty: '未找到符合条件的日志记录。',
          requestedModelFallback: '未指定',
          apiKeyUnknown: '未知密钥',
          columns: {
            time: '时间',
            endpoint: '端点',
            provider: 'Provider',
            requestedModel: '请求模型',
            routedModel: '路由模型',
            apiKey: 'API Key',
            inputTokens: '输入 Tokens',
            cachedTokens: '缓存 Tokens',
            outputTokens: '输出 Tokens',
            stream: 'Stream',
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
        endpointAnthropic: 'anthropic',
        endpointOpenAI: 'openai',
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
        stream: {
          streaming: '流式',
          single: '单次'
        },
        detail: {
          title: '日志详情',
          id: 'ID #{{id}}',
          infoSection: '基本信息',
          info: {
            time: '时间',
            sessionId: 'Session ID',
            endpoint: '端点',
            provider: 'Provider',
            requestedModel: '请求模型',
            noRequestedModel: '未指定',
            model: '路由模型',
            stream: 'Stream',
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
            tpot: 'TPOT：{{value}}',
            stream: 'Stream：{{value}}'
          },
          payload: {
            request: '请求体',
            response: '响应体',
            emptyRequest: '暂无请求内容',
            emptyResponse: '暂无响应内容'
          },
          apiKey: {
            title: '密钥信息',
            name: '密钥名称',
            identifier: '密钥 ID',
            masked: '掩码展示',
            maskedUnavailable: '暂无掩码信息',
            raw: '原始密钥',
            rawUnavailable: '未记录原始密钥',
            missing: '未记录',
            lastUsed: '最后使用'
          },
          copy: {
            requestSuccess: '请求体已复制到剪贴板。',
            responseSuccess: '响应体已复制到剪贴板。',
            keySuccess: 'API 密钥已复制到剪贴板。',
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
        quickAddHuawei: {
          button: '一键添加华为云模型',
          title: '一键添加华为云模型',
          description: '输入 API Key 即可快速添加华为云 DeepSeek V3.1、KIMI-K2 与 Qwen3-235B-A22B 模型。',
          apiKeyLabel: 'API Key',
          apiKeyPlaceholder: '请输入华为云 API Key',
          note: '完成后可在提供商列表中查看并进一步调整配置。',
          submit: '添加',
          providerLabel: '华为云',
          validation: {
            apiKey: '请填写 API Key'
          },
          toast: {
            success: '已添加华为云模型',
            added: '已添加 {{name}}',
            failure: '添加失败，请稍后重试'
          }
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
          description: '配置基础信息与模型列表。',
          modelsDescription: '维护支持的模型列表。',
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
            authMode: '认证方式',
            authModeHint: 'Claude Code 可使用 Token 或 API Key，选择后填写对应值。',
            authModeApiKey: '使用 API Key（x-api-key）',
            authModeAuthToken: '使用 Auth Token（Authorization: Bearer）',
            models: '模型配置',
            showAdvanced: '显示高级选项',
            hideAdvanced: '隐藏高级选项',
            addModel: '新增模型',
            modelId: '模型 ID',
            modelIdPlaceholder: '如 claude-sonnet-4-5-20250929',
            modelLabel: '显示名称（可选）',
            modelLabelPlaceholder: '如 GPT-4 旗舰',
            setDefault: '设为默认模型',
            removeModel: '删除模型'
          },
          errors: {
            idRequired: '请填写 Provider ID',
            idDuplicate: '该 Provider ID 已存在',
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
        tabs: {
          providers: '模型提供商',
          providersDesc: '配置上游模型提供商以及认证信息。',
          anthropic: 'Anthropic 路由',
          anthropicDesc: '管理 /anthropic 端点的模型映射和默认配置。',
          openai: 'OpenAI 路由',
          openaiDesc: '管理 /openai 端点的模型映射和默认配置。'
        },
        actions: {
          saveRoutes: '保存路由'
        },
        routing: {
          selectTarget: '请选择目标 Provider:模型'
        },
        toast: {
          routesSaved: '模型路由已更新。',
          routesSaveFailure: '保存模型路由失败：{{message}}',
          presetSaved: '已保存模板 “{{name}}”。',
          presetSaveFailure: '保存模板失败：{{message}}',
          presetApplySuccess: '已应用模板 “{{name}}”。',
          presetApplyFailure: '应用模板失败：{{message}}',
          presetDeleteSuccess: '模板 “{{name}}” 已删除。',
          presetDeleteFailure: '删除模板失败：{{message}}'
        },
        presets: {
          title: '路由模板',
          description: '保存当前 Anthropic 路由映射，便于在不同 Provider 方案之间快速切换。',
          namePlaceholder: '输入模板名称，例如 fox',
          save: '保存模板',
          saving: '保存中...',
          empty: '尚未保存任何模板。',
          apply: '应用',
          applying: '应用中...',
          delete: '删除',
          deleting: '删除中...'
        },
        validation: {
          presetName: '请输入模板名称。',
          presetDuplicate: '模板 {{name}} 已存在，请使用其他名称。'
        },
        confirm: {
          deletePreset: '确定要删除模板 “{{name}}” 吗？'
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
          clearAllSuccess: '日志已清空（请求 {{logs}} 条，统计 {{metrics}} 条）。',
          clearAllFailure: '清空失败：{{message}}',
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
          storePayloadsHint: '关闭后仅记录元数据，可减少磁盘占用。',
          logLevel: '日志级别',
          logLevelOption: {
            fatal: '致命 (fatal)',
            error: '错误 (error)',
            warn: '警告 (warn)',
            info: '信息 (info)',
            debug: '调试 (debug)',
            trace: '跟踪 (trace)'
          },
          requestLogging: '输出访问日志',
          requestLoggingHint: '关闭后将不再在终端打印每个请求的访问日志。',
          responseLogging: '输出响应日志',
          responseLoggingHint: '关闭后将不再输出请求完成时的日志。'
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
          titleByEndpoint: '{{endpoint}} 路由配置',
          descriptionByEndpoint: {
            anthropic: '当 Claude Code 通过 /anthropic 端点请求特定模型时，将根据此映射选择目标 Provider 与模型。',
            openai: '当 Codex 通过 /openai 端点请求特定模型时，将根据此映射选择目标 Provider 与模型。'
          },
          add: '新增映射',
          empty: '尚未配置映射，系统将使用默认模型策略。',
          sourceLabel: '来源模型',
          sourcePlaceholder: '如 claude-sonnet-4-5-20250929',
          targetLabel: '目标 Provider:模型',
          targetPlaceholder: '如 kimi:kimi-k2-0905-preview',
          customTargetOption: '自定义目标…',
          remove: '移除',
          suggested: '常用 Anthropic 模型'
        },
        file: {
          description: '当前配置存储在本地文件，可通过编辑该文件进行离线修改。',
          unknown: '未知路径'
        },
        cleanup: {
          description: '立即清理早于当前保留天数的日志记录。',
          clearAll: '彻底清空',
          clearingAll: '清空中...',
          clearAllWarning: '该操作会删除所有日志记录及日统计数据，请谨慎操作。'
        }
      },
      help: {
        title: '使用指南',
        intro: '本页汇总了如何通过 Web UI 完成配置与日常运维，帮助新接入者快速上手 cc-gw。',
        note: '所有变更都会实时写入 ~/.cc-gw/config.json，并立即影响正在运行的网关；建议通过 Web UI 完成常规操作，CLI 仅用于启动/重启。',
        sections: {
          configuration: {
            title: '一、初始配置',
            items: [
              '在“系统设置”中确认监听地址、端口以及日志策略，并视需要开启或关闭请求/响应日志。',
              '前往“模型管理 → 模型提供商”添加上游 Provider，填写 Base URL、API Key、默认模型等信息。',
              '使用“测试连接”按钮验证 Provider 是否可用；如果失败，请检查网络连通性与密钥权限。',
              '在“模型管理 → 路由配置”中为 /anthropic 与 /openai 端点指定目标模型，保存后立即生效。',
              '在 IDE 中配置接入：Claude Code（含 VS Code 插件）统一设置 Base URL=http://127.0.0.1:4100/anthropic，客户端会自动附加 /v1/messages?beta=true；Codex 指向 http://127.0.0.1:4100/openai/v1，并使用 cc-gw 生成的 API Key。'
            ]
          },
          usage: {
            title: '二、日常使用',
            items: [
              'Dashboard 提供实时请求量、Token、缓存命中以及 TTFT/TPOT 指标，便于了解服务运行状况。',
              '“请求日志”支持多维度筛选，并可查看完整的请求/响应 Payload，适合排查联调问题。',
              '“模型管理”可以快速切换默认模型或更新路由映射，适合 IDE / 自动化场景的随时切换。',
              '“系统设置”中可调整日志保留天数、Payload 存储策略以及日志输出级别。'
            ]
          },
          tips: {
            title: '三、实用技巧',
            items: [
              '开启“保存请求/响应内容”后，可在日志详情中复制原始 Payload，定位上游兼容性问题。',
              '分别关闭“访问日志”或“响应日志”可降低终端噪声，同时仍保留数据库与统计数据。',
              '若手动修改配置文件后 UI 未更新，可使用“系统设置”页的刷新按钮或重启 cc-gw。'
            ]
          }
        },
        faq: {
          title: '常见问题',
          items: [
            {
              q: '如何切换不同端点的默认模型？',
              a: '在“模型管理 → 路由配置”中分别选择 /anthropic 与 /openai 的默认模型并保存，即可立即生效。'
            },
            {
              q: '为什么日志里没有缓存命中数据？',
              a: '需要上游模型返回 cached_tokens 或 input_tokens_details.cached_tokens 字段，确认 Provider 已启用相关功能。'
            }
          ]
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
      },
      apiKeys: {
        title: 'API 密钥管理',
        description: '创建和管理用于访问网关的 API 密钥',
        createNew: '创建新密钥',
        createAction: '创建',
        createDescription: '创建一个新的 API 密钥用于身份验证，可选填写密钥描述。',
        descriptionLabel: '密钥描述（可选）',
        keyDescriptionPlaceholder: '例如：仅供内部测试环境使用',
        keyNamePlaceholder: '输入密钥名称',
        keyCreated: 'API 密钥已创建',
        saveKeyWarning: '这是唯一一次看到完整密钥的机会，请妥善保存！',
        wildcard: '通配符',
        wildcardHint: '启用该密钥后，任何自定义密钥与空密钥都可以通过认证；如需限制访问，可随时禁用该密钥。',
        status: {
          enabled: '已启用',
          disabled: '已禁用'
        },
        actions: {
          enable: '启用',
          disable: '禁用',
          delete: '删除'
        },
        created: '创建时间',
        lastUsed: '最后使用',
        requestCount: '请求次数',
        totalTokens: '总令牌数',
        confirmDelete: '确定要删除此 API 密钥吗？此操作无法撤销。',
        errors: {
          nameRequired: '密钥名称不能为空'
        },
        analytics: {
          title: '密钥使用分析',
          description: '展示最近 {{days}} 天的密钥调用情况',
          range: {
            today: '今日',
            week: '近 7 天',
            month: '近 30 天'
          },
          cards: {
            total: '总密钥数',
            enabled: '启用密钥',
            active: '活跃密钥（{{days}} 天）'
          },
          charts: {
            requests: '按密钥的请求次数（Top 10）',
            tokens: '按密钥的 Token 消耗（Top 10）'
          },
          tokens: {
            input: '输入 Token',
            output: '输出 Token'
          },
          requestsSeries: '请求次数',
          empty: '所选时间范围内暂无统计数据。',
          unknownKey: '未知密钥'
        },
        list: {
          title: '密钥列表',
          empty: '尚未创建 API 密钥，点击右上角按钮开始创建。'
        },
        toast: {
          keyCreated: 'API 密钥创建成功',
          keyUpdated: 'API 密钥已更新',
          keyDeleted: 'API 密钥已删除',
          keyCopied: '密钥已复制到剪贴板',
          createFailure: '创建失败：{{message}}',
          updateFailure: '更新失败：{{message}}',
          deleteFailure: '删除失败：{{message}}'
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
        apiKeys: 'API Keys',
        settings: 'Settings',
        help: 'Help',
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
        filters: {
          endpoint: 'Endpoint',
          endpointAll: 'All endpoints',
          endpointAnthropic: 'anthropic',
          endpointOpenAI: 'openai'
        },
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
          modelDesc: 'Requests and tokens by model in the past 7 days',
          barRequests: 'Requests',
          lineInput: 'Input tokens',
          lineOutput: 'Output tokens',
          axisTokens: 'Tokens',
          ttftLabel: 'TTFT (ms)',
          tpotLabel: 'TPOT (ms/token)',
          ttftTitle: 'TTFT Comparison',
          ttftDesc: 'Compare first-token latency (TTFT) across models',
          ttftEmpty: 'No TTFT data available.',
          tpotTitle: 'TPOT Comparison',
          tpotDesc: 'Compare per-token latency (TPOT) across models',
          tpotEmpty: 'No TPOT data available.',
          ttftAxis: 'TTFT (ms)',
          tpotAxis: 'TPOT (ms/token)',
          empty: 'No data'
        },
        recent: {
          title: 'Recent Requests',
          subtitle: 'Showing the latest {{count}} records',
          loading: 'Loading...',
          empty: 'No recent requests',
          routePlaceholder: 'Not specified',
          columns: {
            time: 'Time',
            endpoint: 'Endpoint',
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
          providerAll: 'All providers',
          endpoint: 'Endpoint',
          endpointAll: 'All endpoints',
          endpointAnthropic: 'anthropic',
          endpointOpenAI: 'openai',
          apiKey: 'API Key',
          apiKeyHint: 'Select one or more keys; leave empty to include all.',
          modelId: 'Model ID',
          modelPlaceholder: 'e.g. deepseek-chat',
          status: 'Status',
          statusAll: 'All',
          statusSuccess: 'Success',
          statusError: 'Error',
          startDate: 'Start date',
          endDate: 'End date',
          apiKeyAll: 'All keys',
          apiKeySelected: '{{count}} selected'
        },
        actions: {
          manualRefresh: 'Manual refresh',
          refreshing: 'Refreshing...',
          detail: 'Detail'
        },
        table: {
          loading: 'Loading logs...',
          empty: 'No records match the current filters.',
          requestedModelFallback: 'Not specified',
          apiKeyUnknown: 'Unknown key',
          columns: {
            time: 'Time',
            endpoint: 'Endpoint',
            provider: 'Provider',
            requestedModel: 'Requested model',
            routedModel: 'Routed model',
            apiKey: 'API Key',
            inputTokens: 'Input Tokens',
            cachedTokens: 'Cached Tokens',
            outputTokens: 'Output Tokens',
            stream: 'Stream',
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
        endpointAnthropic: 'anthropic',
        endpointOpenAI: 'openai',
        stream: {
          streaming: 'Streaming',
          single: 'Non-streaming'
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
            endpoint: 'Endpoint',
            provider: 'Provider',
            requestedModel: 'Requested model',
            noRequestedModel: 'Not specified',
            model: 'Routed model',
            stream: 'Stream',
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
            tpot: 'TPOT: {{value}}',
            stream: 'Stream: {{value}}'
          },
          payload: {
            request: 'Request body',
            response: 'Response body',
            emptyRequest: 'No request content',
            emptyResponse: 'No response content'
          },
          apiKey: {
            title: 'API key',
            name: 'Key name',
            identifier: 'Key ID',
            masked: 'Masked form',
            maskedUnavailable: 'No mask available',
            raw: 'Raw key',
            rawUnavailable: 'Raw key not stored',
            missing: 'Not recorded',
            lastUsed: 'Last used'
          },
          copy: {
            requestSuccess: 'Request body copied to clipboard.',
            responseSuccess: 'Response body copied to clipboard.',
            keySuccess: 'API key copied to clipboard.',
            empty: 'Cannot copy empty {{label}}.',
            failure: 'Copy failed',
            failureFallback: 'Unable to copy content. Please try again later.'
          },
          loadError: 'Unable to load log detail.'
        }
      },

      providers: {
        title: 'Model Providers',
        description: 'Manage integrated services and default models.',
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
        quickAddHuawei: {
          button: 'Quick add Huawei models',
          title: 'Quick add Huawei models',
          description: 'Provide the API key to automatically configure Huawei Cloud DeepSeek V3.1, KIMI-K2, and Qwen3-235B-A22B.',
          apiKeyLabel: 'API Key',
          apiKeyPlaceholder: 'Enter your Huawei Cloud API Key',
          note: 'You can further adjust settings from the provider list after creation.',
          submit: 'Add provider',
          providerLabel: 'Huawei Cloud',
          validation: {
            apiKey: 'API Key is required'
          },
          toast: {
            success: 'Huawei provider added',
            added: '{{name}} added successfully',
            failure: 'Failed to add provider. Please try again later.'
          }
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
          description: 'Configure base settings and model list.',
          modelsDescription: 'Maintain supported models.',
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
            authMode: 'Authentication mode',
            authModeHint: 'Claude Code can authenticate with either an API key (x-api-key) or an auth token (Authorization: Bearer).',
            authModeApiKey: 'Use API Key (x-api-key)',
            authModeAuthToken: 'Use Auth Token (Authorization: Bearer)',
            models: 'Model configuration',
            showAdvanced: 'Show advanced options',
            hideAdvanced: 'Hide advanced options',
            addModel: 'Add model',
            modelId: 'Model ID',
            modelIdPlaceholder: 'e.g. claude-sonnet-4-5-20250929',
            modelLabel: 'Display name (optional)',
            modelLabelPlaceholder: 'e.g. GPT-4 Flagship',
            setDefault: 'Set as default',
            removeModel: 'Remove model'
          },
          errors: {
            idRequired: 'Provider ID is required',
            idDuplicate: 'Provider ID already exists',
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
        tabs: {
          providers: 'Providers',
          providersDesc: 'Manage upstream providers and authentication.',
          anthropic: 'Anthropic Routing',
          anthropicDesc: 'Control mappings for the /anthropic endpoint.',
          openai: 'OpenAI Routing',
          openaiDesc: 'Control mappings for the /openai endpoint.'
        },
        actions: {
          saveRoutes: 'Save routes'
        },
        routing: {
          selectTarget: 'Select provider:model'
        },
        toast: {
          routesSaved: 'Model routes updated successfully.',
          routesSaveFailure: 'Failed to save model routes: {{message}}',
          presetSaved: 'Preset “{{name}}” saved.',
          presetSaveFailure: 'Failed to save preset: {{message}}',
          presetApplySuccess: 'Applied preset “{{name}}”.',
          presetApplyFailure: 'Failed to apply preset: {{message}}',
          presetDeleteSuccess: 'Preset “{{name}}” deleted.',
          presetDeleteFailure: 'Failed to delete preset: {{message}}'
        },
        presets: {
          title: 'Routing presets',
          description: 'Capture the current Anthropic routing map and switch providers with one click.',
          namePlaceholder: 'Preset name, e.g. fox',
          save: 'Save preset',
          saving: 'Saving...',
          empty: 'No presets saved yet.',
          apply: 'Apply',
          applying: 'Applying...',
          delete: 'Delete',
          deleting: 'Deleting...'
        },
        validation: {
          presetName: 'Enter a preset name.',
          presetDuplicate: 'Preset {{name}} already exists.'
        },
        confirm: {
          deletePreset: 'Delete preset “{{name}}”?' 
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
          clearAllSuccess: 'All logs cleared ({{logs}} requests, {{metrics}} daily rows).',
          clearAllFailure: 'Full wipe failed: {{message}}',
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
          storePayloadsHint: 'Disable to keep only metadata and save disk space.',
          logLevel: 'Log level',
          logLevelOption: {
            fatal: 'Fatal',
            error: 'Error',
            warn: 'Warn',
            info: 'Info',
            debug: 'Debug',
            trace: 'Trace'
          },
          requestLogging: 'Emit request logs',
          requestLoggingHint: 'Disable to stop printing each HTTP request in the console.',
          responseLogging: 'Emit response logs',
          responseLoggingHint: 'Disable to stop printing completion logs for each HTTP request.'
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
          titleByEndpoint: '{{endpoint}} routing',
          descriptionByEndpoint: {
            anthropic: 'Requests hitting the /anthropic endpoint will use these mappings.',
            openai: 'Requests hitting the /openai endpoint will use these mappings.'
          },
          add: 'Add route',
          empty: 'No custom routes configured. Default strategy will be used.',
          sourceLabel: 'Source model',
          sourcePlaceholder: 'e.g. claude-sonnet-4-5-20250929',
          targetLabel: 'Target provider:model',
          targetPlaceholder: 'e.g. kimi:kimi-k2-0905-preview',
          customTargetOption: 'Custom target…',
          remove: 'Remove',
          suggested: 'Anthropic presets'
        },
        file: {
          description: 'Configuration is stored locally; edit the file for offline adjustments.',
          unknown: 'Unknown path'
        },
        cleanup: {
          description: 'Immediately purge logs older than the retention window.',
          clearAll: 'Clear everything',
          clearingAll: 'Clearing…',
          clearAllWarning: 'Deletes every log entry and daily metric. This cannot be undone.'
        }
      },
      help: {
        title: 'Help & Guidance',
        intro: 'This page summarises how to configure cc-gw via the Web UI and how to operate it day to day.',
        note: 'Changes are written to ~/.cc-gw/config.json immediately. Prefer editing through the Web UI; use the CLI mainly to start or restart the daemon.',
        sections: {
          configuration: {
            title: '1. Initial setup',
            items: [
              'Review “Settings” to confirm the listening host/port and decide whether to emit request or response access logs.',
              'Open “Model Management → Providers” to add upstream providers, including base URL, API key, and default model.',
              'Click “Test connection” to ensure the provider is reachable. If it fails, double-check network access and API key permissions.',
              'Configure “Model Management → Routing” for both /anthropic and /openai endpoints, then save to apply immediately.',
              'Point your IDEs to the gateway: set `http://127.0.0.1:4100/anthropic` for both the Claude CLI and VS Code extension (they append `/v1/messages?beta=true` automatically), and target `http://127.0.0.1:4100/openai/v1` for Codex; authenticate with a cc-gw API key.'
            ]
          },
          usage: {
            title: '2. Daily usage',
            items: [
              'Use the dashboard to keep an eye on request volume, token usage, cache hits, and TTFT/TPOT trends.',
              '“Request Logs” provides rich filters plus full payload replay for debugging client/provider compatibility issues.',
              '“Model Management” lets you switch defaults or update mappings without redeploying IDE extensions or automation scripts.',
              '“Settings” controls log retention, payload storage, and log verbosity to suit your operations.'
            ]
          },
          tips: {
            title: '3. Practical tips',
            items: [
              'Enable “Store request/response bodies” to copy raw payloads from the log drawer when troubleshooting.',
              'Turn off request or response logs individually to keep the console quiet while preserving metrics and database records.',
              'If you edit ~/.cc-gw/config.json manually, refresh the Settings page or restart cc-gw so the UI reflects the latest configuration.'
            ]
          }
        },
        faq: {
          title: 'Frequently asked questions',
          items: [
            {
              q: 'How can I change the default model for each endpoint?',
              a: 'Go to “Model Management → Routing” and choose defaults for /anthropic and /openai. Saving applies the change right away.'
            },
            {
              q: 'Why are cached token numbers missing?',
              a: 'Upstream providers must return cached_tokens or input_tokens_details.cached_tokens. Enable cache metrics on the provider if supported.'
            }
          ]
        }
      },

      apiKeys: {
        title: 'API Keys Management',
        description: 'Create and manage API keys for gateway access',
        createNew: 'Create New Key',
        createAction: 'Create',
        createDescription: 'Create a new API key for authentication and optionally add a description.',
        descriptionLabel: 'Key description (optional)',
        keyDescriptionPlaceholder: 'e.g. Internal staging access only',
        keyNamePlaceholder: 'Enter key name',
        keyCreated: 'API Key Created',
        saveKeyWarning: 'This is the only time you\'ll see the full key. Save it securely!',
        wildcard: 'Any Key',
        wildcardHint: 'When enabled, any custom key — including an empty key — is accepted. Disable this key to enforce strict authentication.',
        status: {
          enabled: 'Enabled',
          disabled: 'Disabled'
        },
        actions: {
          enable: 'Enable',
          disable: 'Disable',
          delete: 'Delete'
        },
        created: 'Created',
        lastUsed: 'Last Used',
        requestCount: 'Requests',
        totalTokens: 'Total Tokens',
        confirmDelete: 'Are you sure you want to delete this API key? This action cannot be undone.',
        errors: {
          nameRequired: 'Key name is required'
        },
        analytics: {
          title: 'Key Usage Analytics',
          description: 'Highlights for the past {{days}} days of API key activity',
          range: {
            today: 'Today',
            week: 'Last 7 days',
            month: 'Last 30 days'
          },
          cards: {
            total: 'Total keys',
            enabled: 'Enabled keys',
            active: 'Active keys ({{days}} days)'
          },
          charts: {
            requests: 'Top 10 keys by request count',
            tokens: 'Top 10 keys by token usage'
          },
          tokens: {
            input: 'Input tokens',
            output: 'Output tokens'
          },
          requestsSeries: 'Requests',
          empty: 'No activity for the selected range.',
          unknownKey: 'Unknown key'
        },
        list: {
          title: 'Key Inventory',
          empty: 'No API keys found. Use the button above to create one.'
        },
        toast: {
          keyCreated: 'API key created successfully',
          keyUpdated: 'API key updated successfully',
          keyDeleted: 'API key deleted successfully',
          keyCopied: 'Key copied to clipboard',
          createFailure: 'Failed to create: {{message}}',
          updateFailure: 'Failed to update: {{message}}',
          deleteFailure: 'Failed to delete: {{message}}'
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
