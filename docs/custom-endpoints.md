# 自定义接入点

## 功能概述

自定义接入点功能允许您创建额外的 API 端点，这些端点可以：
- 使用不同的协议（Anthropic、OpenAI）
- 配置独立的路由规则
- 启用或禁用特定端点
- 支持多路径配置（一个端点可注册多个路径）
- **自动路径扩展**：只需配置基础路径（如 `/my-endpoint`），系统会根据协议自动注册完整的 API 路径

## 协议自动路径扩展

**重要特性**：自定义端点会根据协议类型自动添加子路径，无需手动配置完整路径。

### 路径扩展规则

| 配置的基础路径 | 协议类型 | 实际注册的完整路径 |
|---------------|---------|-------------------|
| `/my-endpoint` | `anthropic` | • `/my-endpoint/v1/messages`<br>• `/my-endpoint/v1/v1/messages`（兼容性） |
| `/my-endpoint` | `openai-auto` | • `/my-endpoint/v1/chat/completions`<br>• `/my-endpoint/v1/responses` |
| `/my-endpoint` | `openai-chat` | • `/my-endpoint/v1/chat/completions` |
| `/my-endpoint` | `openai-responses` | • `/my-endpoint/v1/responses` |

**示例**：
- 配置 `path: "/claude2"`，`protocol: "anthropic"`
- 客户端可以访问 `POST http://localhost:4100/claude2/v1/messages`
- 与系统端点 `/anthropic/v1/messages` 行为完全一致

## 支持的协议类型

### 1. Anthropic 协议 (`anthropic`)
Claude Messages API 格式，与 `/anthropic/v1/messages` 端点使用相同的协议。

**自动注册路径**：
- `{基础路径}/v1/messages`
- `{基础路径}/v1/v1/messages`（兼容某些客户端）
- `{基础路径}/v1/messages/count_tokens`（Claude Code/SDK 可能会调用）
- `{基础路径}/v1/v1/messages/count_tokens`（兼容性）

**适用场景**：
- 需要 Claude 原生功能（如 thinking blocks、cache control）
- 客户端代码使用 Anthropic SDK
- 兼容 Claude Code、claude-cli 等工具

### 2. OpenAI 协议 (`openai-auto`)
**推荐使用**：自动支持 OpenAI 的两种 API 格式。

**自动注册路径**：
- `{基础路径}/v1/chat/completions`（Chat Completions API）
- `{基础路径}/v1/responses`（Responses API）

**适用场景**：
- 需要同时支持两种 OpenAI API 格式
- 兼容多种 OpenAI 客户端
- 最灵活的 OpenAI 配置方式

### 3. OpenAI Chat Completions (`openai-chat`)
仅支持 OpenAI `/v1/chat/completions` 格式。

**自动注册路径**：
- `{基础路径}/v1/chat/completions`

**适用场景**：
- 仅使用标准的 Chat Completions 格式
- 支持 function calling
- 兼容大多数 OpenAI 客户端

### 4. OpenAI Responses API (`openai-responses`)
仅支持 OpenAI `/v1/responses` 格式（较新的 API 格式）。

**自动注册路径**：
- `{基础路径}/v1/responses`

**适用场景**：
- 使用 OpenAI 的 Responses API
- 需要更结构化的响应格式

## 配置方式

### 方式一：通过配置文件（基础配置）

编辑 `~/.cc-gw/config.json`，添加 `customEndpoints` 数组：

```json
{
  "port": 4100,
  "providers": [...],
  "customEndpoints": [
    {
      "id": "claude-api",
      "label": "Claude 专用接入点",
      "path": "/claude",
      "protocol": "anthropic",
      "enabled": true,
      "routing": {
        "defaults": {
          "completion": "anthropic:claude-sonnet-4-5-20250929",
          "reasoning": "anthropic:claude-opus-4-1-20250805",
          "background": null,
          "longContextThreshold": 100000
        },
        "modelRoutes": {
          "claude-*": "anthropic:*"
        }
      }
    },
    {
      "id": "openai-compat",
      "label": "OpenAI 兼容接入点",
      "path": "/openai-api",
      "protocol": "openai-auto",
      "enabled": true,
      "routing": {
        "defaults": {
          "completion": "openai:gpt-4o",
          "reasoning": "openai:o1-preview",
          "background": null,
          "longContextThreshold": 100000
        },
        "modelRoutes": {
          "gpt-*": "openai:*",
          "o1-*": "openai:*"
        }
      }
    }
  ]
}
```

