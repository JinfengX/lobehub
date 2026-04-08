import { escapeXml } from '@lobechat/prompts';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    agentIdentityContextInjected?: boolean;
  }
}

const log = debug('context-engine:provider:AgentIdentityContextInjector');

/**
 * Current agent identity info.
 *
 * Injected so the model knows "who am I" when operating tools that act on
 * platform resources (e.g. the `lh` CLI from the LobeHub builtin skill).
 * Without this, the model would have to search for itself before issuing
 * agent/topic-scoped commands.
 *
 * NOTE: deliberately does NOT include `systemRole` — the agent's full
 * systemRole is already injected as the system message by `SystemRoleInjector`
 * (Phase 2). Re-emitting it here would just waste tokens and risk drift
 * between two copies.
 */
export interface AgentIdentityInfo {
  description?: string;
  id: string;
  model?: string;
  provider?: string;
  title?: string;
}

/**
 * Current topic info.
 */
export interface TopicIdentityInfo {
  id: string;
  title?: string;
}

/**
 * Agent identity context payload.
 */
export interface AgentIdentityContext {
  agent: AgentIdentityInfo;
  topic?: TopicIdentityInfo;
}

export interface AgentIdentityContextInjectorConfig {
  context?: AgentIdentityContext;
  enabled?: boolean;
}

/**
 * Format identity context as XML for injection.
 */
const formatIdentityContext = (context: AgentIdentityContext): string => {
  const { agent, topic } = context;

  const agentFields: string[] = [`  <id>${escapeXml(agent.id)}</id>`];
  if (agent.title) agentFields.push(`  <title>${escapeXml(agent.title)}</title>`);
  if (agent.description)
    agentFields.push(`  <description>${escapeXml(agent.description)}</description>`);
  if (agent.model) {
    const providerAttr = agent.provider ? ` provider="${escapeXml(agent.provider)}"` : '';
    agentFields.push(`  <model${providerAttr}>${escapeXml(agent.model)}</model>`);
  }

  const parts: string[] = [`<agent>\n${agentFields.join('\n')}\n</agent>`];

  if (topic) {
    const topicFields: string[] = [`  <id>${escapeXml(topic.id)}</id>`];
    if (topic.title) topicFields.push(`  <title>${escapeXml(topic.title)}</title>`);
    parts.push(`<current_topic>\n${topicFields.join('\n')}\n</current_topic>`);
  }

  return `<current_agent_identity>
<instruction>You are operating as the agent described below on the LobeHub platform. When invoking tools that act on platform resources (e.g. the \`lh\` CLI), use these IDs directly as your own identity and current working context — do NOT search for yourself first.</instruction>
${parts.join('\n')}
</current_agent_identity>`;
};

/**
 * Agent Identity Context Injector
 *
 * Injects the current agent's identity (id / title / description / model)
 * and the current topic info before the first user message. Caller decides
 * when to enable this — typically when the LobeHub builtin skill (or any
 * other tool that operates on platform resources) is mounted on the agent.
 */
export class AgentIdentityContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'AgentIdentityContextInjector';

  constructor(
    private config: AgentIdentityContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    if (!this.config.enabled) {
      log('Agent identity injection not enabled, skipping');
      return null;
    }

    if (!this.config.context?.agent?.id) {
      log('No agent identity context provided, skipping');
      return null;
    }

    const formatted = formatIdentityContext(this.config.context);
    log('Agent identity context prepared for agent: %s', this.config.context.agent.id);
    return formatted;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);
    if (this.config.enabled && this.config.context?.agent?.id) {
      result.metadata.agentIdentityContextInjected = true;
    }
    return result;
  }
}
