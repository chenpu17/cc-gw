# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-gw is a local multi-model gateway for Claude Code and similar AI clients. It normalizes `/v1/messages` requests, routes them to configured providers (Anthropic, OpenAI, Kimi, DeepSeek, etc.), and provides observability through a web console and CLI daemon.

**Core Purpose**: Act as a local proxy that translates Claude-style API calls into provider-specific formats, enabling model switching, request logging, token tracking (including cache hits), and centralized management.

## Monorepo Structure

This is a pnpm workspace with three main packages:

```
src/
├── cli/          # @cc-gw/cli - CLI daemon (start/stop/restart/status)
├── server/       # @cc-gw/server - Fastify gateway server
└── web/          # @cc-gw/web - React + Vite management UI
```

All packages use TypeScript with ESM modules (`"type": "module"`).

## Development Commands

### Build Commands
```bash
# Build individual packages
pnpm --filter @cc-gw/server build    # tsup builds to src/server/dist/
pnpm --filter @cc-gw/web build       # Vite builds to src/web/dist/
pnpm --filter @cc-gw/cli build       # tsup builds to src/cli/dist/

# Build all packages
pnpm run build:all

# Watch mode for development
pnpm --filter @cc-gw/server dev      # tsx watch mode
```

### Running the Server
```bash
# Development (from source)
pnpm --filter @cc-gw/server dev

# Production (via CLI)
pnpm --filter @cc-gw/cli exec tsx index.ts start --daemon --port 4100
```

### Testing
```bash
# Unit tests (vitest)
pnpm test                            # Run all tests
pnpm exec vitest run                 # Explicit vitest run

# E2E tests (Playwright)
pnpm test:playwright                 # Tests in tests/playwright/
```

### Code Quality
```bash
pnpm lint                            # ESLint check
pnpm format                          # Prettier check
pnpm format:write                    # Auto-format with Prettier
pnpm typecheck                       # TypeScript check (all packages)
```

### Release
```bash
pnpm run release:bundle              # Build and package for npm
```

## Architecture Patterns

### Request Flow
1. Client → Fastify route handler (`/anthropic/v1/messages` or `/openai/v1/*`)
2. Normalize payload → standardized internal format ([src/server/protocol/normalize.ts](src/server/protocol/normalize.ts))
3. Resolve route → determine target provider/model ([src/server/router/index.ts](src/server/router/index.ts))
4. Build provider body → convert to provider-specific format ([src/server/protocol/toProvider.ts](src/server/protocol/toProvider.ts))
5. Provider connector → make upstream request ([src/server/providers/](src/server/providers/))
6. Stream/transform response → return Claude-compatible format
7. Log metrics → SQLite storage ([src/server/logging/logger.ts](src/server/logging/logger.ts))

### Key Modules

**Protocol Layer** ([src/server/protocol/](src/server/protocol/)):
- `normalize.ts` - Converts Claude `/v1/messages` to internal format
- `normalize-openai.ts` - Converts OpenAI Responses API to internal format
- `normalize-openai-chat.ts` - Converts Chat Completions to internal format
- `toProvider.ts` - Builds provider-specific request bodies
- `tokenizer.ts` - Token estimation using tiktoken

**Router** ([src/server/router/index.ts](src/server/router/index.ts)):
- Model aliasing (e.g., `claude-sonnet-latest` → actual version)
- Route resolution with wildcard support (`*` patterns)
- Provider passthrough (`providerId:*` forwards original model name)
- Long-context detection and fallback routing
- Default model selection per endpoint

**Provider Registry** ([src/server/providers/](src/server/providers/)):
- `registry.ts` - Maps provider types to connectors
- `anthropic.ts` - Direct Anthropic passthrough (preserves metadata/headers)
- `openai.ts` - OpenAI-compatible adapter
- `kimi.ts` - Moonshot Kimi adapter
- `deepseek.ts` - DeepSeek adapter

Each connector returns a `ProviderConnector` with:
- `sendRequest()` - Non-streaming requests
- `streamRequest()` - SSE streaming
- Automatic auth header injection
- Error mapping to Claude-style responses

**Storage** ([src/server/storage/index.ts](src/server/storage/index.ts)):
- better-sqlite3 database at `~/.cc-gw/data/gateway.db`
- Tables: `request_logs`, `request_payloads`, `daily_metrics`, `api_keys`
- Automatic migrations on startup
- Brotli compression for stored payloads