**说明**：
- `/claude` 会自动扩展为 `/claude/v1/messages`
- `/openai-api` 会自动扩展为 `/openai-api/v1/chat/completions` 和 `/openai-api/v1/responses`

### 方式二：多路径配置（高级功能）

一个端点可以注册多个路径，每个路径使用不同的协议：

```json
{
  "customEndpoints": [
    {
      "id": "multi-protocol",
      "label": "多协议接入点",
      "paths": [
        {
          "path": "/api/claude",
          "protocol": "anthropic"
        },
        {
          "path": "/api/openai",
          "protocol": "openai-auto"
        }
      ],
      "enabled": true,
      "routing": {
        "defaults": {
          "completion": "anthropic:claude-sonnet-4-5-20250929",
          "reasoning": null,
          "background": null,
          "longContextThreshold": 60000
        },
        "modelRoutes": {
          "claude-*": "anthropic:*",
          "gpt-*": "openai:*"
        }
      }
    }
  ]
}
```

**说明**：
- 同一个端点可以同时提供多个协议的访问方式
- `/api/claude` → Anthropic 协议（自动注册 `/api/claude/v1/messages`）
- `/api/openai` → OpenAI 协议（自动注册 `/api/openai/v1/chat/completions` 和 `/api/openai/v1/responses`）

### 方式三：通过 REST API

#### 获取自定义端点列表
```bash
curl http://localhost:4100/api/custom-endpoints
```

#### 创建自定义端点（基础配置）
```bash
curl -X POST http://localhost:4100/api/custom-endpoints \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-custom-endpoint",
    "label": "我的自定义端点",
    "path": "/my-api",
    "protocol": "anthropic",
    "enabled": true,
    "routing": {
      "defaults": {
        "completion": "anthropic:claude-sonnet-4-5-20250929",
        "reasoning": null,
        "background": null,
        "longContextThreshold": 60000
      },
      "modelRoutes": {
        "claude-*": "anthropic:*"
      }
    }
  }'
```

#### 创建自定义端点（多路径配置）
```bash
curl -X POST http://localhost:4100/api/custom-endpoints \
  -H "Content-Type: application/json" \
  -d '{
    "id": "multi-path-endpoint",
    "label": "多路径端点",
    "paths": [
      {
        "path": "/api/claude",
        "protocol": "anthropic"
      },
      {
        "path": "/api/openai",
        "protocol": "openai-auto"
      }
    ],
    "enabled": true,
    "routing": {
      "defaults": {
        "completion": "anthropic:claude-sonnet-4-5-20250929"
      },
      "modelRoutes": {}
    }
  }'
```

#### 更新自定义端点
```bash
curl -X PUT http://localhost:4100/api/custom-endpoints/my-custom-endpoint \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": false
  }'
```

#### 删除自定义端点
```bash
curl -X DELETE http://localhost:4100/api/custom-endpoints/my-custom-endpoint
```

## 配置字段说明

### CustomEndpointConfig

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 端点唯一标识符，用于内部识别 |
| `label` | string | 是 | 端点显示名称，用于 UI 展示 |
| `path` | string | 二选一* | **基础路径**，如 `/my-api`（系统会自动添加协议子路径） |
| `paths` | array | 二选一* | **多路径配置**（高级功能），每个路径可以有不同的协议 |
| `protocol` | string | 与 `path` 配套 | 协议类型：`anthropic`、`openai-auto`、`openai-chat`、`openai-responses` |
| `enabled` | boolean | 否 | 是否启用（默认：`true`） |
| `routing` | object | 否 | 路由配置，如果不提供则使用全局配置 |
| `routingPresets` | array | 否 | 保存的路由模板（通过 Web UI 创建） |

**说明**：
- `path` + `protocol`：简单配置，一个端点一个协议
- `paths`：高级配置，一个端点多个路径和协议

### Paths 数组格式

当使用 `paths` 时，每个数组元素包含：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 基础路径，如 `/api/claude` |
| `protocol` | string | 是 | 该路径使用的协议类型 |

### 协议类型 (EndpointProtocol)

| 值 | 说明 | 自动注册的子路径 |
|---|------|-----------------|
| `anthropic` | Claude Messages API | `/v1/messages`<br>`/v1/v1/messages` |
| `openai-auto` | OpenAI 自动协议（推荐） | `/v1/chat/completions`<br>`/v1/responses` |
| `openai-chat` | OpenAI Chat Completions | `/v1/chat/completions` |
| `openai-responses` | OpenAI Responses API | `/v1/responses` |

