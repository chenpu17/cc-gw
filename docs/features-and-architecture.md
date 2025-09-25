# cc-gw 功能与软件实现方案总览 / Features & Implementation Blueprint

## 简介 Overview
- **中文**：cc-gw 是一个本地部署的多模型网关，负责将 Claude Code 等客户端的 `/v1/messages` 请求转换、路由并审计，同时提供 Web 管理界面与 CLI 守护工具。
- **English**: cc-gw is a self-hosted multi-provider gateway that normalizes `/v1/messages` traffic, routes it to configured providers, and offers a management UI plus CLI tooling.

## 支持特性 Supported Capabilities
| 功能 Feature | 描述 Description |
|--------------|------------------|
| 协议转换 Protocol adaptation | 标准化 Claude payload，构建 OpenAI、Anthropic、Kimi K2 兼容请求，并保持工具调用/思考模式。 |
| 模型路由 Model routing | 依据 `modelRoutes` 与默认策略在 Provider/模型之间切换，支持长上下文与推理模型。 |
| Provider 适配 Provider adapters | 内置 OpenAI-compatible、Anthropic Messages、Kimi 连接器，统一鉴权、超时与错误映射。 |
| 日志与指标 Logging & metrics | SQLite 记录请求明细、每日 token 统计、缓存命中；Web UI 支持筛选/导出/清理。 |
| Web 控制台 Web console | React + Vite 仪表盘、日志、模型管理、设置页面，支持中英双语与暗黑模式。 |
| CLI 守护 CLI daemon | `cc-gw` 命令封装 start/stop/restart/status，`--daemon` 输出 PID 与日志文件。 |
| Token 估算 Token accounting | 下游缺少 usage 时使用 `tiktoken` 估算输入/输出，并透传缓存命中数。 |
| 可扩展性 Extensibility | Provider registry 可扩展新模型服务；调试日志可打印实际转发 URL。 |

## 系统架构 Architecture Snapshot
1. **CLI (`src/cli`)**：守护进程封装、首次启动配置模板、运行状态查询。
2. **Server (`src/server`)**：Fastify 负责 `/v1/messages`、管理 API、静态资源托管，内部包含协议层、路由器、Provider 注册表、日志模块。
3. **Web UI (`src/web`)**：React + TanStack Router + Tailwind + i18next，提供仪表盘、日志、模型管理、系统设置。
4. **存储 Storage**：`better-sqlite3` 单文件数据库，表结构包括 `request_logs`、`request_payloads`、`daily_metrics`。
5. **配置 Configuration**：`~/.cc-gw/config.json` 描述端口、Provider、模型路由、日志保留策略；支持环境变量覆盖 UI 根目录与调试模式。

> **Flow**: Client ⇒ `/v1/messages` ⇒ normalize ⇒ resolve route ⇒ provider connector ⇒ stream/non-stream response ⇒ log & metrics ⇒ return to client.

## 模块设计 Module Breakdown
### 协议层 Protocol Layer
- 中文：`normalizeClaudePayload` 合并 system/developer、工具调用、思考块；`buildProviderBody` / `buildAnthropicBody` 生成目标 Provider 请求体，保留 `cache_control`、工具参数。
- English: normalization merges Claude messages, preserving tool calls; provider builders craft OpenAI-style or Anthropic messages with cache-control hints intact.

### 路由策略 Routing Strategy
- 中文：`resolveRoute` 结合 `modelRoutes`、默认模型与 `longContextThreshold`，并通过 `estimateTokens` 预估 token，决定下游 Provider/模型。
- English: combines configured overrides and token estimates to pick the best upstream target for the current request.

### Provider 注册表 Provider Registry
- 中文：`providers/registry.ts` 根据 `type` 返回对应适配器，统一封装鉴权、SSE 解码、错误码映射；可新增自定义 Provider。
- English: adapters (OpenAI-compatible, Anthropic, Kimi) share a common interface, making it easy to plug in more providers.

### 日志与指标 Logging & Metrics
- 中文：请求到达时调用 `recordLog`，完成后 `updateLogTokens` 写入 token/TTFT/TPOT 等指标，并由 `updateMetrics` 累加日度统计；流式响应尾包会提取 usage（含缓存命中）。
- English: lifecycle hooks persist logs (tokens plus TTFT/TPOT) into SQLite before rolling up daily aggregates; the Web UI consumes `/api/logs` & `/api/stats` endpoints.

### Web UI
- 中文：包含 Dashboard（统计，含模型级别的 TTFT/TPOT 指标）、Logs（筛选、分页、抽屉详情）、Model Management（Provider CRUD、连通性测试、路由映射）、Settings（端口、日志策略、配置路径）。
- English: responsive layout with mobile navigation, bilingual copy via i18next, and accessibility helpers (skip links, focus trapping); the dashboard now visualizes per-model TTFT/TPOT metrics.

### CLI
- 中文：`start/stop/restart/status` 命令支持守护与前台模式；首次启动生成配置模板，并提示访问 Web UI。
- English: CLI provides lifecycle commands, daemon mode with PID/log files under `~/.cc-gw`, and onboarding prompts when config is missing.

## 请求流程 Request Flow
1. 客户端发送 `/v1/messages` 请求（可携带 `stream=true`）。
2. 服务端归一化 payload，基于配置决策目标 Provider/模型。
3. 构建 Provider 请求体并转发；在控制台打印 provider / endpoint 调试信息。
4. 非流式直接转换为 Claude 兼容响应；流式 SSE 则重新编码为 Claude 事件格式。
5. 收集或估算 usage，更新 SQLite 与每日指标表，输出 `event: usage.metrics` 日志。

## 数据与配置 Data & Config
- 数据库路径：`~/.cc-gw/data/gateway.db`
  - `request_logs`：请求基础信息与 token 统计
  - `request_payloads`：原始请求/响应 JSON（用于排查）
  - `daily_metrics`：每日请求数、输入/输出/缓存 token、累计耗时
- 配置重点：`providers`（含 `type/baseUrl/apiKey/models`）、`modelRoutes`、`defaults`、`logRetentionDays`
- 环境变量：`CC_GW_UI_ROOT`（自定义静态资源）、`CC_GW_DEBUG_ENDPOINTS`（打印下游 URL）

## 运行与运维 Deployment Notes
- 推荐通过 `cc-gw start --daemon` 后台运行，并结合 `launchd` / `systemd` 托管。
- Windows 下可使用 PowerShell 守护模式，但建议关注日志输出路径 `~/.cc-gw/logs/`。
- 更新流程：重新执行 `pnpm --filter @cc-gw/server build` / `pnpm --filter @cc-gw/web build`，随后 `cc-gw restart`。
- 备份需求：定期备份配置与 SQLite 数据库；如需迁移，将 `~/.cc-gw/` 整体复制即可。

## 后续规划 Roadmap Highlights
- 扩充 Provider（DeepSeek、Qwen 等）与更多模型预设。
- 引入权限校验、API Token 管理以及更精细的日志导出。
- 提供 Playwright/自动化回归、CI 构建与 Release 发布流程。
- 优化成本分析视图，支持按 Provider/模型统计费用与缓存命中率。

---
参考实现：`src/server/routes/messages.ts`（协议与流式处理）、`src/server/router/index.ts`（模型路由）、`src/web/src/pages`（前端页面）。如需历史设计/需求文档，请查看 `docs_old/` 归档目录。
