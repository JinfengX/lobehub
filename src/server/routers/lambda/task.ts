import { BriefIdentifier } from '@lobechat/builtin-tool-brief';
import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import {
  buildTaskRunPrompt,
  chainTaskTopicHandoff,
  TASK_TOPIC_HANDOFF_SCHEMA,
} from '@lobechat/prompts';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AiAgentService } from '@/server/services/aiAgent';
import { SystemAgentService } from '@/server/services/systemAgent';
import { TaskReviewService } from '@/server/services/taskReview';

const taskProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      briefModel: new BriefModel(ctx.serverDB, ctx.userId),
      systemAgentService: new SystemAgentService(ctx.serverDB, ctx.userId),
      taskModel: new TaskModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

// All procedures that take an id accept either raw id (task_xxx) or identifier (TASK-1)
// Resolution happens in the model layer via model.resolve()
const idInput = z.object({ id: z.string() });

// Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
const createSchema = z.object({
  assigneeAgentId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  description: z.string().optional(),
  identifierPrefix: z.string().optional(),
  instruction: z.string().min(1),
  name: z.string().optional(),
  parentTaskId: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
});

const updateSchema = z.object({
  assigneeAgentId: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  description: z.string().optional(),
  heartbeatInterval: z.number().min(1).optional(),
  heartbeatTimeout: z.number().min(1).nullable().optional(),
  instruction: z.string().optional(),
  name: z.string().optional(),
  priority: z.number().min(0).max(4).optional(),
});

const listSchema = z.object({
  assigneeAgentId: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  parentTaskId: z.string().nullable().optional(),
  status: z.string().optional(),
});

// Helper: build task prompt with handoff context from previous topics
async function buildTaskPrompt(
  task: Awaited<ReturnType<TaskModel['findById']>> & {},
  db: any,
  userId: string,
  extraPrompt?: string,
): Promise<string> {
  const taskModel = new TaskModel(db, userId);
  const briefModel = new BriefModel(db, userId);

  const [topics, briefs, comments, subtasks] = await Promise.all([
    task.totalTopics && task.totalTopics > 0
      ? taskModel.getTopicsWithHandoff(task.id).catch(() => [])
      : Promise.resolve([]),
    briefModel.findByTaskId(task.id).catch(() => []),
    taskModel.getComments(task.id).catch(() => []),
    taskModel.findSubtasks(task.id).catch(() => []),
  ]);

  return buildTaskRunPrompt({
    activities: {
      briefs: briefs.map((b: any) => ({
        createdAt: b.createdAt,
        id: b.id,
        priority: b.priority,
        resolvedAction: b.resolvedAction,
        resolvedAt: b.resolvedAt,
        resolvedComment: b.resolvedComment,
        summary: b.summary,
        title: b.title,
        type: b.type,
      })),
      comments: comments.map((c: any) => ({
        agentId: c.agentId,
        content: c.content,
        createdAt: c.createdAt,
        id: c.id,
      })),
      subtasks: subtasks.map((s: any) => ({
        createdAt: s.createdAt,
        id: s.id,
        identifier: s.identifier,
        name: s.name,
        status: s.status,
      })),
      topics: (topics as any[]).map((t) => ({
        createdAt: t.createdAt,
        id: t.id,
        metadata: t.metadata,
        seq: t.seq,
        status: t.status,
        title: t.title,
      })),
    },
    extraPrompt,
    task: {
      description: task.description,
      identifier: task.identifier,
      instruction: task.instruction,
      name: task.name,
    },
  });
}

// Helper: resolve id/identifier and throw if not found
async function resolveOrThrow(model: TaskModel, id: string) {
  const task = await model.resolve(id);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  return task;
}

