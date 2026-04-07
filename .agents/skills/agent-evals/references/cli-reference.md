# Agent Evals CLI Reference

## Directory Structure

```
devtools/agent-evals/
├── cli.ts                          # CLI entry (#!/usr/bin/env bun)
├── package.json                    # @cloud/agent-evals
├── types.ts                        # ScenarioConfig, McpToolConfig, BotContext, ModelVariant
├── helpers/
│   ├── env.ts                      # PGlite init, user/agent creation, MCP registration
│   ├── runner.ts                   # runAgent(), runMatrix()
│   ├── snapshot.ts                 # SnapshotHandle assertion API
│   ├── tracing.ts                  # StepLifecycleCallbacks → ExecutionSnapshot collector
│   ├── mcp.ts                      # MCP server discovery + DB registration
│   ├── claude-credentials.ts       # Read OAuth tokens from Claude Code keychain
│   └── compare.ts                  # Matrix comparison table renderer
└── scenarios/                      # Scenario files (export default ScenarioConfig)
```

## CLI Commands

```bash
# Run a specific scenario
bun run agent-evals run basic-chat

# Override model/provider
bun run agent-evals run bot-discord --model deepseek-chat
bun run agent-evals run basic-chat --model claude-sonnet-4-20250514 --provider openai

# Inline prompt
bun run agent-evals run --prompt "What is 2+2?" --model gpt-4o-mini

# Model matrix (comma-separated, supports model@provider)
bun run agent-evals run --prompt "Hello" --matrix "gpt-4o-mini@openai,deepseek-chat@openai"

# Dataset cases
bun run agent-evals run web-onboarding-v3 --all-cases
bun run agent-evals run web-onboarding-v3 --case-id fe-intj-crud-v1
bun run agent-evals run web-onboarding-v3 --all-cases --sample-cases 2 --seed 7

# Disable scenario matrix
bun run agent-evals run web-onboarding-v3 --no-matrix --model gpt-5.4-mini

# Run all scenarios
bun run agent-evals run --all

# List scenarios
bun run agent-evals list
```

## ScenarioConfig Type

```typescript
interface ScenarioConfig {
  name: string;
  description?: string;
  prompt: string;
  agent: {
    model?: string; // default: gpt-4o-mini
    provider?: string; // default: openai
    systemRole?: string;
    plugins?: string[];
    mcpServers?: McpToolConfig[];
  };
  bot?: BotContext; // Simulate bot trigger (discord, telegram, etc.)
  matrix?: ModelVariant[]; // Run across multiple model/provider combos
  cases?: ScenarioCase[]; // Reusable conversation cases
  maxSteps?: number; // default: 10
  timeout?: number; // default: 120_000
  turns?: string[]; // Multi-turn follow-up messages
  assertions?: (snapshot: ExecutionSnapshot, context: AssertionContext) => void;
}
```

## Creating a New Scenario

```typescript
import type { ScenarioConfig } from '../types';

export default {
  name: 'My Scenario',
  agent: { model: 'gpt-4o-mini' },
  prompt: 'Your test prompt here',
  assertions: (snapshot) => {
    if (snapshot.completionReason !== 'done') {
      throw new Error(`Expected "done", got "${snapshot.completionReason}"`);
    }
  },
} satisfies ScenarioConfig;
```

## MCP Tool Testing

```typescript
export default {
  name: 'Linear MCP',
  agent: {
    model: 'gpt-4o-mini',
    mcpServers: [
      {
        identifier: 'linear-server',
        connection: { type: 'http', url: 'https://mcp.linear.app/mcp' },
        auth: { type: 'bearer', token: 'auto' },
      },
    ],
  },
  prompt: 'List recent issues in LOBE project',
} satisfies ScenarioConfig;
```

Auth token resolution: `'auto'` (macOS Keychain) → `'$ENV_VAR'` → literal string.

## Bot Trigger Testing

```typescript
export default {
  name: 'Discord Bot',
  agent: { model: 'gpt-4o-mini', systemRole: 'You are a Discord bot.' },
  bot: {
    platform: 'discord',
    applicationId: 'my-bot-id',
    platformThreadId: 'discord:guild:channel:thread',
    discordContext: {
      channel: { id: 'ch001', name: 'general' },
      guild: { id: 'guild001' },
    },
  },
  prompt: 'Hello bot!',
} satisfies ScenarioConfig;
```

## SnapshotHandle Assertion API

```typescript
handle
  .assertCompleted()          // completionReason === 'done'
  .assertNoError()
  .assertStepCount(2, 5)     // min 2, max 5 steps
  .assertHasToolCall('lobe-web-browsing', 'search')
  .atStep(0, (step) => { ... })
  .someStep((step) => step.content?.includes('keyword'), 'Expected keyword')
  .print();
```

## Implementation Details

- **DB**: PGlite in-memory via `getTestDB()`
- **Agent**: `AiAgentService(db, userId)` — constructor injection
- **Provider**: Default `openai` (non-`lobehub`) — skips billing hooks
- **State**: `InMemoryAgentStateManager` — no Redis needed
- **MCP**: `MCPService.getStreamableMcpServerManifest()` discovers tools
