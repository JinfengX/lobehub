/**
 * Agent execution mode
 * - auto: automatically decide execution strategy
 * - plan: plan first then execute, suitable for complex tasks
 * - ask: ask for user confirmation before execution
 * - implement: execute directly without asking
 */
export type AgentMode = 'auto' | 'plan' | 'ask' | 'implement';

/**
 * Runtime environment mode
 * - local: Access local files and commands (desktop only)
 * - cloud: Run in cloud sandbox
 * - none: No runtime environment
 */
export type RuntimeEnvMode = 'cloud' | 'local' | 'none';

/**
 * Runtime environment configuration (desktop only)
 */
export interface RuntimeEnvConfig {
  /**
   * Runtime environment mode
   */
  runtimeMode?: RuntimeEnvMode;
  /**
   * Working directory (desktop only)
   */
  workingDirectory?: string;
}
