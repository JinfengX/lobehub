// Disable the auto sort key eslint rule to make the code more logic and readable
import { LOADING_FLAT } from '@lobechat/const';
import { type SendGroupMessageParams } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { lambdaClient } from '@/libs/trpc/client';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

const log = debug('store:chat:ai-agent:agentGroup');

const n = setNamespace('aiAgentGroup');

type Setter = StoreSetter<ChatStore>;
export const agentGroupSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ChatGroupChatActionImpl(set, get, _api);

export class ChatGroupChatActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  sendGroupMessage = async ({ context, message, files }: SendGroupMessageParams): Promise<void> => {
    if (!message.trim() && (!files || files.length === 0)) return;

    const { agentId, groupId, topicId } = context;

    if (!agentId || !groupId) {
      log('sendGroupMessage: missing agentId or groupId in context');
      return;
    }

    const { optimisticCreateTmpMessage, startOperation } = this.#get();

    log(
      'sendGroupMessage: agentId=%s, groupId=%s, message=%s',
      agentId,
      groupId,
      message.slice(0, 50),
    );

    this.#set({ isCreatingMessage: true }, false, n('sendGroupMessage/start'));

    // 0. Create execServerAgentRuntime operation FIRST for correct loading state
    // This ensures isAgentRuntimeRunningByContext returns true during mutate call
    const tempUserId = 'tmp_' + nanoid();
    const tempAssistantId = 'tmp_' + nanoid();
    const fileIds = files?.map((f) => f.id);

    const { operationId: execOperationId, abortController: execAbortController } = startOperation({
      context: { ...context, messageId: tempUserId },
      label: 'Execute Server Agent',
      type: 'execServerAgentRuntime',
    });

    // 1. Optimistic update - create temp messages immediately for instant UI feedback
    // Pass operationId so internal_dispatchMessage uses the correct context
    optimisticCreateTmpMessage(
      {
        agentId,
        content: message,
        files: fileIds,
        groupId,
        role: 'user',
        topicId: topicId ?? undefined,
      },
      { operationId: execOperationId, tempMessageId: tempUserId },
    );

    // Create temp assistant message (loading state)
    optimisticCreateTmpMessage(
      {
        agentId,
        content: LOADING_FLAT,
        groupId,
        role: 'assistant',
        topicId: topicId ?? undefined,
      },
      { operationId: execOperationId, tempMessageId: tempAssistantId },
    );

    // Start loading state for temp messages
    this.#get().internal_toggleMessageLoading(true, tempUserId);
    this.#get().internal_toggleMessageLoading(true, tempAssistantId);

    try {
      // 2. Call backend execGroupAgent - creates messages and triggers Agent
      // Pass AbortSignal to allow cancellation during the API call
      const result = await lambdaClient.aiAgent.execGroupAgent.mutate(
        { agentId, files: fileIds, groupId, message, topicId },
        { signal: execAbortController.signal },
      );

      log(
        'execGroupAgent result: operationId=%s, topicId=%s, success=%s',
        result.operationId,
        result.topicId,
        result.success,
      );

      // 3. Update topics if new topic was created
      if (result.topics) {
        const pageSize = 20; // Default page size for topics
        this.#get().internal_updateTopics(agentId, {
          groupId,
          items: result.topics.items as any, // Type from DB may have null vs undefined differences
          pageSize,
          total: result.topics.total,
        });
      }

      // 4. Switch to new topic if created
      if (result.isCreateNewTopic && result.topicId) {
        await this.#get().switchTopic(result.topicId, {
          clearNewKey: true,
          skipRefreshMessage: true,
        });
      }

      // 5. Create execContext with updated topicId from server response
      const execContext = { ...context, topicId: result.topicId || topicId };

      // 6. Replace temp messages with server messages
      // Messages include assistant message with error if operation failed to start
      if (result.messages) {
        this.#get().replaceMessages(result.messages, {
          action: n('sendGroupMessage/syncMessages'),
          context: execContext,
        });
        // Delete temp messages - use execOperationId for correct context
        this.#get().internal_dispatchMessage(
          { ids: [tempUserId, tempAssistantId], type: 'deleteMessages' },
          { operationId: execOperationId },
        );
      }

      // 7. Check if operation failed to start (e.g., QStash unavailable)
      // In this case, messages are synced but we skip SSE connection
      if (result.success === false) {
        log('Agent operation failed to start: %s', result.error);
        // Complete the operation with error status
        this.#get().failOperation(execOperationId, {
          message: result.error || 'Agent operation failed to start',
          type: 'AgentStartupError',
        });
        // Stop loading state for assistant message
        this.#get().internal_toggleMessageLoading(false, result.assistantMessageId);
        return;
      }

      // 8. Start child operation for gateway stream using backend operationId
      this.#get().startOperation({
        context: { ...execContext, messageId: result.assistantMessageId },
        label: 'Group Agent Gateway',
        operationId: result.operationId,
        parentOperationId: execOperationId,
        type: 'groupAgentStream',
      });

      // Associate assistant message with both operations:
      // - execServerAgentRuntime (parent) - for isGenerating detection
      // - groupAgentStream (child) - for stream cancel handling
      this.#get().associateMessageWithOperation(result.assistantMessageId, execOperationId);
      this.#get().associateMessageWithOperation(result.assistantMessageId, result.operationId);

      // 9. Connect to Agent Gateway via WebSocket (if available)
      if (this.#get().isAgentGatewayAvailable()) {
        const chatKey = result.operationId; // Use operationId as chatKey for gateway routing
        this.#get().internal_connectAgentGateway(chatKey, {
          assistantId: result.assistantMessageId,
          execOperationId,
          streamOperationId: result.operationId,
        });
      } else {
        log('Agent gateway not available, server-side execution will use fallback path');
        // Complete operations — the backend handles execution independently
        this.#get().completeOperation(result.operationId);
        this.#get().completeOperation(execOperationId);
      }
    } catch (error) {
      // Check if this is an abort error (user cancelled the operation)
      const isAbortError =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('cancelled'));

      if (isAbortError) {
        log('sendGroupMessage aborted by user');
        // Operation was cancelled by user, status already updated by cancelOperation
        // Just clean up temp messages
        this.#get().internal_dispatchMessage(
          {
            ids: [tempUserId, tempAssistantId],
            type: 'deleteMessages',
          },
          { operationId: execOperationId },
        );
      } else {
        log('sendGroupMessage failed: %O', error);
        console.error('Failed to send group message:', error);

        // Remove temp messages on error - use execOperationId for correct context
        this.#get().internal_dispatchMessage(
          {
            ids: [tempUserId, tempAssistantId],
            type: 'deleteMessages',
          },
          { operationId: execOperationId },
        );

        // Fail the execServerAgentRuntime operation
        this.#get().failOperation(execOperationId, {
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'SendGroupMessageError',
        });
      }
    } finally {
      this.#get().internal_toggleMessageLoading(false, tempUserId);
      this.#get().internal_toggleMessageLoading(false, tempAssistantId);
      this.#set({ isCreatingMessage: false }, false, n('sendGroupMessage/end'));
    }
  };
}

export type ChatGroupChatAction = Pick<ChatGroupChatActionImpl, keyof ChatGroupChatActionImpl>;
