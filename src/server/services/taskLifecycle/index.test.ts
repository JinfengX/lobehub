// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskLifecycleService } from './index';

// Hoist mock functions
const {
  mockBriefModelCreate,
  mockBriefModelFindByTaskId,
  mockChainTaskTopicHandoff,
  mockInitModelRuntimeFromDB,
  mockSystemAgentServiceGetTaskModelConfig,
  mockTaskModelFindById,
  mockTaskModelGetReviewConfig,
  mockTaskModelShouldPauseOnTopicComplete,
  mockTaskModelUpdateHeartbeat,
  mockTaskModelUpdateStatus,
  mockTaskReviewServiceReview,
  mockTaskTopicModelFindByTaskId,
  mockTaskTopicModelUpdateHandoff,
  mockTaskTopicModelUpdateReview,
  mockTaskTopicModelUpdateStatus,
  mockTopicModelUpdate,
} = vi.hoisted(() => ({
  mockBriefModelCreate: vi.fn(),
  mockBriefModelFindByTaskId: vi.fn(),
  mockChainTaskTopicHandoff: vi.fn(),
  mockInitModelRuntimeFromDB: vi.fn(),
  mockSystemAgentServiceGetTaskModelConfig: vi.fn(),
  mockTaskModelFindById: vi.fn(),
  mockTaskModelGetReviewConfig: vi.fn(),
  mockTaskModelShouldPauseOnTopicComplete: vi.fn(),
  mockTaskModelUpdateHeartbeat: vi.fn(),
  mockTaskModelUpdateStatus: vi.fn(),
  mockTaskReviewServiceReview: vi.fn(),
  mockTaskTopicModelFindByTaskId: vi.fn(),
  mockTaskTopicModelUpdateHandoff: vi.fn(),
  mockTaskTopicModelUpdateReview: vi.fn(),
  mockTaskTopicModelUpdateStatus: vi.fn(),
  mockTopicModelUpdate: vi.fn(),
}));

vi.mock('@lobechat/prompts', () => ({
  chainTaskTopicHandoff: mockChainTaskTopicHandoff,
  TASK_TOPIC_HANDOFF_SCHEMA: { type: 'object' },
}));

vi.mock('@lobechat/types', () => ({
  DEFAULT_BRIEF_ACTIONS: {
    error: [{ key: 'retry', label: 'Retry', type: 'resolve' }],
  },
}));

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

vi.mock('@/database/models/brief', () => ({
  BriefModel: vi.fn(() => ({
    create: mockBriefModelCreate,
    findByTaskId: mockBriefModelFindByTaskId,
  })),
}));

vi.mock('@/database/models/task', () => ({
  TaskModel: vi.fn(() => ({
    findById: mockTaskModelFindById,
    getReviewConfig: mockTaskModelGetReviewConfig,
    shouldPauseOnTopicComplete: mockTaskModelShouldPauseOnTopicComplete,
    updateHeartbeat: mockTaskModelUpdateHeartbeat,
    updateStatus: mockTaskModelUpdateStatus,
  })),
}));