### Routing 配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `defaults.completion` | string\|null | 默认模型路由 |
| `defaults.reasoning` | string\|null | 推理任务模型路由 |
| `defaults.background` | string\|null | 长上下文任务模型路由 |
| `defaults.longContextThreshold` | number | 长上下文阈值（token 数） |
| `modelRoutes` | object | 模型映射规则 |

## 使用示例

### 示例 1：为不同客户端创建专用端点

```json
{
  "customEndpoints": [
    {
      "id": "mobile-app",
      "label": "移动应用接入点",
      "path": "/mobile/api/chat",
      "protocol": "openai-chat",
      "enabled": true,
      "routing": {
        "defaults": {
          "completion": "anthropic:claude-haiku-4-5-20251001",
          "reasoning": null,
          "background": null,
          "longContextThreshold": 50000
        },
        "modelRoutes": {
          "*": "anthropic:claude-haiku-4-5-20251001"
        }
      }
    },
    {
      "id": "web-app",
      "label": "Web 应用接入点",
      "path": "/web/api/chat",
      "protocol": "anthropic",
      "enabled": true,
      "routing": {
        "defaults": {
          "completion": "anthropic:claude-sonnet-4-5-20250929",
          "reasoning": "anthropic:claude-opus-4-20250514",
          "background": null,
          "longContextThreshold": 100000
        },
        "modelRoutes": {}
      }
    }
  ]
}
```

### 示例 2：多供应商路由

```json
{
  "customEndpoints": [
    {
      "id": "multi-provider",
      "label": "多供应商智能路由",
      "path": "/smart/chat",
      "protocol": "openai-chat",
      "enabled": true,
      "routing": {
        "defaults": {
          "completion": "anthropic:claude-sonnet-4-5-20250929",
          "reasoning": "openai:o1-preview",
          "background": "anthropic:claude-opus-4-20250514",
          "longContextThreshold": 100000
        },
        "modelRoutes": {
          "gpt-*": "openai:*",
          "claude-*": "anthropic:*",
          "deepseek-*": "deepseek:*",
          "moonshot-*": "kimi:*"
        }
      }
    }
  ]
}
```

### 示例 3：测试环境端点

```json
{
  "customEndpoints": [
    {
      "id": "test-endpoint",
      "label": "测试环境",
      "path": "/test/messages",
      "protocol": "anthropic",
      "enabled": false,
      "routing": {
        "defaults": {
          "completion": "anthropic:claude-haiku-4-5-20251001",
          "reasoning": null,
          "background": null,
          "longContextThreshold": 10000
        },
        "modelRoutes": {}
      }
    }
  ]
}
```

## 客户端使用

### Python (Anthropic SDK)

```python
from anthropic import Anthropic

# 使用自定义端点（只需配置基础路径）
client = Anthropic(
    api_key="your-api-key",
    base_url="http://localhost:4100/claude"  # 基础路径
)

# SDK 会自动请求 /claude/v1/messages
message = client.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
print(message.content)
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

# 使用自定义端点
client = OpenAI(
    api_key="your-api-key",
    base_url="http://localhost:4100/openai-api"  # 基础路径
)

# SDK 会自动请求 /openai-api/v1/chat/completions
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
print(response.choices[0].message.content)
```

### cURL

```bash
# Anthropic 协议（配置了 path: "/claude", protocol: "anthropic"）
curl -X POST http://localhost:4100/claude/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'

# OpenAI Chat Completions（配置了 path: "/openai-api", protocol: "openai-auto"）
curl -X POST http://localhost:4100/openai-api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'

# OpenAI Responses API（同一端点，不同路径）
curl -X POST http://localhost:4100/openai-api/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4o",
    "prompt": "Hello!"
  }'
```

## 最佳实践

### 1. 端点命名
- 使用有意义的 ID 和标签
- ID 应该是小写字母、数字和连字符的组合
- **基础路径**应该简洁明了（如 `/claude`、`/openai-api`）
- 无需在路径中包含 `/v1/messages` 等协议子路径，系统会自动添加

### 2. 协议选择
- **推荐使用 `openai-auto`**：自动支持 Chat Completions 和 Responses API
- 如果客户端已经使用 OpenAI SDK → 选择 `openai-auto` 或 `openai-chat`
- 如果需要 Claude 特性（thinking、cache、prompt caching） → 选择 `anthropic`
- 如果只使用 OpenAI Responses API → 选择 `openai-responses`

