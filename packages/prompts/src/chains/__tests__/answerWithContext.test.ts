import { describe, expect, it } from 'vitest';

import { chainAnswerWithContext } from '../answerWithContext';

describe('chainAnswerWithContext', () => {
  it('should generate correct payload with context and knowledge', () => {
    const result = chainAnswerWithContext({
      context: ['Context passage 1', 'Context passage 2'],
      knowledge: ['AI', 'Machine Learning'],
      question: 'What is artificial intelligence?',
    });

    expect(result).toHaveProperty('messages');
    expect(result.messages.length).toBeGreaterThan(0);
    const content = result.messages.map((m) => m.content).join('\n');
    expect(content).toContain('What is artificial intelligence?');
    expect(content).toContain('Context passage 1');
    expect(content).toContain('Context passage 2');
  });

  it('should handle empty context array', () => {
    const result = chainAnswerWithContext({
      context: [],
      knowledge: ['AI'],
      question: 'What is AI?',
    });

    expect(result).toHaveProperty('messages');
    const content = result.messages.map((m) => m.content).join('\n');
    expect(content).toContain('What is AI?');
  });

  it('should filter out empty context strings', () => {
    const result = chainAnswerWithContext({
      context: ['Valid context', '', '  ', 'Another valid context'],
      knowledge: ['Test'],
      question: 'Test question',
    });

    const content = result.messages.map((m) => m.content).join('\n');
    expect(content).toContain('Valid context');
    expect(content).toContain('Another valid context');
  });
});