export const taskRouter = router({
  addComment: taskProcedure
    .input(
      z.object({
        briefId: z.string().optional(),
        content: z.string().min(1),
        id: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);
        const comment = await model.addComment({
          briefId: input.briefId,
          content: input.content,
          taskId: task.id,
          topicId: input.topicId,
          userId: ctx.userId,
        });
        return { data: comment, message: 'Comment added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add comment',
        });
      }
    }),

  addDependency: taskProcedure
    .input(
      z.object({
        dependsOnId: z.string(),
        taskId: z.string(),
        type: z.enum(['blocks', 'relates']).default('blocks'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.addDependency(task.id, dep.id, input.type);
        return { message: 'Dependency added', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add dependency',
        });
      }
    }),

  cancelTopic: taskProcedure
    .input(z.object({ id: z.string(), topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);

        // Find the topic and its operationId
        const topics = await model.getTopics(task.id);
        const target = topics.find((t) => t.topicId === input.topicId);
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found for this task.' });
        }

        if (target.status !== 'running') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Topic is not running (current status: ${target.status}).`,
          });
        }

        // Interrupt the agent operation if operationId exists
        if (target.operationId) {
          const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId);
          await aiAgentService.interruptTask({ operationId: target.operationId });
        }

        // Mark topic as canceled
        await model.updateTopicStatus(task.id, input.topicId, 'canceled');

        // Pause the task
        await model.updateStatus(task.id, 'paused');

        return { message: 'Topic canceled', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:cancelTopic]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to cancel topic',
        });
      }
    }),

  deleteTopic: taskProcedure
    .input(z.object({ id: z.string(), topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);

        // Check topic exists
        const topics = await model.getTopics(task.id);
        const target = topics.find((t) => t.topicId === input.topicId);
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found for this task.' });
        }

        // If running, cancel first
        if (target.status === 'running' && target.operationId) {
          const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId);
          await aiAgentService.interruptTask({ operationId: target.operationId });
        }

        // Remove association from task_topics
        await model.removeTopic(task.id, input.topicId);

        // Delete the topic itself (messages etc.)
        const topicModel = new TopicModel(ctx.serverDB, ctx.userId);
        await topicModel.delete(input.topicId);

        return { message: 'Topic deleted', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:deleteTopic]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete topic',
        });
      }
    }),

  create: taskProcedure.input(createSchema).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;

      // Resolve parentTaskId if it's an identifier
      const createData = { ...input };
      if (createData.parentTaskId) {
        const parent = await resolveOrThrow(model, createData.parentTaskId);
        createData.parentTaskId = parent.id;
      }

      const task = await model.create(createData);
      return { data: task, message: 'Task created', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:create]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create task',
      });
    }
  }),

  clearAll: taskProcedure.mutation(async ({ ctx }) => {
    try {
      const model = ctx.taskModel;
      const count = await model.deleteAll();
      return { count, message: `${count} tasks deleted`, success: true };
    } catch (error) {
      console.error('[task:clearAll]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to clear tasks',
      });
    }
  }),

  delete: taskProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      await model.delete(task.id);
      return { message: 'Task deleted', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:delete]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete task',
      });
    }
  }),

  detail: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      let task = await resolveOrThrow(model, input.id);

      // Auto-detect heartbeat timeout for running tasks
      if (task.status === 'running' && task.heartbeatTimeout && task.lastHeartbeatAt) {
        const elapsed = (Date.now() - new Date(task.lastHeartbeatAt).getTime()) / 1000;
        if (elapsed > task.heartbeatTimeout) {
          // Mark task as paused and running topics as timeout
          await model.updateStatus(task.id, 'paused', { error: 'Heartbeat timeout' });
          await model.timeoutRunningTopics(task.id);
          // Re-fetch updated task
          task = await resolveOrThrow(model, input.id);
        }
      }

      // Clear stale heartbeat timeout error if task is no longer running
      if (task.status !== 'running' && task.error === 'Heartbeat timeout') {
        await model.update(task.id, { error: null });
        task = { ...task, error: null };
      }

      // Parallel fetch all related data
      const briefModel = ctx.briefModel;
      const [subtasks, dependencies, topics, briefs, comments] = await Promise.all([
        model.findSubtasks(task.id),
        model.getDependencies(task.id),
        model.getTopicsWithDetails(task.id),
        briefModel.findByTaskId(task.id),
        model.getComments(task.id),
      ]);

      // Fetch dependencies between subtasks
      const subtaskIds = subtasks.map((s) => s.id);
      const subtaskDeps = await model.getDependenciesByTaskIds(subtaskIds);

      return {
        data: {
          ...task,
          briefs,
          checkpoint: model.getCheckpointConfig(task),
          comments,
          dependencies,
          review: model.getReviewConfig(task),
          subtaskDeps,
          subtasks,
          topics,
        },
        success: true,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:detail]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task detail',
      });
    }
  }),

  find: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      return { data: task, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:find]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to find task',
      });
    }
  }),

  getDependencies: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const deps = await model.getDependencies(task.id);
      return { data: deps, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getDependencies]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get dependencies',
      });
    }
  }),

  getPinnedDocuments: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const docs = await model.getPinnedDocuments(task.id);
      return { data: docs, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getPinnedDocuments]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get documents',
      });
    }
  }),

  getTopics: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const results = await model.getTopicsWithDetails(task.id);
      return { data: results, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTopics]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task topics',
      });
    }
  }),

  getSubtasks: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const subtasks = await model.findSubtasks(task.id);
      return { data: subtasks, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getSubtasks]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get subtasks',
      });
    }
  }),

  getTaskTree: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const tree = await model.getTaskTree(task.id);
      return { data: tree, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getTaskTree]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get task tree',
      });
    }
  }),

  heartbeat: taskProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      await model.updateHeartbeat(task.id);
      return { message: 'Heartbeat updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:heartbeat]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update heartbeat',
      });
    }
  }),

  watchdog: taskProcedure.mutation(async ({ ctx }) => {
    try {
      const stuckTasks = await TaskModel.findStuckTasks(ctx.serverDB);
      const failed: string[] = [];

      for (const task of stuckTasks) {
        const model = new TaskModel(ctx.serverDB, task.createdByUserId);
        await model.updateStatus(task.id, 'failed', {
          completedAt: new Date(),
          error: 'Heartbeat timeout',
        });

        // Create error brief
        const briefModel = new BriefModel(ctx.serverDB, task.createdByUserId);
        await briefModel.create({
          agentId: task.assigneeAgentId || undefined,
          priority: 'urgent',
          summary: `Task has been running without heartbeat update for more than ${task.heartbeatTimeout} seconds.`,
          taskId: task.id,
          title: `${task.identifier} heartbeat timeout`,
          type: 'error',
        });

        failed.push(task.identifier);
      }

      return {
        checked: stuckTasks.length,
        failed,
        message:
          failed.length > 0
            ? `${failed.length} stuck tasks marked as failed`
            : 'No stuck tasks found',
        success: true,
      };
    } catch (error) {
      console.error('[task:watchdog]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Watchdog check failed',
      });
    }
  }),

  list: taskProcedure.input(listSchema).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const result = await model.list(input);
      return { data: result.tasks, success: true, total: result.total };
    } catch (error) {
      console.error('[task:list]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to list tasks',
      });
    }
  }),

  run: taskProcedure
    .input(
      idInput.merge(
        z.object({
          continueTopicId: z.string().optional(),
          prompt: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, prompt: extraPrompt, continueTopicId } = input;
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, id);

        // Ensure task has an assigned agent
        if (!task.assigneeAgentId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Task has no assigned agent. Use --agent when creating or edit the task.',
          });
        }

        // Idempotency: if continuing a topic that's already running, reject
        if (continueTopicId) {
          const existingTopics = await model.getTopics(task.id);
          const target = existingTopics.find((t) => t.topicId === continueTopicId);
          if (target?.status === 'running') {
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Topic ${continueTopicId} is already running.`,
            });
          }
        }

        // Auto-detect and clean up timed-out topics
        if (task.lastHeartbeatAt && task.heartbeatTimeout) {
          const elapsed = (Date.now() - new Date(task.lastHeartbeatAt).getTime()) / 1000;
          if (elapsed > task.heartbeatTimeout) {
            await model.timeoutRunningTopics(task.id);
          }
        }

        // Build prompt with handoff context from previous topics
        const prompt = await buildTaskPrompt(task, ctx.serverDB, ctx.userId, extraPrompt);

        // Update task status to running if not already, clear previous error
        if (task.status !== 'running') {
          await model.updateStatus(task.id, 'running', { error: null, startedAt: new Date() });
        } else if (task.error) {
          await model.update(task.id, { error: null });
        }

        // Call AiAgentService.execAgent
        // assigneeAgentId can be either a raw agentId (agt_xxx) or a slug (inbox)
        const agentRef = task.assigneeAgentId!;
        const isSlug = !agentRef.startsWith('agt_');

        const aiAgentService = new AiAgentService(ctx.serverDB, ctx.userId);
        const taskId = task.id;
        const taskIdentifier = task.identifier;
        const { briefModel, systemAgentService, taskModel: hookTaskModel, topicModel } = ctx;
        const db = ctx.serverDB;
        const userId = ctx.userId;

        // Conditionally inject brief tool based on checkpoint config
        const checkpoint = model.getCheckpointConfig(task);
        const pluginIds = [TaskIdentifier];
        if (checkpoint.onAgentRequest !== false) {
          pluginIds.push(BriefIdentifier);
        }

        const result = await aiAgentService.execAgent({
          ...(isSlug ? { slug: agentRef } : { agentId: agentRef }),
          additionalPluginIds: pluginIds,
          hooks: [
            {
              handler: async (event) => {
                await hookTaskModel.updateHeartbeat(taskId);

                const topicId = event.topicId;

                // Get topic seq for display
                const currentTask = await hookTaskModel.findById(taskId);
                const topicSeq = currentTask?.totalTopics || '?';
                const topicRef = topicId ? ` #${topicSeq} (${topicId})` : '';

                if (event.reason === 'done') {
                  // Update topic status
                  if (topicId) await hookTaskModel.updateTopicStatus(taskId, topicId, 'completed');

                  // Generate handoff summary + topic title via LLM
                  if (topicId && event.lastAssistantContent) {
                    try {
                      const { model, provider } = await (
                        systemAgentService as any
                      ).getTaskModelConfig('topic');

                      const payload = chainTaskTopicHandoff({
                        lastAssistantContent: event.lastAssistantContent,
                        taskInstruction: currentTask?.instruction || '',
                        taskName: currentTask?.name || taskIdentifier,
                      });

                      const modelRuntime = await initModelRuntimeFromDB(db, userId, provider);
                      const result = await modelRuntime.generateObject(
                        {
                          messages: payload.messages as any[],
                          model,
                          schema: TASK_TOPIC_HANDOFF_SCHEMA,
                        },
                        { metadata: { trigger: 'task-handoff' } },
                      );

                      const handoff = result as {
                        keyFindings?: string[];
                        nextAction?: string;
                        summary?: string;
                        title?: string;
                      };

                      if (handoff.title) {
                        await topicModel.update(topicId, { title: handoff.title });
                      }

                      await topicModel.updateMetadata(topicId, {
                        handoff: {
                          keyFindings: handoff.keyFindings,
                          nextAction: handoff.nextAction,
                          summary: handoff.summary,
                        },
                      } as any);
                    } catch (e) {
                      // Handoff generation is non-critical, don't fail the hook
                      console.warn('[task:onComplete] handoff generation failed:', e);
                    }
                  }

                  // Check checkpoint config — pause task for user review
                  if (currentTask && hookTaskModel.shouldPauseOnTopicComplete(currentTask)) {
                    await hookTaskModel.updateStatus(taskId, 'paused', { error: null });
                  }
                } else if (event.reason === 'error') {
                  // Update topic status
                  if (topicId) await hookTaskModel.updateTopicStatus(taskId, topicId, 'failed');

                  await briefModel.create({
                    priority: 'urgent',
                    summary: `Execution failed: ${event.errorMessage || 'Unknown error'}`,
                    taskId,
                    title: `${taskIdentifier} topic${topicRef} error`,
                    type: 'error',
                  });

                  // On error, pause task for user intervention
                  await hookTaskModel.updateStatus(taskId, 'paused');
                }
              },
              id: 'task-on-complete',
              type: 'onComplete' as const,
              webhook: {
                body: { taskId, userId },
                url: '/api/workflows/task/on-topic-complete',
              },
            },
          ],
          prompt,
          taskId: task.id,
          title: extraPrompt ? extraPrompt.slice(0, 100) : task.name || task.identifier,
          trigger: 'task',
          userInterventionConfig: { approvalMode: 'headless' },
          // Continue on existing topic if specified
          ...(continueTopicId && { appContext: { topicId: continueTopicId } }),
        });

        // Update task topic count, current topic, and association
        if (result.topicId) {
          if (continueTopicId) {
            // Continuing existing topic — update status back to running
            await model.updateTopicStatus(task.id, continueTopicId, 'running');
            await model.updateCurrentTopic(task.id, continueTopicId);
          } else {
            // New topic
            await model.incrementTopicCount(task.id);
            await model.updateCurrentTopic(task.id, result.topicId);
            await model.addTopic(task.id, result.topicId, {
              operationId: result.operationId,
              seq: (task.totalTopics || 0) + 1,
            });
          }
        }

        // Update heartbeat
        await model.updateHeartbeat(task.id);

        return {
          ...result,
          taskId: task.id,
          taskIdentifier: task.identifier,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:run]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run task',
        });
      }
    }),

  pinDocument: taskProcedure
    .input(
      z.object({
        documentId: z.string(),
        pinnedBy: z.string().default('user'),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        await model.pinDocument(task.id, input.documentId, input.pinnedBy);
        return { message: 'Document pinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:pinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to pin document',
        });
      }
    }),

  removeDependency: taskProcedure
    .input(z.object({ dependsOnId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        const dep = await resolveOrThrow(model, input.dependsOnId);
        await model.removeDependency(task.id, dep.id);
        return { message: 'Dependency removed', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:removeDependency]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to remove dependency',
        });
      }
    }),

  unpinDocument: taskProcedure
    .input(z.object({ documentId: z.string(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.taskId);
        await model.unpinDocument(task.id, input.documentId);
        return { message: 'Document unpinned', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:unpinDocument]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to unpin document',
        });
      }
    }),

  getCheckpoint: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      const checkpoint = model.getCheckpointConfig(task);
      return { data: checkpoint, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getCheckpoint]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get checkpoint',
      });
    }
  }),

  updateCheckpoint: taskProcedure
    .input(
      idInput.merge(
        z.object({
          checkpoint: z.object({
            onAgentRequest: z.boolean().optional(),
            tasks: z
              .object({
                afterIds: z.array(z.string()).optional(),
                beforeIds: z.array(z.string()).optional(),
              })
              .optional(),
            topic: z
              .object({
                after: z.boolean().optional(),
                before: z.boolean().optional(),
              })
              .optional(),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, checkpoint } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateCheckpointConfig(resolved.id, checkpoint);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getCheckpointConfig(task),
          message: 'Checkpoint updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateCheckpoint]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update checkpoint',
        });
      }
    }),

  getReview: taskProcedure.input(idInput).query(async ({ input, ctx }) => {
    try {
      const model = ctx.taskModel;
      const task = await resolveOrThrow(model, input.id);
      return { data: model.getReviewConfig(task) || null, success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:getReview]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get review config',
      });
    }
  }),

  updateReview: taskProcedure
    .input(
      idInput.merge(
        z.object({
          review: z.object({
            autoRetry: z.boolean().default(true),
            enabled: z.boolean(),
            judge: z
              .object({
                model: z.string().optional(),
                provider: z.string().optional(),
              })
              .default({}),
            maxIterations: z.number().min(1).max(10).default(3),
            rubrics: z.array(
              z.object({
                config: z.record(z.unknown()),
                extractor: z.record(z.unknown()).optional(),
                id: z.string(),
                name: z.string(),
                threshold: z.number().min(0).max(1).optional(),
                type: z.string(),
                weight: z.number().default(1),
              }),
            ),
          }),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, review } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);
        const task = await model.updateReviewConfig(resolved.id, review);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
        return {
          data: model.getReviewConfig(task),
          message: 'Review config updated',
          success: true,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateReview]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update review config',
        });
      }
    }),

  runReview: taskProcedure
    .input(
      idInput.merge(
        z.object({
          content: z.string().optional(),
          topicId: z.string().optional(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);

        const reviewConfig = model.getReviewConfig(task);
        if (!reviewConfig?.enabled) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Review is not enabled for this task',
          });
        }

        // Use provided content or try to get from latest topic
        const content = input.content;
        if (!content) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Content is required for review. Pass --content or run after a topic completes.',
          });
        }

        // Determine which topic to attach the review to
        const topicId = input.topicId || task.currentTopicId;

        // Get current iteration count for this topic
        let iteration = 1;
        if (topicId) {
          const topics = await model.getTopics(task.id);
          const target = topics.find((t) => t.topicId === topicId);
          if (target?.reviewIteration) {
            iteration = target.reviewIteration + 1;
          }
        }

        const reviewService = new TaskReviewService(ctx.serverDB, ctx.userId);
        const result = await reviewService.review({
          content,
          iteration,
          judge: reviewConfig.judge,
          rubrics: reviewConfig.rubrics,
          taskName: task.name || task.identifier,
        });

        // Save review result to task_topics
        if (topicId) {
          await model.updateTopicReview(task.id, topicId, {
            iteration,
            passed: result.passed,
            score: result.overallScore,
            scores: result.rubricResults,
          });
        }

        return { data: result, success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:runReview]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to run review',
        });
      }
    }),

  update: taskProcedure.input(idInput.merge(updateSchema)).mutation(async ({ input, ctx }) => {
    const { id, ...data } = input;
    try {
      const model = ctx.taskModel;
      const resolved = await resolveOrThrow(model, id);
      const task = await model.update(resolved.id, data);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      return { data: task, message: 'Task updated', success: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error('[task:update]', error);
      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update task',
      });
    }
  }),

  updateStatus: taskProcedure
    .input(
      z.object({
        error: z.string().optional(),
        id: z.string(),
        status: z.enum(['backlog', 'running', 'paused', 'completed', 'failed', 'canceled']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, status, error: errorMsg } = input;
      try {
        const model = ctx.taskModel;
        const resolved = await resolveOrThrow(model, id);

        const extra: Record<string, unknown> = {};
        if (status === 'running') extra.startedAt = new Date();
        if (status === 'completed' || status === 'failed' || status === 'canceled')
          extra.completedAt = new Date();
        if (errorMsg) extra.error = errorMsg;

        const task = await model.updateStatus(resolved.id, status, extra);
        if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });

        // On completion: check dependency unlocking + parent notification + checkpoints
        const unlocked: string[] = [];
        const paused: string[] = [];
        let allSubtasksDone = false;
        let checkpointTriggered = false;

        if (status === 'completed') {
          // 1. Check afterIds checkpoint on parent
          if (task.parentTaskId) {
            const parentTask = await model.findById(task.parentTaskId);
            if (parentTask && model.shouldPauseAfterComplete(parentTask, task.identifier)) {
              // Pause the parent task for review
              await model.updateStatus(parentTask.id, 'paused');
              checkpointTriggered = true;
            }

            // 2. Check if all sibling subtasks are done
            allSubtasksDone = await model.areAllSubtasksCompleted(task.parentTaskId);
          }

          // 3. Unlock tasks blocked by this one
          const unlockedTasks = await model.getUnlockedTasks(task.id);
          for (const ut of unlockedTasks) {
            // Check beforeIds checkpoint on parent before starting
            let shouldPause = false;
            if (ut.parentTaskId) {
              const parentTask = await model.findById(ut.parentTaskId);
              if (parentTask && model.shouldPauseBeforeStart(parentTask, ut.identifier)) {
                shouldPause = true;
              }
            }

            if (shouldPause) {
              await model.updateStatus(ut.id, 'paused');
              paused.push(ut.identifier);
            } else {
              await model.updateStatus(ut.id, 'running', { startedAt: new Date() });
              unlocked.push(ut.identifier);
            }
          }
        }

        return {
          data: task,
          message: `Task ${status}`,
          success: true,
          ...(unlocked.length > 0 && { unlocked }),
          ...(paused.length > 0 && { paused }),
          ...(checkpointTriggered && { checkpointTriggered: true }),
          ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId: task.parentTaskId }),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateStatus]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update status',
        });
      }
    }),
});