### 3. 路由配置
- 使用通配符 `*` 来匹配模型系列（如 `claude-*`、`gpt-*`）
- 为不同类型的任务配置不同的默认模型：
  - `completion`：常规对话任务
  - `reasoning`：需要深度思考的任务
  - `background`：长上下文任务（可选）
- 设置合理的长上下文阈值（`longContextThreshold`）

### 4. 多路径使用场景
- 一个端点同时支持 Anthropic 和 OpenAI 协议
- 为不同的客户端版本提供不同的路径
- 渐进式迁移（保留旧路径，添加新路径）

### 5. 安全性
- 为生产环境的端点启用 API key 验证
- 使用 Web Auth 保护管理接口
- 定期审查端点配置
- 不要在公网暴露未保护的端点

## 注意事项

1. **路径自动扩展**：
   - 配置基础路径（如 `/my-endpoint`）时，系统会根据协议自动添加子路径
   - Anthropic 协议：自动添加 `/v1/messages` 和 `/v1/v1/messages`
   - OpenAI Auto：自动添加 `/v1/chat/completions` 和 `/v1/responses`
   - **客户端访问时需使用完整路径**（如 `/my-endpoint/v1/messages`）

2. **路径冲突**：确保自定义端点基础路径不与现有路径冲突：
   - `/anthropic` - 保留给系统 Anthropic 端点
   - `/openai` - 保留给系统 OpenAI 端点
   - `/api` - 保留给管理 API
   - `/ui` - 保留给 Web UI
   - `/health` - 保留给健康检查

3. **配置格式兼容性**：
   - **旧格式**：`path` + `protocol`（单路径）
   - **新格式**：`paths` 数组（多路径）
   - 两种格式都支持，但不能同时使用
   - 推荐使用新格式以获得更好的灵活性

4. **热重载限制**：
   - 修改 `routing`、`enabled` 字段会立即生效（无需重启）
   - 添加或修改 `path`/`paths` 需要重启服务器
   - 删除端点需要重启才能完全清理路由

5. **路由优先级**：
   - 自定义端点的路由配置优先于全局配置
   - 同一端点内，`modelRoutes` 优先于 `defaults`
   - 模型匹配按最具体的模式优先（`claude-3-5-haiku` > `claude-3-*` > `claude-*`）

6. **日志和监控**：
   - 所有自定义端点的请求都会记录到统一的日志系统
   - Web UI 中可以查看每个端点的请求统计
   - 支持保存和应用路由模板（Routing Presets）

## 故障排除

### 端点返回 404
**原因**：客户端使用的路径与实际注册的路径不匹配。

**解决方法**：
1. 检查配置的基础路径（如 `/my-endpoint`）
2. 根据协议确定完整路径：
   - Anthropic 协议 → 访问 `/my-endpoint/v1/messages`
   - OpenAI Auto → 访问 `/my-endpoint/v1/chat/completions` 或 `/my-endpoint/v1/responses`
3. 检查服务器日志，查看实际注册的路径：
   ```bash
   tail -f ~/.cc-gw/logs/cc-gw.log | grep "Registering custom endpoint"
   ```

### 端点配置不生效
**检查清单**：
- `enabled` 字段是否为 `true`
- 基础路径是否正确（以 `/` 开头）
- 协议类型是否正确（`anthropic`、`openai-auto`、`openai-chat`、`openai-responses`）
- 是否有路径冲突
- 添加新端点后是否重启了服务器

### 路由不工作
**检查清单**：
- `routing.modelRoutes` 配置是否正确
- Provider ID 是否存在于 `providers` 配置中
- 模型 ID 是否在 provider 中配置（或使用 `*` 通配符）
- 使用 Web UI 的"模型管理"页面测试路由规则

### 协议不兼容
**症状**：客户端报错或返回格式错误。

**解决方法**：
- 确认客户端使用的协议与配置的协议类型一致
- Anthropic SDK → 使用 `anthropic` 协议
- OpenAI SDK → 使用 `openai-auto` 或 `openai-chat` 协议
- 检查请求格式是否符合协议规范

### 多路径配置问题
**常见错误**：同时使用 `path` 和 `paths` 字段。

**解决方法**：
- 只使用 `path` + `protocol`（简单配置）
- 或只使用 `paths` 数组（高级配置）
- 不要同时使用两者

### Web UI 显示问题
**症状**：端点标签显示为原始 JSON 或 i18n key。

**解决方法**：
- 确保 `label` 字段已正确设置
- 刷新浏览器页面
- 清除浏览器缓存

## 相关文档

- [Features and Architecture](./features-and-architecture.md) - 系统架构说明
- [README.md](../README.md) - 项目概览和基本配置
