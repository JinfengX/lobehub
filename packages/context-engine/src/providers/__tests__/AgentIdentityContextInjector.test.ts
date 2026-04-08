import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { AgentIdentityContextInjector } from '../AgentIdentityContextInjector';

describe('AgentIdentityContextInjector', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  describe('disabled / no context', () => {
    it('should skip when disabled', async () => {
      const injector = new AgentIdentityContextInjector({ enabled: false });
      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]);
      const result = await injector.process(ctx);
      expect(result.messages).toHaveLength(2);
      expect(result.metadata.agentIdentityContextInjected).toBeUndefined();
    });

    it('should skip when no context provided', async () => {
      const injector = new AgentIdentityContextInjector({ enabled: true });
      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]);
      const result = await injector.process(ctx);
      expect(result.messages).toHaveLength(2);
      expect(result.metadata.agentIdentityContextInjected).toBeUndefined();
    });

    it('should skip when agent.id missing', async () => {
      const injector = new AgentIdentityContextInjector({
        enabled: true,
        context: { agent: { id: '' } },
      });
      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]);
      const result = await injector.process(ctx);
      expect(result.messages).toHaveLength(2);
    });
  });

  describe('agent identity injection', () => {
    it('should inject agent identity before the first user message', async () => {
      const injector = new AgentIdentityContextInjector({
        enabled: true,
        context: {
          agent: {
            description: 'A test assistant',
            id: 'agt_123',
            model: 'gpt-4',
            provider: 'openai',
            title: 'Test Agent',
          },
          topic: { id: 'tpc_456', title: 'Hello topic' },
        },
      });

      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]);
      const result = await injector.process(ctx);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe('system');
      // Injected context before user message
      expect(result.messages[1].role).toBe('user');
      const injected = result.messages[1].content as string;
      expect(injected).toContain('<current_agent_identity>');
      expect(injected).toContain('<id>agt_123</id>');
      expect(injected).toContain('<title>Test Agent</title>');
      expect(injected).toContain('<description>A test assistant</description>');
      expect(injected).toContain('provider="openai"');
      expect(injected).toContain('gpt-4');
      // systemRole is intentionally NOT included — it's already in the system message
      expect(injected).not.toContain('<systemRole');
      expect(injected).toContain('<current_topic>');
      expect(injected).toContain('<id>tpc_456</id>');
      expect(injected).toContain('<title>Hello topic</title>');
      // Original user message
      expect(result.messages[2].content).toBe('hi');
      expect(result.metadata.agentIdentityContextInjected).toBe(true);
    });

    it('should inject without topic when topic is missing', async () => {
      const injector = new AgentIdentityContextInjector({
        enabled: true,
        context: {
          agent: { id: 'agt_only', title: 'Solo' },
        },
      });
      const ctx = createContext([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ]);
      const result = await injector.process(ctx);

      expect(result.messages).toHaveLength(3);
      const injected = result.messages[1].content as string;
      expect(injected).toContain('<id>agt_only</id>');
      expect(injected).toContain('<title>Solo</title>');
      expect(injected).not.toContain('<current_topic>');
    });

    it('should escape XML-unsafe characters', async () => {
      const injector = new AgentIdentityContextInjector({
        enabled: true,
        context: {
          agent: {
            description: 'a < b & c > d',
            id: 'agt_<xss>',
            title: 'Mr. "Quotes"',
          },
        },
      });
      const ctx = createContext([{ role: 'user', content: 'hi' }]);
      const result = await injector.process(ctx);

      const injected = result.messages[0].content as string;
      expect(injected).toContain('agt_&lt;xss&gt;');
      expect(injected).toContain('a &lt; b &amp; c &gt; d');
      expect(injected).not.toContain('<xss>');
    });
  });

  describe('coexistence with other system-injection providers', () => {
    it('should append to existing system injection message instead of creating a new one', async () => {
      const injector = new AgentIdentityContextInjector({
        enabled: true,
        context: { agent: { id: 'agt_1', title: 'A' } },
      });

      // Simulate a prior provider having already created a system injection message
      const ctx = createContext([
        { role: 'system', content: 'sys' },
        {
          content: '<previous_injection>previous</previous_injection>',
          meta: { systemInjection: true },
          role: 'user',
        },
        { role: 'user', content: 'hi' },
      ]);
      const result = await injector.process(ctx);

      // No new message added — appended into the existing systemInjection message
      expect(result.messages).toHaveLength(3);
      const merged = result.messages[1].content as string;
      expect(merged).toContain('previous_injection');
      expect(merged).toContain('<current_agent_identity>');
      expect(merged).toContain('agt_1');
    });
  });
});