**Configuration** ([src/server/config/](src/server/config/)):
- `~/.cc-gw/config.json` - Main config file
- Hot-reload support via `onConfigChange()` callbacks
- Endpoint-specific routing (`endpointRouting.anthropic`, `endpointRouting.openai`)

**Web UI** ([src/web/](src/web/)):
- React 18 + React Router + TanStack Query
- Tailwind CSS styling
- i18next for Chinese/English localization
- ECharts for metrics visualization
- Pages: Dashboard, Logs, Model Management, Settings

## Important Implementation Details

### Model Routing Priority
1. Check `modelRoutes` for exact match
2. Check `modelRoutes` for wildcard pattern match (highest specificity wins)
3. Use endpoint-specific defaults (`completion`, `reasoning`, `background`)
4. Fall back to first provider with matching model
5. If target is `providerId:*`, forward original model name to provider

### Routing Fallback Mechanism
- **Default behavior** (`enableRoutingFallback: false`): Throw error when no model matches
- **Fallback enabled** (`enableRoutingFallback: true`): Use first provider with configured models
- Fallback skips passthrough providers (those with no models configured)
- Intended for legacy compatibility; explicit routing is recommended

### Provider Passthrough Mode
Providers can be configured without a `models` array to enable passthrough mode:
- **Purpose**: Forward any model name to the provider without validation
- **Usage**: Must be explicitly routed via `modelRoutes` (e.g., `"claude-*": "anthropic:*"`)
- **Not used in fallback**: Passthrough providers are excluded from automatic fallback
- **UI hint**: Web UI shows amber warning when no models configured

### Routing Presets (Templates)
Both Anthropic and OpenAI endpoints support saving/loading routing configurations:
- **Save**: Capture current `modelRoutes` as named preset
- **Apply**: Restore saved preset with one click
- **Storage**: Stored in `config.routingPresets.{endpoint}`
- **Use case**: Quick switching between provider configurations (e.g., "production", "testing")
- **API**: `/api/routing-presets/:endpoint` (POST/DELETE), `/api/routing-presets/:endpoint/apply` (POST)

### Token Estimation Fallback
When provider doesn't return usage data:
- Estimate input tokens from messages using tiktoken (cl100k_base)
- Estimate output tokens from response text
- Log with `is_estimated: 1` flag

### Cache Token Tracking
The gateway tracks Anthropic prompt caching with separated statistics:
- **Cache Read Tokens** (`cache_read_tokens`): Tokens loaded from existing cache
- **Cache Creation Tokens** (`cache_creation_tokens`): Tokens written to establish new cache
- **Total Cached Tokens** (`cached_tokens`): Sum of read + creation (for backward compatibility)

**Provider Behavior Differences**:
- **Anthropic API**: Returns both `cache_read_input_tokens` and `cache_creation_input_tokens`
- **OpenAI API**: Returns only `cached_tokens` (total, not separated)
- **Other providers** (e.g., GLM Pro): May only return `cache_read_input_tokens`

**Implementation Pattern**:
```typescript
// All route handlers use resolveCachedTokens() helper
const cached = resolveCachedTokens(usage)
// Returns: { read: number, creation: number }

await updateLogTokens(logId, {
  inputTokens,
  outputTokens,
  cachedTokens: cached.read + cached.creation,
  cacheReadTokens: cached.read,
  cacheCreationTokens: cached.creation,
  // ...
})
```

**Important**: For streaming responses, accumulate cache tokens across SSE events:
```typescript
let usageCacheRead = 0
let usageCacheCreation = 0

// In event handlers (message_delta, message_stop):
const cached = resolveCachedTokens(payload.usage)
usageCacheRead = cached.read
usageCacheCreation = cached.creation
```

### Anthropic Provider Special Handling
- Preserves original Claude payload structure
- Forwards all custom headers (`anthropic-beta`, `x-stainless-*`, etc.)
- Supports both `apiKey` and `authToken` auth modes
- Parses separated cache statistics (`cache_read_input_tokens`, `cache_creation_input_tokens`)

### Streaming Response Format
- Server transforms provider SSE → Claude-compatible events
- Events: `message_start`, `content_block_delta`, `message_delta`, `message_stop`, `error`
- Final usage metrics logged after stream completes

### API Key Management
- Stored in SQLite `api_keys` table (encrypted with AES-256-GCM)
- Optional usage tracking per key
- Used for gateway authentication, not forwarded to providers
- Managed via Web UI Settings → API Keys

## Configuration Structure