vi.mock('@/database/models/taskTopic', () => ({
  TaskTopicModel: vi.fn(() => ({
    findByTaskId: mockTaskTopicModelFindByTaskId,
    updateHandoff: mockTaskTopicModelUpdateHandoff,
    updateReview: mockTaskTopicModelUpdateReview,
    updateStatus: mockTaskTopicModelUpdateStatus,
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(() => ({
    update: mockTopicModelUpdate,
  })),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mockInitModelRuntimeFromDB,
}));

vi.mock('@/server/services/systemAgent', () => ({
  SystemAgentService: vi.fn(() => ({
    getTaskModelConfig: mockSystemAgentServiceGetTaskModelConfig,
  })),
}));

vi.mock('@/server/services/taskReview', () => ({
  TaskReviewService: vi.fn(() => ({
    review: mockTaskReviewServiceReview,
  })),
}));

describe('TaskLifecycleService', () => {
  const mockDb = {} as any;
  const userId = 'user-123';
  let service: TaskLifecycleService;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  const baseParams = {
    operationId: 'op-1',
    reason: 'done',
    taskId: 'task-123',
    taskIdentifier: 'task-abc',
    topicId: 'topic-456',
    lastAssistantContent: 'Task completed successfully',
  };

  const mockTask = {
    id: 'task-123',
    instruction: 'Do something',
    name: 'My Task',
    totalTopics: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    service = new TaskLifecycleService(mockDb, userId);

    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Default mocks
    mockTaskModelUpdateHeartbeat.mockResolvedValue(undefined);
    mockTaskModelFindById.mockResolvedValue(mockTask);
    mockTaskTopicModelUpdateStatus.mockResolvedValue(undefined);
    mockTaskModelGetReviewConfig.mockReturnValue(null);
    mockTaskModelShouldPauseOnTopicComplete.mockReturnValue(false);
    mockBriefModelFindByTaskId.mockResolvedValue([]);
    mockTaskModelUpdateStatus.mockResolvedValue(undefined);
    mockBriefModelCreate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('onTopicComplete', () => {
    describe('reason: done', () => {
      it('should update heartbeat on every call', async () => {
        await service.onTopicComplete(baseParams);

        expect(mockTaskModelUpdateHeartbeat).toHaveBeenCalledWith('task-123');
      });

      it('should fetch the current task', async () => {
        await service.onTopicComplete(baseParams);

        expect(mockTaskModelFindById).toHaveBeenCalledWith('task-123');
      });

      it('should update topic status to completed when topicId is provided', async () => {
        await service.onTopicComplete(baseParams);

        expect(mockTaskTopicModelUpdateStatus).toHaveBeenCalledWith(
          'task-123',
          'topic-456',
          'completed',
        );
      });

      it('should not update topic status when topicId is not provided', async () => {
        const params = { ...baseParams, topicId: undefined };

        await service.onTopicComplete(params);

        expect(mockTaskTopicModelUpdateStatus).not.toHaveBeenCalled();
      });

      it('should pause task when shouldPauseOnTopicComplete returns true', async () => {
        mockTaskModelShouldPauseOnTopicComplete.mockReturnValue(true);

        await service.onTopicComplete(baseParams);

        expect(mockTaskModelUpdateStatus).toHaveBeenCalledWith('task-123', 'paused', {
          error: null,
        });
      });

      it('should not pause task when shouldPauseOnTopicComplete returns false', async () => {
        mockTaskModelShouldPauseOnTopicComplete.mockReturnValue(false);

        await service.onTopicComplete(baseParams);

        expect(mockTaskModelUpdateStatus).not.toHaveBeenCalled();
      });

      it('should auto-complete task when latest brief type is result and no review configured', async () => {
        mockTaskModelGetReviewConfig.mockReturnValue(null);
        mockBriefModelFindByTaskId.mockResolvedValue([{ id: 'brief-1', type: 'result' }]);

        await service.onTopicComplete(baseParams);

        expect(mockTaskModelUpdateStatus).toHaveBeenCalledWith('task-123', 'completed', {
          error: null,
        });
      });

      it('should not auto-complete when review is enabled even if latest brief is result', async () => {
        mockTaskModelGetReviewConfig.mockReturnValue({ enabled: true, rubrics: [] });
        mockBriefModelFindByTaskId.mockResolvedValue([{ id: 'brief-1', type: 'result' }]);

        await service.onTopicComplete(baseParams);

        expect(mockTaskModelUpdateStatus).not.toHaveBeenCalledWith(
          'task-123',
          'completed',
          expect.anything(),
        );
      });

      it('should not auto-complete when brief type is not result', async () => {
        mockTaskModelGetReviewConfig.mockReturnValue(null);
        mockBriefModelFindByTaskId.mockResolvedValue([{ id: 'brief-1', type: 'insight' }]);

        await service.onTopicComplete(baseParams);

        expect(mockTaskModelUpdateStatus).not.toHaveBeenCalledWith(
          'task-123',
          'completed',
          expect.anything(),
        );
      });

      it('should not auto-complete when no briefs exist', async () => {
        mockTaskModelGetReviewConfig.mockReturnValue(null);
        mockBriefModelFindByTaskId.mockResolvedValue([]);

        await service.onTopicComplete(baseParams);

        expect(mockTaskModelUpdateStatus).not.toHaveBeenCalledWith(
          'task-123',
          'completed',
          expect.anything(),
        );
      });

      it('should not generate handoff when lastAssistantContent is not provided', async () => {
        mockSystemAgentServiceGetTaskModelConfig.mockResolvedValue({
          model: 'gpt-4',
          provider: 'openai',
        });
        mockChainTaskTopicHandoff.mockReturnValue({ messages: [] });
        mockInitModelRuntimeFromDB.mockResolvedValue({ generateObject: vi.fn() });

        const params = { ...baseParams, lastAssistantContent: undefined };

        await service.onTopicComplete(params);

        expect(mockSystemAgentServiceGetTaskModelConfig).not.toHaveBeenCalled();
      });

      it('should not generate handoff when topicId is not provided', async () => {
        mockSystemAgentServiceGetTaskModelConfig.mockResolvedValue({
          model: 'gpt-4',
          provider: 'openai',
        });

        const params = { ...baseParams, topicId: undefined };

        await service.onTopicComplete(params);

        expect(mockSystemAgentServiceGetTaskModelConfig).not.toHaveBeenCalled();
      });

      describe('handoff generation', () => {
        const mockModelRuntime = {
          generateObject: vi.fn(),
        };

        beforeEach(() => {
          mockSystemAgentServiceGetTaskModelConfig.mockResolvedValue({
            model: 'gpt-4',
            provider: 'openai',
          });
          mockChainTaskTopicHandoff.mockReturnValue({ messages: [{ content: 'test' }] });
          mockInitModelRuntimeFromDB.mockResolvedValue(mockModelRuntime);
          mockModelRuntime.generateObject.mockResolvedValue({
            keyFindings: ['finding 1'],
            nextAction: 'Continue',
            summary: 'Work done',
            title: 'Generated Title',
          });
          mockTopicModelUpdate.mockResolvedValue(undefined);
          mockTaskTopicModelUpdateHandoff.mockResolvedValue(undefined);
        });

        it('should generate handoff and update topic title', async () => {
          await service.onTopicComplete(baseParams);

          expect(mockTopicModelUpdate).toHaveBeenCalledWith('topic-456', {
            title: 'Generated Title',
          });
          expect(mockTaskTopicModelUpdateHandoff).toHaveBeenCalledWith('task-123', 'topic-456', {
            keyFindings: ['finding 1'],
            nextAction: 'Continue',
            summary: 'Work done',
            title: 'Generated Title',
          });
        });

        it('should not update topic title when handoff has no title', async () => {
          mockModelRuntime.generateObject.mockResolvedValue({
            summary: 'Work done',
          });

          await service.onTopicComplete(baseParams);

          expect(mockTopicModelUpdate).not.toHaveBeenCalled();
          expect(mockTaskTopicModelUpdateHandoff).toHaveBeenCalled();
        });

        it('should call chainTaskTopicHandoff with correct params', async () => {
          await service.onTopicComplete(baseParams);

          expect(mockChainTaskTopicHandoff).toHaveBeenCalledWith({
            lastAssistantContent: 'Task completed successfully',
            taskInstruction: 'Do something',
            taskName: 'My Task',
          });
        });

        it('should warn and continue when handoff generation fails', async () => {
          mockInitModelRuntimeFromDB.mockRejectedValue(new Error('LLM error'));

          await expect(service.onTopicComplete(baseParams)).resolves.not.toThrow();

          expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[TaskLifecycle] handoff generation failed:',
            expect.any(Error),
          );
        });
      });

      describe('auto-review', () => {
        beforeEach(() => {
          mockSystemAgentServiceGetTaskModelConfig.mockResolvedValue({
            model: 'gpt-4',
            provider: 'openai',
          });
          mockChainTaskTopicHandoff.mockReturnValue({ messages: [] });
          mockInitModelRuntimeFromDB.mockResolvedValue({ generateObject: vi.fn() });
          mockTopicModelUpdate.mockResolvedValue(undefined);
          mockTaskTopicModelUpdateHandoff.mockResolvedValue(undefined);
        });

        it('should skip review when review config is not enabled', async () => {
          mockTaskModelGetReviewConfig.mockReturnValue({ enabled: false, rubrics: [] });

          await service.onTopicComplete(baseParams);

          expect(mockTaskReviewServiceReview).not.toHaveBeenCalled();
        });

        it('should skip review when rubrics are empty', async () => {
          mockTaskModelGetReviewConfig.mockReturnValue({ enabled: true, rubrics: [] });

          await service.onTopicComplete(baseParams);

          expect(mockTaskReviewServiceReview).not.toHaveBeenCalled();
        });

        it('should run review when configured', async () => {
          const rubrics = [{ id: 'r1', criteria: 'Test quality' }];
          mockTaskModelGetReviewConfig.mockReturnValue({
            autoRetry: false,
            enabled: true,
            judge: { model: 'gpt-4', provider: 'openai' },
            maxIterations: 3,
            rubrics,
          });
          mockTaskTopicModelFindByTaskId.mockResolvedValue([
            { topicId: 'topic-456', reviewIteration: 0 },
          ]);
          mockTaskReviewServiceReview.mockResolvedValue({
            iteration: 1,
            overallScore: 85,
            passed: true,
            rubricResults: [],
            suggestions: [],
          });
          mockTaskTopicModelUpdateReview.mockResolvedValue(undefined);

          await service.onTopicComplete(baseParams);

          expect(mockTaskReviewServiceReview).toHaveBeenCalledWith({
            content: 'Task completed successfully',
            iteration: 1,
            judge: { model: 'gpt-4', provider: 'openai' },
            rubrics,
            taskName: 'My Task',
          });
        });

        it('should create result brief when review passes', async () => {
          const rubrics = [{ id: 'r1', criteria: 'Test quality' }];
          mockTaskModelGetReviewConfig.mockReturnValue({
            autoRetry: false,
            enabled: true,
            judge: {},
            maxIterations: 3,
            rubrics,
          });
          mockTaskTopicModelFindByTaskId.mockResolvedValue([
            { topicId: 'topic-456', reviewIteration: 1 },
          ]);
          mockTaskReviewServiceReview.mockResolvedValue({
            iteration: 2,
            overallScore: 90,
            passed: true,
            rubricResults: [],
            suggestions: [],
          });
          mockTaskTopicModelUpdateReview.mockResolvedValue(undefined);

          await service.onTopicComplete(baseParams);

          expect(mockBriefModelCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              taskId: 'task-123',
              type: 'result',
              priority: 'info',
            }),
          );
        });

        it('should pause and create insight brief when review fails with autoRetry and within maxIterations', async () => {
          const rubrics = [{ id: 'r1', criteria: 'Test quality' }];
          mockTaskModelGetReviewConfig.mockReturnValue({
            autoRetry: true,
            enabled: true,
            judge: {},
            maxIterations: 3,
            rubrics,
          });
          mockTaskTopicModelFindByTaskId.mockResolvedValue([
            { topicId: 'topic-456', reviewIteration: 0 },
          ]);
          mockTaskReviewServiceReview.mockResolvedValue({
            iteration: 1,
            overallScore: 40,
            passed: false,
            rubricResults: [],
            suggestions: [],
          });
          mockTaskTopicModelUpdateReview.mockResolvedValue(undefined);

          await service.onTopicComplete(baseParams);

          expect(mockBriefModelCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              taskId: 'task-123',
              type: 'insight',
              priority: 'normal',
            }),
          );
          expect(mockTaskModelUpdateStatus).toHaveBeenCalledWith('task-123', 'paused', {
            error: null,
          });
        });

        it('should create decision brief when max iterations reached', async () => {
          const rubrics = [{ id: 'r1', criteria: 'Test quality' }];
          mockTaskModelGetReviewConfig.mockReturnValue({
            autoRetry: false,
            enabled: true,
            judge: {},
            maxIterations: 3,
            rubrics,
          });
          mockTaskTopicModelFindByTaskId.mockResolvedValue([
            { topicId: 'topic-456', reviewIteration: 2 },
          ]);
          mockTaskReviewServiceReview.mockResolvedValue({
            iteration: 3,
            overallScore: 50,
            passed: false,
            rubricResults: [],
            suggestions: ['Improve X', 'Fix Y'],
          });
          mockTaskTopicModelUpdateReview.mockResolvedValue(undefined);

          await service.onTopicComplete(baseParams);

          expect(mockBriefModelCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              taskId: 'task-123',
              type: 'decision',
              priority: 'urgent',
            }),
          );
        });

        it('should warn and continue when review fails with exception', async () => {
          const rubrics = [{ id: 'r1', criteria: 'Test quality' }];
          mockTaskModelGetReviewConfig.mockReturnValue({
            autoRetry: false,
            enabled: true,
            judge: {},
            maxIterations: 3,
            rubrics,
          });
          mockTaskTopicModelFindByTaskId.mockResolvedValue([
            { topicId: 'topic-456', reviewIteration: 0 },
          ]);
          mockTaskReviewServiceReview.mockRejectedValue(new Error('Review service down'));

          await expect(service.onTopicComplete(baseParams)).resolves.not.toThrow();

          expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[TaskLifecycle] auto-review failed:',
            expect.any(Error),
          );
        });

        it('should use iteration 1 when topic has no prior review iteration', async () => {
          const rubrics = [{ id: 'r1', criteria: 'Test quality' }];
          mockTaskModelGetReviewConfig.mockReturnValue({
            autoRetry: false,
            enabled: true,
            judge: {},
            maxIterations: 3,
            rubrics,
          });
          // Topic not found in the list
          mockTaskTopicModelFindByTaskId.mockResolvedValue([]);
          mockTaskReviewServiceReview.mockResolvedValue({
            iteration: 1,
            overallScore: 80,
            passed: true,
            rubricResults: [],
            suggestions: [],
          });
          mockTaskTopicModelUpdateReview.mockResolvedValue(undefined);

          await service.onTopicComplete(baseParams);

          expect(mockTaskReviewServiceReview).toHaveBeenCalledWith(
            expect.objectContaining({ iteration: 1 }),
          );
        });
      });
    });

    describe('reason: error', () => {
      const errorParams = {
        ...baseParams,
        errorMessage: 'Something went wrong',
        reason: 'error',
      };

      it('should update topic status to failed', async () => {
        await service.onTopicComplete(errorParams);

        expect(mockTaskTopicModelUpdateStatus).toHaveBeenCalledWith(
          'task-123',
          'topic-456',
          'failed',
        );
      });

      it('should not update topic status when topicId is not provided', async () => {
        const params = { ...errorParams, topicId: undefined };

        await service.onTopicComplete(params);

        expect(mockTaskTopicModelUpdateStatus).not.toHaveBeenCalled();
      });

      it('should create an error brief with error message', async () => {
        await service.onTopicComplete(errorParams);

        expect(mockBriefModelCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: 'task-123',
            type: 'error',
            priority: 'urgent',
            summary: 'Execution failed: Something went wrong',
          }),
        );
      });

      it('should use "Unknown error" when no errorMessage provided', async () => {
        const params = { ...errorParams, errorMessage: undefined };

        await service.onTopicComplete(params);

        expect(mockBriefModelCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            summary: 'Execution failed: Unknown error',
          }),
        );
      });

      it('should pause the task after error', async () => {
        await service.onTopicComplete(errorParams);

        expect(mockTaskModelUpdateStatus).toHaveBeenCalledWith('task-123', 'paused');
      });

      it('should include topic reference in brief title when topicId is given', async () => {
        await service.onTopicComplete(errorParams);

        expect(mockBriefModelCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringContaining('topic-456'),
          }),
        );
      });

      it('should use ? for topicSeq when task has no totalTopics', async () => {
        mockTaskModelFindById.mockResolvedValue({ id: 'task-123', name: 'test' });

        await service.onTopicComplete(errorParams);

        expect(mockBriefModelCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringContaining('?'),
          }),
        );
      });
    });

    describe('reason: other', () => {
      it('should still update heartbeat for unknown reason', async () => {
        const params = { ...baseParams, reason: 'interrupted' };

        await service.onTopicComplete(params);

        expect(mockTaskModelUpdateHeartbeat).toHaveBeenCalledWith('task-123');
      });

      it('should not update topic status for unknown reason', async () => {
        const params = { ...baseParams, reason: 'interrupted' };

        await service.onTopicComplete(params);

        expect(mockTaskTopicModelUpdateStatus).not.toHaveBeenCalled();
      });
    });
  });
});
