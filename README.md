# cc-gw

> **中文** | [English](#english)

cc-gw 是一个面向 Claude Code 与同类客户端的本地多模型网关，负责：

- 归一化 `/v1/messages` 请求并映射到不同 Provider / 模型
- 复刻 Claude API 的流式与工具调用语义
- 记录请求日志、Token（含缓存命中）、TTFT/TPOT 等运行指标
- 提供可视化 Web 管理台与守护进程 CLI

核心组件：

| 模块 | 说明 |
| ---- | ---- |
| `@cc-gw/server` | Fastify 服务，实现协议转换、模型路由、Provider 适配与日志存储（支持 Anthropic 原生 payload/headers 透传与缓存统计） |
| `@cc-gw/web` | React + Vite Web UI，包含仪表盘、日志面板、模型管理、系统设置 |
| `@cc-gw/cli` | CLI 守护工具，封装 start/stop/restart/status 并托管 PID/日志 |

## 🚀 快速开始

### 完整配置指南（新手必读）

以下是完整的配置流程，请按照步骤顺序操作：

#### 步骤 1: 安装并启动服务

```bash
# 方式一：npm 全局安装（推荐）
npm install -g @chenpu17/cc-gw
cc-gw start --daemon --port 4100

# 方式二：从源码构建（开发者）
git clone <repository>
cd cc-gw
pnpm install
pnpm --filter @cc-gw/server build
pnpm --filter @cc-gw/web build
pnpm --filter @cc-gw/cli exec tsx index.ts start --daemon --port 4100
```

启动后访问 Web 管理界面：`http://127.0.0.1:4100/ui`

#### 步骤 2: 配置模型提供商

1. 在 Web UI 中进入 **模型管理** 页面
2. 点击 **添加提供商**，配置至少一个 Provider：
   - **Anthropic Claude**：
     ```
     Base URL: https://api.anthropic.com
     API Key: sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     默认模型: claude-3-5-sonnet-20241022
     ```
   - **Moonshot Kimi**：
     ```
     Base URL: https://api.moonshot.cn/v1
     API Key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     默认模型: kimi-k2-0905-preview
     ```
   - **DeepSeek**：
     ```
     Base URL: https://api.deepseek.com/v1
     API Key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     默认模型: deepseek-chat
     ```
3. 配置完成后使用 **测试连接** 验证连通性

#### 步骤 3: 生成网关 API Key

1. 在 Web UI 中进入 **系统设置 → API Key 管理**
2. 点击 **生成新密钥**，为不同客户端创建独立的密钥：
   - Claude Code IDE: `sk-gw-ide-xxxxxxxx`
   - Codex CLI: `sk-gw-codex-xxxxxxxx`
   - 其他工具: `sk-gw-other-xxxxxxxx`

#### 步骤 4: 配置环境变量（关键步骤）

将以下命令添加到 `~/.bashrc`、`~/.zshrc` 等 shell 启动脚本，或使用 `direnv` 等工具统一管理：

```bash
# Claude Code / VS Code
export ANTHROPIC_BASE_URL=http://127.0.0.1:4100/anthropic
export ANTHROPIC_API_KEY=sk-gw-ide-xxxxxxxxxxxxxxxx

# Codex CLI
export OPENAI_BASE_URL=http://127.0.0.1:4100/openai/v1
export OPENAI_API_KEY=sk-gw-codex-xxxxxxxxxxxxxxxx
export CC_GW_KEY=sk-gw-codex-xxxxxxxxxxxxxxxx
```

更新完毕后执行 `source ~/.bashrc`（或 `source ~/.zshrc`）让环境变量立即生效。完成后可以马上做一次快速连通性测试：

```bash
claude "你好，请简短回应"
codex ask "你好，请介绍一下自己"
```

若命令能够正常返回，同时可在 Web UI 的 **请求日志** 页面看到对应记录，即表明环境变量已经正确生效。

#### 步骤 5: 配置客户端

- **Claude Code / VS Code**：在设置中选择自定义 API，填入 `http://127.0.0.1:4100/anthropic` 与 `sk-gw-ide-xxxxxxxxxxxxxxxx`。
- **Codex CLI**：编辑 `~/.codex/config.toml`，内容示例：

  ```toml
  model = "gpt-5-codex"
  model_provider = "cc_gw"
  model_reasoning_effort = "high"
  disable_response_storage = true

  [model_providers.cc_gw]
  name = "cc_gw"
  base_url = "http://127.0.0.1:4100/openai/v1"
  wire_api = "responses"
  env_key = "cc_gw_key"
  ```

配置完成后，建议运行 `codex status` 或 `codex chat "测试"` 再确认一次终端输出。

#### 步骤 6: 高级配置（可选）

##### 6.1 模型路由配置

在 **模型管理 → 路由配置** 中，可以设置模型映射：
```json
{
  "claude-3-5-sonnet-20241022": "kimi:kimi-k2-0905-preview",
  "claude-opus-4-1-20250805": "anthropic:claude-3-5-sonnet-20241022"
}
```

##### 6.2 环境变量持久化

推荐使用 `direnv` 管理环境变量，在项目目录创建 `.envrc`：
```bash
# .envrc
export ANTHROPIC_BASE_URL=http://127.0.0.1:4100/anthropic
export ANTHROPIC_API_KEY=sk-gw-ide-xxxxxxxxxxxxxxxx
export OPENAI_BASE_URL=http://127.0.0.1:4100/openai/v1
export OPENAI_API_KEY=sk-gw-codex-xxxxxxxxxxxxxxxx
export CC_GW_KEY=sk-gw-codex-xxxxxxxxxxxxxxxx
```

然后运行 `direnv allow` 自动加载。

#### 常见问题排查

1. **连接失败**：
   - 检查 cc-gw 服务状态：`cc-gw status`
   - 验证环境变量：`echo $ANTHROPIC_BASE_URL`
   - 查看请求日志确认错误信息

2. **认证错误**：
   - 确认 API Key 正确且未过期
   - 检查环境变量是否正确加载
   - 验证 Provider 的 API Key 配置

3. **模型不可用**：
   - 在"模型管理"中测试 Provider 连接
   - 检查模型路由配置
   - 确认上游服务模型名称正确

> ✅ 完成以上 6 个步骤后，你的 cc-gw 网关就完全配置好了！所有 AI 客户端都可以通过统一的网关访问不同的模型服务。

### 推荐方式：npm 全局安装

```bash
npm install -g @chenpu17/cc-gw
cc-gw start --daemon --port 4100
```

首启会在 `~/.cc-gw/config.json` 生成配置模板，推荐直接通过 Web UI (`http://127.0.0.1:4100/ui`) 完成所有后续配置与调整。`cc-gw status`、`cc-gw stop`、`cc-gw restart` 可用于日常运维。

> ⚠️ **Linux 安装提示**：本项目依赖 `better-sqlite3`；该库已为 Node 20/22/24 在 glibc/musl（x64/arm64/arm）提供预编译二进制，通常无需额外工具。如果你的环境未命中预编译（例如更早版本的 Node 或稀有架构），请先安装 `build-essential python3 make g++`，再运行 `npm install -g @chenpu17/cc-gw --unsafe-perm --build-from-source`。

### 从源码构建（开发者）

前置：Node.js 18.18+（推荐 20 LTS）、pnpm 8+

```bash
pnpm install
pnpm --filter @cc-gw/server build
pnpm --filter @cc-gw/web build
pnpm --filter @cc-gw/cli exec tsx index.ts start --daemon --port 4100
```

> ✅ 首次启动后推荐直接使用 Web 管理台完成 Provider、模型、日志等设置；仅在自动化或高级场景下再手动编辑配置文件。

如需以 CLI 启动后配合本地脚本使用，可在 shell 中补充以下变量：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:4100/anthropic
export ANTHROPIC_API_KEY=$(cc-gw keys current)
```

将其写入 `direnv`/shell profile，即可让后续工具自动读取。

## Web 管理台

强烈建议以 Web 管理台作为主要的配置入口，可视化界面涵盖仪表盘、请求日志、模型管理与系统设置，所见即所得，避免手工改动 JSON 引入错误。

访问 `http://<host>:<port>/ui`，主要页面：

- **Dashboard**：展示请求量、Token 使用、缓存命中、各模型 TTFT（Time To First Token）/TPOT（Total Processing Time）、SQLite 数据库占用。
- **请求日志**：多条件筛选（时间、Provider、模型、状态），查看压缩日志详情，支持分页导出与清理。
- **模型管理**：维护 Provider 列表、预置模型、路由策略；一键测试连通性（发送诊断 PROMPT），支持保存并应用 Anthropic 路由模板，实现不同 Provider 方案的“一键切换”。
- **系统设置**：端口、日志保留策略、是否存储请求 payload、日志级别与访问日志开关、日志清理工具。
- **安全控制**：在“系统设置 → 安全”中可启用 Web UI 登录校验，自定义用户名及密码并自动保护所有 `/api/*` 管理接口（模型请求端点仍保持开放）。
- **使用指南**：提供图文步骤、常见问题与排查提示，帮助团队成员快速熟悉配置流程。

UI 支持中英文、深色/浅色主题以及移动端响应式布局，提供键盘可达性（Skip Link、焦点管理）。

#### 界面预览

![Dashboard Overview](docs/images/dashboard.png)

![Request Logs](docs/images/logs.png)

### 连接 Claude Code
1. 启动 cc-gw 并在“模型管理”完成 Provider 配置。
2. 确认第 4 步环境变量已写入当前 shell 或系统（`ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY`）。
3. 在 Claude Code 终端或 VS Code 插件中选择“自定义 API”，填入 `http://127.0.0.1:4100/anthropic` 并粘贴密钥。
4. 运行 `claude "hello"` 或在 VS Code 新建对话，若能在 Web UI 的“请求日志”看到记录即成功。

### 连接 Codex（原 Claude Code for Repo）
1. 在 Web UI “路由配置”页设定 `/openai` 端点默认模型。
2. 设置环境变量 `OPENAI_BASE_URL=http://127.0.0.1:4100/openai/v1` 与 `OPENAI_API_KEY=<第 3 步生成的密钥>`。
3. 在 `~/.codex/config.toml` 按前文示例声明 `model_providers.cc_gw`，或在 CLI `codex config set` 中写入相同配置。
4. 执行 `codex status` / `codex ask` 验证连通性；如遇 404，请确认是否调用了 `/openai/v1/responses`。

### 环境变量与客户端配置示例

（段落保留，已在上方详细说明，可用于快速复制粘贴。）

### 使用场景 / Usage Scenarios

1. **双端点适配 / Dual Endpoint Support**：通过 `/anthropic` 与 `/openai` 端点，分别兼容 Claude Code 与 Codex 客户端。无需重启 cc-gw，即可在 Web UI 中为两个端点配置独立的默认模型与路由策略。
2. **日志追踪 / Request Auditing**：在“请求日志”页按端点、Provider、API Key 等维度筛选记录，可直接查看和复制完整的请求/响应 payload，辅助排查联调问题。
3. **模型切换 / Cross-Provider Routing**：利用“模型管理”页的路由映射，将 Claude Code 请求透明地转发到 GLM、Kimi K2、DeepSeek 等任意 OpenAI 兼容模型，实现一套 IDE 客户端、多家大模型的快速切换；对 Anthropic 端点可保存当前映射为模板（例如“fox”“glm”），后续一键切换整套路由。
4. **操作指引 / Built-in Guidance**：左侧“Help”导航提供分步配置、日常运维建议及 FAQ，可作为新人上手或问题排查的快速参考。

## 配置说明

大多数场景请通过 Web 管理台调整设置，以下仅作为 `~/.cc-gw/config.json` 结构参考，便于脚本化或排查：

```json
{
  "host": "127.0.0.1",
  "port": 4100,
  "providers": [
    {
      "id": "kimi",
      "label": "Moonshot Kimi",
      "type": "kimi",
      "baseUrl": "https://api.moonshot.cn/v1",
      "apiKey": "sk-...",
      "models": [
        { "id": "kimi-k2-0905-preview", "label": "Kimi K2" }
      ]
    },
    {
      "id": "anthropic",
      "label": "Claude",
      "type": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKey": "sk-ant-...",
      "models": [
        { "id": "claude-3-5-sonnet-latest" }
      ]
    }
  ],
  "defaults": {
    "completion": "kimi:kimi-k2-0905-preview",
    "reasoning": "anthropic:claude-3-5-sonnet-latest",
    "background": "kimi:kimi-k2-0905-preview",
    "longContextThreshold": 60000
  },
  "modelRoutes": {
    "claude-sonnet-4-5-20250929": "kimi:kimi-k2-0905-preview",
    "claude-opus-4-1-20250805": "anthropic:claude-3-5-sonnet-latest"
  },
  "logRetentionDays": 30,
  "storeRequestPayloads": true,
  "storeResponsePayloads": true,
  "logLevel": "info",
  "requestLogging": true,
  "responseLogging": true
}
```

字段要点（建议仍以 Web UI “系统设置 / 模型管理” 进行操作，下列仅便于理解结构）：

- `providers`：定义上游服务；`type` 支持 `openai | anthropic | kimi | deepseek | custom`。
- 模型标识使用 `providerId:modelId` 形式供路由引用。
- `modelRoutes`：将 Claude 发起的模型名映射到上游模型；未命中时使用 `defaults`。
- `routingPresets`：可选字段，保存多个 `anthropic`（或其他端点）路由模板，供 Web UI “一键切换”；每个模板仅包含 `name` 与 `modelRoutes`。
- `storeRequestPayloads` / `storeResponsePayloads`：是否分别在 SQLite 中压缩保存请求原文与响应内容；关闭可减少敏感数据落盘。
- `bodyLimit`：单次请求允许的最大请求体大小（字节），默认 10 MiB。`/compact` 等场景会发送较大上下文，如遇 413 可按需增大。
- `logLevel`：控制 Fastify/Pino 控制台日志级别（`fatal`/`error`/`warn`/`info`/`debug`/`trace`）。
- `providers[].authMode`：仅在 `type: "anthropic"` 时生效，可选 `apiKey`（默认，发送 `x-api-key`）或 `authToken`（发送 `Authorization: Bearer`）。配置 Claude Code 使用 `ANTHROPIC_AUTH_TOKEN` 时，请选择 `authToken` 并在 `apiKey` 输入框填入该值。
- `requestLogging`：是否输出每个 HTTP 请求的进入日志。
- `responseLogging`：是否输出每个 HTTP 请求完成的日志，可独立于 `requestLogging` 控制。
- 推荐通过 Web UI 的“模型管理 / 系统设置”在线编辑并热加载，无需手工修改文件。

#### Anthropic Provider 额外说明

- 当 Provider `type` 设置为 `anthropic` 时，网关会保留 Claude Code 发来的完整 payload，并将其原样转发到 `<baseUrl>/v1/messages`，无需转换工具调用或 metadata 字段。
- 所有自定义 Header（如 `x-stainless-*`、`anthropic-beta`、`anthropic-dangerous-direct-browser-access`）会自动透传到下游，确保 Claude Code 的诊断与调试能力不受影响。
- usage 统计会解析 `cache_read_input_tokens` / `cache_creation_input_tokens`，从而在日志与 Web UI 的 Token 指标中显示缓存命中或写入量；Moonshot / Anthropic 若未返回上述字段，则 `cached` 会继续显示为空。

### 环境变量

| 变量 | 说明 |
| ---- | ---- |
| `PORT` | CLI 启动时临时覆盖监听端口 |
| `CC_GW_UI_ROOT` | 指定 Web UI 静态目录（默认自动检测 `@cc-gw/web` build 结果） |
| `CC_GW_DEBUG_ENDPOINTS` | 设为 `1` 可在日志中输出下游请求 URL |

## CLI 守护

```bash
pnpm --filter @cc-gw/cli exec tsx index.ts start [--daemon] [--port 4100]
pnpm --filter @cc-gw/cli exec tsx index.ts stop
pnpm --filter @cc-gw/cli exec tsx index.ts restart [--daemon] [--port 4100]
pnpm --filter @cc-gw/cli exec tsx index.ts status
```

- 守护模式下 PID/日志存放于 `~/.cc-gw/cc-gw.pid` 与 `~/.cc-gw/logs/cc-gw.log`。
- `status` 会回显配置与日志路径，便于排查。
- `cc-gw version`（或 `cc-gw --version`）可输出与 npm 包同步的版本号，便于核对升级情况。

## 数据与日志

- 数据库：`~/.cc-gw/data/gateway.db`（`better-sqlite3` 管理的嵌入式 SQLite）。
  - `request_logs`：请求摘要、路由结果、耗时、TTFT/TPOT。
  - `request_payloads`：压缩的请求/响应正文（Brotli）。
  - `daily_metrics`：按日聚合的调用次数与 Token 统计。
- 日志：`~/.cc-gw/logs/cc-gw.log`，包含请求生命周期、Provider 调用与 usage 摘要（`event: usage.metrics`）。

## 常见问题

- **Web UI 404**：请确认执行过 `pnpm --filter @cc-gw/web build`，并在 CLI 启动时自动或手动设置 `CC_GW_UI_ROOT`。
- **usage 中无 `cached_tokens`**：部分 Provider（如火山 DeepSeek）需开启 `stream_options.include_usage` 或提供专有缓存参数；cc-gw 已在支持的适配器中自动注入，如仍为 `null` 需确认上游是否支持。
- **日志数据库过大**：可在“系统设置”关闭 payload 保存或缩短保留天数；Web UI 亦提供手动清理工具。

---

## English

cc-gw is a local gateway tailored for Claude Code and similar Anthropic-compatible clients. It normalizes `/v1/messages`, routes traffic across heterogeneous providers, mirrors Claude’s streaming & tool semantics, and records detailed metrics that surface in a bilingual Web console and CLI daemon.

### Highlights

| Feature | Details |
| ------- | ------- |
| Protocol adaptation | Converts Claude-style payloads into OpenAI-, Anthropic-, Kimi-, and DeepSeek-compatible requests while preserving tool calls and reasoning blocks. |
| Model routing | Maps incoming model IDs to configured upstream providers with fallbacks for long-context/background tasks, plus Anthropic routing presets for one-click provider swaps. |
| Observability | Persists request logs, token usage (including cache hits), TTFT, TPOT, and daily aggregates via better-sqlite3 with Brotli-compressed payloads; request/response bodies can be stored independently. |
| Web console | React + Vite UI with dashboards, filters, provider CRUD, bilingual copy, and responsive layout. |
| CLI daemon | `cc-gw` command wraps start/stop/restart/status, manages PID/log files, and scaffolds a default config on first launch. |

### Standard Onboarding Checklist

1. **Install & launch**: `npm install -g @chenpu17/cc-gw && cc-gw start --daemon --port 4100`. The first run scaffolds `~/.cc-gw/config.json` and makes the Web UI available at `http://127.0.0.1:4100/ui`.
2. **Add providers**: In *Model Management*, create at least one provider by entering its base URL/API key and selecting default models. Templates for Anthropic, Kimi, DeepSeek, etc., are provided in the sidebar.
3. **Issue gateway API keys**: Navigate to *System Settings → API Keys* and mint a key for each client (IDE, Codex CLI, automation). This is what clients will send to cc-gw.
4. **Export environment variables (required)**:
   ```bash
   export ANTHROPIC_BASE_URL=http://127.0.0.1:4100/anthropic
   export ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

   # Optional: OpenAI-compatible endpoint (Codex, Open Interpreter, ...)
   export OPENAI_BASE_URL=http://127.0.0.1:4100/openai/v1
   export OPENAI_API_KEY=$ANTHROPIC_API_KEY
   ```
   Drop these lines into your shell profile (or `direnv`) so that IDEs inherit them automatically.
5. **Point your clients**:
   - **Claude Code / VS Code extension**: enable custom API mode, paste `http://127.0.0.1:4100/anthropic`, and use the key from step 3. The extension appends `/v1/messages?beta=true` automatically.
   - **Codex CLI**: update `~/.codex/config.toml`:
     ```toml
     model = "gpt-5-codex"
     model_provider = "cc_gw"
     model_reasoning_effort = "high"
     disable_response_storage = true

     [model_providers.cc_gw]
     name = "cc_gw"
     base_url = "http://127.0.0.1:4100/openai/v1"
     wire_api = "responses"
     env_key = "cc_gw_key"
     ```
     Then export `CC_GW_KEY=<gateway api key>`.
6. **Smoke test**: run a short prompt (`claude "hello"`, `codex ask`, etc.) and confirm a matching entry appears in *Request Logs*. If not, re-check the environment variables and provider routing.

> Once these six steps are complete, any Anthropic/OpenAI-style client can pivot to cc-gw. All further tweaks (providers, routing, logging) can be handled from the Web UI.

### Quick reinstall / binary upgrade

```bash
npm install -g @chenpu17/cc-gw
cc-gw start --daemon --port 4100
```

`cc-gw status`, `cc-gw stop`, and `cc-gw restart` manage the daemon. The Web UI remains at `http://127.0.0.1:4100/ui`.

> ⚠️ **Linux build note**: cc-gw relies on `better-sqlite3`. Prebuilt binaries cover Node 20/22/24 on glibc & musl (x64/arm64/arm). For other combos install `build-essential python3 make g++`, then rerun `npm install -g @chenpu17/cc-gw --unsafe-perm --build-from-source`.

### From Source (contributors)

```bash
pnpm install
pnpm --filter @cc-gw/server build
pnpm --filter @cc-gw/web build
pnpm --filter @cc-gw/cli exec tsx index.ts start --daemon --port 4100
```

Connect Claude Code after completing the onboarding steps above—the CLI and editor automatically append `/v1/messages`, and cc-gw will forward `?beta=true` samples or tool metadata upstream. For Codex or other OpenAI-style integrations, use `http://127.0.0.1:4100/openai/v1` (or the equivalent value from step 4) and hit `POST /openai/v1/responses` if the client requires an explicit path.

### Configuration Snapshot

- Providers include `type`, `baseUrl`, `apiKey`, and `models` descriptions.
- When `type` is `anthropic`, cc-gw forwards the original Claude payload and all headers to `<baseUrl>/v1/messages`, so tool calls/metadata remain intact.
- Model routes use `providerId:modelId` syntax to remap Claude requests.
- `storeRequestPayloads` / `storeResponsePayloads` control whether prompts and completions are persisted; disable either switch to avoid storing sensitive data.
- `bodyLimit`: maximum request body size (in bytes). Defaults to 10 MiB—raise this if clients like Claude Code `/compact` hit HTTP 413.
- `logLevel` adjusts Fastify/Pino verbosity (`fatal` → `trace`).
- `requestLogging` controls whether per-request access logs are emitted to the console.
- `responseLogging` toggles completion logs separately so you can keep the console quieter while preserving metrics.
- Web UI allows editing without restarting; CLI restart will pick up bundle changes after rebuilds.

### Observability & Storage

- SQLite file under `~/.cc-gw/data/gateway.db` tracks logs and aggregated metrics.
- Dashboard surfaces per-model TTFT/TPOT, cache hits（including Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens`）, and DB size.
- Logs can be filtered/exported/cleaned directly from the UI.

### CLI Reference

| Command | Description |
| ------- | ----------- |
| `cc-gw start [--daemon] [--port]` | Launch the Fastify server, auto-creating config if missing. |
| `cc-gw stop` | Send SIGTERM and remove stale PID files. |
| `cc-gw restart` | Convenience wrapper for stop + start. |
| `cc-gw status` | Show running status, PID, log directory, config path. |

### Environment

| Variable | Purpose |
| -------- | ------- |
| `PORT` | Override listening port at launch. |
| `CC_GW_UI_ROOT` | Manually point to the built web assets. |
| `CC_GW_DEBUG_ENDPOINTS=1` | Log upstream provider endpoints for debugging. |

### Tips

- Always rebuild `@cc-gw/server` and `@cc-gw/web` before restarts to ensure the daemon picks up new code.
- If cache statistics remain zero, verify whether the upstream provider exposes `cached_tokens` or equivalent details.
- Back up `~/.cc-gw/` (config, logs, SQLite DB) for migrations or disaster recovery.
- Use the **Help** page in the Web UI to review setup steps, troubleshooting tips, and FAQs whenever a teammate needs a refresher.

---

欢迎通过 Issue / PR 反馈改进意见，也可以在 Web UI 的“关于”页查看贡献者信息与致谢。