```typescript
{
  host: string                        // Listen address
  port: number                        // Listen port
  providers: ProviderConfig[]         // Provider definitions
  enableRoutingFallback: boolean      // Default: false; enable auto-fallback
  endpointRouting: {
    anthropic: {
      defaults: { completion?, reasoning?, background?, longContextThreshold }
      modelRoutes: { [sourceModel]: "providerId:modelId" }
      routingPresets?: { name, modelRoutes }[]  // Saved routing templates
    }
    openai: { ... }                   // Same structure
  }
  routingPresets?: {
    anthropic?: Array<{ name: string; modelRoutes: Record<string, string> }>
    openai?: Array<{ name: string; modelRoutes: Record<string, string> }>
  }
  logRetentionDays: number            // Auto-cleanup threshold
  storeRequestPayloads: boolean
  storeResponsePayloads: boolean
  bodyLimit: number                   // Max request size (bytes)
  logLevel: string                    // Pino level
  requestLogging: boolean
  responseLogging: boolean
  webAuth?: { enabled, username, password }
}
```

### Provider Config
```typescript
{
  id: string                          // Unique identifier
  label: string                       // Display name
  type: 'anthropic' | 'openai' | 'kimi' | 'deepseek' | 'custom'
  baseUrl: string                     // API endpoint
  apiKey: string                      // Provider API key
  authMode?: 'apiKey' | 'authToken'   // Anthropic only
  defaultModel?: string
  models?: Array<{ id, label }>       // Optional; omit for passthrough mode
}
```

**Note**: The `models` array is optional. When omitted or empty, the provider operates in "passthrough mode" and accepts any model name via explicit routing.

### Custom Endpoint Config

Custom endpoints allow creating additional API entry points with independent routing:

```typescript
{
  id: string                          // Unique identifier
  label: string                       // Display name
  path?: string                       // Base path (old format, single path)
  paths?: Array<{                     // Multi-path config (new format, advanced)
    path: string                      // Base path for this protocol
    protocol: EndpointProtocol        // Protocol for this path
  }>
  protocol?: EndpointProtocol         // Protocol type (with old format)
  enabled?: boolean                   // Default: true
  routing?: EndpointRoutingConfig     // Independent routing config
  routingPresets?: RoutingPreset[]    // Saved routing templates
}

type EndpointProtocol = 'anthropic' | 'openai-auto' | 'openai-chat' | 'openai-responses'
```

**Automatic Path Expansion**: The system automatically adds protocol-specific subpaths:
- `anthropic`: `/v1/messages` and `/v1/v1/messages`
- `openai-auto`: `/v1/chat/completions` and `/v1/responses`
- `openai-chat`: `/v1/chat/completions`
- `openai-responses`: `/v1/responses`

**Example**: Configure `path: "/claude2"` with `protocol: "anthropic"`, clients access via `POST /claude2/v1/messages`.

**Format Compatibility**:
- **Old format**: `path` + `protocol` (single path, single protocol)
- **New format**: `paths` array (multi-path, can mix protocols)

See [docs/custom-endpoints.md](docs/custom-endpoints.md) for detailed usage guide.

## Testing Strategy

### Unit Tests (Vitest)
- Location: `tests/**/*.test.ts`
- Focus: Protocol normalization, routing logic, encryption
- Run before commits for core logic changes

### E2E Tests (Playwright)
- Location: `tests/playwright/**/*.spec.ts`
- Focus: Web UI flows, API key management
- Requires running server instance

## Common Development Tasks

### Adding a New Provider Type
1. Create adapter in [src/server/providers/](src/server/providers/) (see [openai.ts](src/server/providers/openai.ts) template)
2. Register in [providers/registry.ts](src/server/providers/registry.ts) `buildConnector()`
3. Update [config/types.ts](src/server/config/types.ts) `ProviderType` union
4. Test with sample requests via `/anthropic` or `/openai` endpoints

### Modifying Protocol Normalization
- Edit [protocol/normalize.ts](src/server/protocol/normalize.ts) for Claude format changes
- Update [protocol/toProvider.ts](src/server/protocol/toProvider.ts) for provider output changes
- Run protocol tests: `pnpm test tests/protocol/`

### Updating Token Tracking Logic
When modifying `updateLogTokens()` function signature in [src/server/logging/logger.ts](src/server/logging/logger.ts):

**Critical**: ALL route handler files must be updated to pass new parameters:
- [src/server/routes/messages.ts](src/server/routes/messages.ts) - Anthropic Messages API
- [src/server/routes/openai.ts](src/server/routes/openai.ts) - OpenAI Chat & Responses
- [src/server/routes/custom-endpoint.ts](src/server/routes/custom-endpoint.ts) - Custom endpoints

