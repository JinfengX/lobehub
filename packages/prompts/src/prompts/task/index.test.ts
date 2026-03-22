import { describe, expect, it } from 'vitest';

import { buildTaskRunPrompt } from './index';

// Fixed reference time for stable timeAgo output
const NOW = new Date('2026-03-22T12:00:00Z');

describe('buildTaskRunPrompt', () => {
  it('should build prompt with only task instruction', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          identifier: 'TASK-1',
          instruction: '帮我写一本 AI Agent 技术书籍',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
  });

  it('should build prompt with task description + instruction', () => {
    const result = buildTaskRunPrompt(
      {
        task: {
          description: '面向开发者的技术书籍',
          identifier: 'TASK-1',
          instruction: '帮我写一本 AI Agent 技术书籍，目标 8 章',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
  });

  it('should prioritize user feedback at the top', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [
            { content: '第2章改为先上手再讲原理', createdAt: '2026-03-22T10:00:00Z' },
            { content: '增加评测章节', createdAt: '2026-03-22T10:30:00Z' },
          ],
        },
        task: {
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    // Verify feedback comes before task
    const feedbackIdx = result.indexOf('<user_feedback>');
    const taskIdx = result.indexOf('<task');
    expect(feedbackIdx).toBeLessThan(taskIdx);
  });

  it('should include agent comments with author label and time', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [
            {
              agentId: 'agt_xxx',
              content: '大纲已完成，请确认',
              createdAt: '2026-03-22T09:00:00Z',
            },
            { content: '确认，开始写', createdAt: '2026-03-22T10:00:00Z' },
          ],
        },
        task: {
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('role="agent"');
    expect(result).toContain('role="user"');
    expect(result).toContain('3h ago');
    expect(result).toContain('2h ago');
  });

  it('should place high_priority_instruction first, then feedback', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [{ content: '用户反馈', createdAt: '2026-03-22T11:00:00Z' }],
        },
        extraPrompt: '这次重点关注第3章',
        task: {
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    const feedbackIdx = result.indexOf('<user_feedback>');
    const extraIdx = result.indexOf('<high_priority_instruction>');
    const taskIdx = result.indexOf('<task');
    expect(extraIdx).toBeLessThan(feedbackIdx);
    expect(feedbackIdx).toBeLessThan(taskIdx);
  });

  it('should include activity history with topics and briefs in CLI style', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          briefs: [
            {
              createdAt: '2026-03-21T17:05:00Z',
              id: 'brief_abc123',
              priority: 'urgent',
              resolvedAction: 'approve',
              resolvedAt: '2026-03-21T17:30:00Z',
              summary: '8章大纲已制定完成',
              title: '大纲完成',
              type: 'decision',
            },
            {
              createdAt: '2026-03-21T18:00:00Z',
              id: 'brief_def456',
              priority: 'normal',
              resolvedAt: null,
              summary: '第4章内容过多，建议拆分',
              title: '建议拆分第4章',
              type: 'decision',
            },
          ],
          topics: [
            {
              createdAt: '2026-03-21T17:00:00Z',
              id: 'tpc_aaa',
              metadata: { handoff: { summary: '完成了大纲制定' } },
              seq: 1,
              status: 'completed',
              title: '制定大纲',
            },
            {
              createdAt: '2026-03-21T17:31:00Z',
              id: 'tpc_bbb',
              metadata: { handoff: { summary: '修订了大纲并拆分子任务' } },
              seq: 2,
              status: 'completed',
              title: '修订大纲',
            },
          ],
        },
        task: {
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    // Verify timeline is sorted reverse-chronologically (newest first)
    // Data: topic1(17:00), brief1(17:05), topic2(17:31), brief2(18:00)
    // Descending: brief2 > topic2 > brief1 > topic1
    const history = result.split('<activities>')[1]?.split('</activities>')[0] || '';
    const brief2Idx = history.indexOf('id="brief_def456"');
    const topic2Idx = history.indexOf('seq="2"');
    const topic1Idx = history.indexOf('seq="1"');
    expect(brief2Idx).toBeLessThan(topic2Idx);
    expect(topic2Idx).toBeLessThan(topic1Idx);
  });

  it('should show resolved action and comment on briefs', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          briefs: [
            {
              createdAt: '2026-03-21T17:00:00Z',
              resolvedAction: 'feedback',
              resolvedAt: '2026-03-21T18:00:00Z',
              resolvedComment: '第2章需要更多实例',
              summary: '第2章初稿完成',
              title: '第2章完成',
              type: 'result',
            },
          ],
        },
        task: {
          identifier: 'TASK-2',
          instruction: '写第2章',
          name: '第2章',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('feedback: 第2章需要更多实例');
  });

  it('should handle full scenario with all sections', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          briefs: [
            {
              createdAt: '2026-03-21T17:05:00Z',
              id: 'brief_001',
              resolvedAction: 'approve',
              resolvedAt: '2026-03-21T17:30:00Z',
              summary: '大纲已完成',
              title: '大纲完成',
              type: 'decision',
            },
          ],
          comments: [
            { content: '第5章后移，增加评测章节', createdAt: '2026-03-22T09:00:00Z' },
            { agentId: 'agt_inbox', content: '已调整大纲', createdAt: '2026-03-22T09:05:00Z' },
          ],
          topics: [
            {
              createdAt: '2026-03-21T17:00:00Z',
              id: 'tpc_001',
              metadata: { handoff: { summary: '完成大纲' } },
              seq: 1,
              status: 'completed',
              title: '制定大纲',
            },
          ],
        },
        extraPrompt: '这次直接开始写第1章',
        task: {
          description: '面向开发者的 AI Agent 技术书籍',
          identifier: 'TASK-1',
          instruction: '写一本 AI Agent 书，目标 8 章',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();

    // Verify order: instruction → feedback → activities → task
    const tags = ['<high_priority_instruction>', '<user_feedback>', '<activities>', '<task'];
    let lastIdx = -1;
    for (const tag of tags) {
      const idx = result.indexOf(tag);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('should handle empty activities gracefully', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          briefs: [],
          comments: [],
          topics: [],
        },
        task: {
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).not.toContain('<user_feedback>');
    expect(result).not.toContain('<activities>');
  });

  it('should include subtasks in activities', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          subtasks: [
            {
              createdAt: '2026-03-21T18:00:00Z',
              id: 'task_aaa',
              identifier: 'TASK-2',
              name: '第1章 Agent 概述',
              status: 'backlog',
            },
            {
              createdAt: '2026-03-21T18:01:00Z',
              id: 'task_bbb',
              identifier: 'TASK-3',
              name: '第2章 快速上手',
              status: 'running',
            },
          ],
        },
        task: {
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    expect(result).toContain('<subtask');
    expect(result).toContain('identifier="TASK-2"');
    expect(result).toContain('identifier="TASK-3"');
  });

  it('should truncate comments to 50 chars in activities but keep full in user_feedback', () => {
    const longContent = 'A'.repeat(60) + ' — this part should be truncated in activities';
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [{ content: longContent, createdAt: '2026-03-22T11:00:00Z' }],
        },
        task: {
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    // user_feedback should have full content
    const feedbackSection = result.split('<user_feedback>')[1]?.split('</user_feedback>')[0] || '';
    expect(feedbackSection).toContain(longContent);
    // activities comment should be truncated
    const activitiesSection = result.split('<activities>')[1]?.split('</activities>')[0] || '';
    expect(activitiesSection).toContain('...');
    expect(activitiesSection).not.toContain(longContent);
  });

  it('should only include user comments in user_feedback, not agent comments', () => {
    const result = buildTaskRunPrompt(
      {
        activities: {
          comments: [
            { content: '用户反馈', createdAt: '2026-03-22T10:00:00Z' },
            { agentId: 'agt_xxx', content: 'Agent 回复', createdAt: '2026-03-22T10:05:00Z' },
          ],
        },
        task: {
          identifier: 'TASK-1',
          instruction: '写书',
          name: '写一本书',
        },
      },
      NOW,
    );

    expect(result).toMatchSnapshot();
    const feedbackSection = result.split('<user_feedback>')[1]?.split('</user_feedback>')[0] || '';
    expect(feedbackSection).toContain('用户反馈');
    expect(feedbackSection).not.toContain('Agent 回复');
    // But activities should have both
    const activitiesSection = result.split('<activities>')[1]?.split('</activities>')[0] || '';
    expect(activitiesSection).toContain('role="user"');
    expect(activitiesSection).toContain('role="agent"');
  });
});