**For each route file**, update both:
1. **Non-streaming responses**: Use local `cached` object from `resolveCachedTokens()`
2. **Streaming responses**: Use accumulated tracking variables (`usageCacheRead`, `usageCacheCreation`)

**Pattern to search for**:
```bash
# Find all updateLogTokens calls
grep -n "updateLogTokens" src/server/routes/*.ts

# Find all updateMetrics calls (also needs cache fields)
grep -n "updateMetrics" src/server/routes/*.ts
```

### Adding Web UI Features
- Components in [src/web/src/components/](src/web/src/components/)
- Pages in [src/web/src/pages/](src/web/src/pages/)
- API calls in [src/web/src/api/](src/web/src/api/)
- Localization strings in [src/web/src/i18n/](src/web/src/i18n/)

### Database Schema Changes
- Add migration logic in [storage/index.ts](src/server/storage/index.ts) `initializeDatabase()`
- Use `maybeAddColumn()` helper for backward-compatible column additions
- Migrations run automatically on server start
- Test with clean DB: `rm ~/.cc-gw/data/gateway.db && pnpm dev`

**Critical**: When adding new database columns:
1. Add column in migration using `maybeAddColumn()`
2. Update TypeScript interfaces in [src/server/logging/queries.ts](src/server/logging/queries.ts)
3. **Must update ALL SQL SELECT statements** in queries.ts that fetch the table:
   - `queryLogs()` - Main list query
   - `getLogDetail()` - Single record query
   - `exportLogs()` - Export query
4. Update frontend TypeScript types in [src/web/src/types/logs.ts](src/web/src/types/logs.ts)
5. Update UI components to display new fields

**Example** (adding cache fields):
```typescript
// 1. Migration in storage/index.ts
await maybeAddColumn(db, 'request_logs', 'cache_read_tokens', 'INTEGER DEFAULT 0')

// 2. Interface in logging/queries.ts
export interface LogRecord {
  cache_read_tokens: number | null
  // ...
}

// 3. ALL SELECT statements must include the new field
const items = await getAll<LogRecord>(
  `SELECT id, ..., cache_read_tokens, ... FROM request_logs ...`
)
```

**Common Mistake**: Forgetting to update SQL queries causes API to return `null` even though database has correct values.

### Working with Custom Endpoints
- Route registration: [src/server/routes/custom-endpoint.ts](src/server/routes/custom-endpoint.ts)
- Protocol auto-expansion: `getPathsToRegister()` function
- Admin APIs: [src/server/routes/admin.ts](src/server/routes/admin.ts) `/api/custom-endpoints/*`
- Web UI management: [src/web/src/pages/ModelManagement.tsx](src/web/src/pages/ModelManagement.tsx)
- Key features:
  - Automatic path expansion based on protocol type
  - Multi-path support (one endpoint, multiple paths/protocols)
  - Hot-reload for `routing` and `enabled` changes
  - Requires restart for path changes
- Documentation: [docs/custom-endpoints.md](docs/custom-endpoints.md)

## Debugging Tips

### Enable Debug Logging
```bash
# Show downstream provider URLs
CC_GW_DEBUG_ENDPOINTS=1 pnpm dev

# Increase log verbosity
# Edit config.json: "logLevel": "debug"
```

### Check Request Flow
1. Web UI → Logs page shows request/response payloads
2. Console logs show `event: usage.metrics` with token counts
3. SQLite DB can be queried directly: `sqlite3 ~/.cc-gw/data/gateway.db`

### Troubleshooting Build Issues
- Ensure all packages built: `pnpm run build:all`
- Clear node_modules if stale: `pnpm store prune && pnpm install`
- Check TypeScript references in root `tsconfig.json`

## File Paths Reference

- Config: `~/.cc-gw/config.json`
- Database: `~/.cc-gw/data/gateway.db`
- Logs: `~/.cc-gw/logs/cc-gw.log`
- PID: `~/.cc-gw/cc-gw.pid`

## Related Documentation

- Main README: [README.md](README.md) - User-facing setup guide
- Architecture: [docs/features-and-architecture.md](docs/features-and-architecture.md)
- Custom Endpoints: [docs/custom-endpoints.md](docs/custom-endpoints.md) - Custom API endpoints guide
- Package manifests: Individual `package.json` in each `src/*/` directory
