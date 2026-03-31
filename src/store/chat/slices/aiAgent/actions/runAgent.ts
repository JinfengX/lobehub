import {
  type AgentEventMessage,
  AgentGatewayClient,
  type IAgentGatewayClient,
  type InputRequestMessage,
  type SessionCompleteMessage,
  type StatusChangeMessage,
  type ToolConfirmationRequestMessage,
} from '@lobechat/agent-gateway-client';
import { isDesktop } from '@lobechat/const';
import { type ChatToolPayload } from '@lobechat/types';
import debug from 'debug';
import i18n from 'i18next';

import { type StreamEvent } from '@/services/agentRuntime';
import { agentRuntimeService } from '@/services/agentRuntime';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { type ChatStore } from '@/store/chat/store';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { type StoreSetter } from '@/store/types';

const log = debug('store:chat:ai-agent:runAgent');

interface StreamingContext {
  assistantId: string;
  content: string;
  reasoning: string;
  tmpAssistantId: string;
  toolsCalling?: ChatToolPayload[];
}

type Setter = StoreSetter<ChatStore>;
export const agentSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new AgentActionImpl(set, get, _api);

/**
 * Read the agent gateway URL from server config.
 * Returns undefined if not configured (feature disabled).
 */
const getAgentGatewayUrl = (): string | undefined => {
  if (typeof window === 'undefined' || !window.global_serverConfigStore) return undefined;
  return window.global_serverConfigStore.getState()?.serverConfig?.agentGatewayUrl;
};

export class AgentActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  internal_cleanupAgentOperation = (assistantId: string): void => {
    // Find operation by messageId (assistantId)
    const messageOpId = this.#get().messageOperationMap[assistantId];
    if (!messageOpId) {
      log(`No operation found for assistant message ${assistantId}`);
      return;
    }

    log(`Cleaning up agent operation for ${assistantId} (operationId: ${messageOpId})`);

    // Cancel the operation (this will trigger the cancel handler which aborts the SSE stream)
    this.#get().cancelOperation(messageOpId, 'Cleanup requested');
  };

  internal_handleAgentError = (assistantId: string, errorMessage: string): void => {
    log(`Agent error for ${assistantId}: ${errorMessage}`);

    // Find operation by messageId (assistantId) and fail it
    const messageOpId = this.#get().messageOperationMap[assistantId];
    if (messageOpId) {
      this.#get().failOperation(messageOpId, {
        message: errorMessage,
        type: 'AgentExecutionError',
      });
    }

    // Update error state in frontend only (backend already persists the error)
    this.#get().internal_dispatchMessage({
      id: assistantId,
      type: 'updateMessage',
      value: {
        error: {
          message: errorMessage,
          type: 'UnknownError' as any,
        },
      },
    });

    // Stop loading state
    this.#get().internal_toggleMessageLoading(false, assistantId);

    // Clean up operation (this will cancel the operation)
    this.#get().internal_cleanupAgentOperation(assistantId);
  };

  internal_handleAgentStreamEvent = async (
    operationId: string,
    event: StreamEvent,
    context: StreamingContext,
  ): Promise<void> => {
    const { internal_dispatchMessage } = this.#get();
    const operation = this.#get().operations[operationId];
    if (!operation) {
      log(`No operation found for ${operationId}, ignoring event ${event.type}`);
      return;
    }

    // Update operation metadata
    this.#get().updateOperationMetadata(operationId, {
      lastEventId: event.timestamp.toString(),
      stepCount: event.stepIndex,
    });

    const assistantId = context.assistantId || context.tmpAssistantId;
    log(`assistantMessageId: ${assistantId}`);

    switch (event.type) {
      case 'connected': {
        log(`Agent stream connected for ${assistantId}`);
        break;
      }

      case 'heartbeat': {
        // Heartbeat event, keeps the connection alive
        break;
      }

      case 'agent_runtime_init': {
        // Agent runtime initialization event
        log(`Agent runtime initialized for ${assistantId}:`, event.data);
        break;
      }

      case 'agent_runtime_end': {
        // Agent runtime finished - this is the definitive signal that generation is complete
        const { reason, reasonDetail, finalState } = event.data || {};
        log(`Agent runtime ended for ${assistantId}: reason=${reason}, detail=${reasonDetail}`);

        // Update operation metadata with final state
        if (finalState) {
          this.#get().updateOperationMetadata(operationId, {
            finalStatus: finalState.status || reason,
          });
        }

        // Stop loading state
        log(`Stopping loading for completed agent runtime: ${assistantId}`);
        this.#get().internal_toggleMessageLoading(false, assistantId);
        break;
      }

      case 'stream_start': {
        // If assistantId is already set (Group Chat flow), skip message creation/deletion
        // In Group Chat, messages are already synced via replaceMessages from backend response
        if (context.assistantId) {
          log(`Stream started for ${context.assistantId} (message already synced from backend)`);
          break;
        }

        // Original logic for normal Agent flow
        log(`Stream started for ${assistantId}:`, event.data);
        internal_dispatchMessage({
          id: context.tmpAssistantId,
          type: 'deleteMessage',
        });

        context.assistantId = event.data.assistantMessage.id;

        internal_dispatchMessage({
          id: context.assistantId,
          type: 'createMessage',
          value: event.data.assistantMessage,
        });

        break;
      }

      case 'stream_chunk': {
        // Handle streaming content chunk
        const { chunkType } = event.data || {};

        switch (chunkType) {
          case 'text': {
            // Update text content
            context.content += event.data.content;
            log(`Stream(${event.operationId}) chunk type=${chunkType}: `, event.data.content);

            internal_dispatchMessage({
              id: assistantId,
              type: 'updateMessage',
              value: { content: context.content },
            });
            break;
          }

          case 'reasoning': {
            // Update text content
            context.reasoning += event.data.reasoning;
            log(`Stream(${event.operationId}) chunk type=${chunkType}: `, event.data.reasoning);

            internal_dispatchMessage({
              id: assistantId,
              type: 'updateMessage',
              value: { reasoning: { content: context.reasoning } },
            });
            break;
          }

          case 'tools_calling': {
            context.toolsCalling = event.data.toolsCalling;

            internal_dispatchMessage({
              id: assistantId,
              type: 'updateMessage',
              value: { tools: context.toolsCalling },
            });
            break;
          }
        }

        break;
      }

      case 'stream_end': {
        // Stream ended, update final content
        const { finalContent, toolCalls, reasoning, imageList, grounding } = event.data || {};
        log(`Stream ended for ${assistantId}:`, {
          hasFinalContent: !!finalContent,
          hasGrounding: !!grounding,
          hasImageList: !!(imageList && imageList.length > 0),
          hasReasoning: !!reasoning,
          hasToolCalls: !!(toolCalls && toolCalls.length > 0),
        });

        // Update frontend UI only (backend already persists all data)
        if (finalContent !== undefined) {
          internal_dispatchMessage({
            id: assistantId,
            type: 'updateMessage',
            value: {
              content: finalContent,
              ...(toolCalls && toolCalls.length > 0 ? { tools: toolCalls } : {}),
              ...(reasoning ? { reasoning } : {}),
              ...(imageList && imageList.length > 0 ? { imageList } : {}),
              ...(grounding ? { search: grounding } : {}),
            },
          });
        }

        // Stop loading state
        log(`Stopping loading for ${assistantId}`);
        this.#get().internal_toggleMessageLoading(false, assistantId);

        // Show desktop notification
        if (isDesktop) {
          try {
            const { desktopNotificationService } =
              await import('@/services/electron/desktopNotification');

            // Use topic title or agent title as notification title
            let notificationTitle = i18n.t('desktopNotification.aiReplyCompleted.title', {
              ns: 'chat',
            });
            const opCtx = operation.context;
            if (opCtx.topicId && opCtx.agentId) {
              const key = topicMapKey({ agentId: opCtx.agentId, groupId: opCtx.groupId });
              const topicData = this.#get().topicDataMap[key];
              const topic = topicData?.items?.find((item) => item.id === opCtx.topicId);
              if (topic?.title) notificationTitle = topic.title;
            } else if (opCtx.agentId) {
              const agentMeta = agentSelectors.getAgentMetaById(opCtx.agentId)(
                getAgentStoreState(),
              );
              if (agentMeta?.title) notificationTitle = agentMeta.title;
            }

            await desktopNotificationService.showNotification({
              body: i18n.t('desktopNotification.aiReplyCompleted.body', { ns: 'chat' }),
              title: notificationTitle,
            });
          } catch (error) {
            console.error('Desktop notification error:', error);
          }
        }

        // Mark unread completion for background agents
        const op = this.#get().operations[operationId];
        if (op?.context.agentId) {
          this.#get().markUnreadCompleted(op.context.agentId, op.context.topicId);
        }
        break;
      }

      case 'step_start': {
        const { phase, toolCall, pendingToolsCalling, requiresApproval } = event.data || {};

        if (phase === 'human_approval' && requiresApproval) {
          // Requires human approval
          log(`Human approval required for ${assistantId}:`, pendingToolsCalling);
          this.#get().updateOperationMetadata(operationId, {
            needsHumanInput: true,
            pendingApproval: pendingToolsCalling,
          });

          // Stop loading state, waiting for human intervention
          log(`Stopping loading for human approval: ${assistantId}`);
          this.#get().internal_toggleMessageLoading(false, assistantId);
        } else if (phase === 'tool_execution' && toolCall) {
          log(`Tool execution started for ${assistantId}: ${toolCall.function?.name}`);
        }
        break;
      }

      case 'step_complete': {
        const { phase, result, executionTime, finalState } = event.data || {};

        if (phase === 'tool_execution' && result) {
          log(`Tool execution completed for ${assistantId} in ${executionTime}ms:`, result);
          // Refresh messages to display tool results
          await this.#get().refreshMessages();
        } else if (phase === 'execution_complete' && finalState) {
          // Agent execution complete
          log(`Agent execution completed for ${assistantId}:`, finalState);
          this.#get().updateOperationMetadata(operationId, {
            finalStatus: finalState.status,
          });

          log(`Stopping loading for completed agent: ${assistantId}`);
          this.#get().internal_toggleMessageLoading(false, assistantId);
        }
        break;
      }

      case 'error': {
        const { error, message, phase } = event.data || {};
        log(`Error in ${phase} for ${assistantId}:`, error);
        this.#get().internal_handleAgentError(
          assistantId,
          message || error || 'Unknown agent error',
        );
        break;
      }

      default: {
        log(`Handling event ${event.type} for ${assistantId}:`, event);
        break;
      }
    }
  };

  // ─── Agent Gateway (WebSocket) ───

  /**
   * Check if the Agent Gateway is available (configured via server config).
   */
  isAgentGatewayAvailable = (): boolean => {
    return !!getAgentGatewayUrl();
  };

  /**
   * Connect to Agent Gateway via WebSocket and wire up event handlers.
   * Returns the gateway client instance (stored on the operation for cancel handling).
   */
  internal_connectAgentGateway = (
    chatKey: string,
    params: {
      assistantId: string;
      execOperationId: string;
      streamOperationId: string;
    },
  ): IAgentGatewayClient | undefined => {
    const { assistantId, execOperationId, streamOperationId } = params;

    const gatewayUrl = getAgentGatewayUrl();
    if (!gatewayUrl) {
      log('Agent gateway URL not configured, skipping WebSocket connection');
      this.#get().failOperation(streamOperationId, {
        message: 'Agent gateway URL not configured',
        type: 'AgentGatewayError',
      });
      return undefined;
    }

    // Token is empty for now — the gateway authenticates via cookie/session
    // forwarded through the WebSocket handshake. When a dedicated gateway JWT
    // endpoint is added, replace this with the fetched token.
    const token = '';

    const client = new AgentGatewayClient({ gatewayUrl, token });

    const streamContext = { assistantId, content: '', reasoning: '' };

    client.on('connected', () => {
      log('Gateway connected for %s', chatKey);
    });

    client.on('disconnected', () => {
      log('Gateway disconnected for %s', chatKey);
      this.#get().completeOperation(streamOperationId);
      this.#get().completeOperation(execOperationId);
    });

    client.on('error', (error: Error | Event) => {
      log('Gateway error for %s: %O', chatKey, error);
      this.#get().failOperation(streamOperationId, {
        message: error instanceof Error ? error.message : 'Gateway connection error',
        type: 'AgentGatewayError',
      });
      this.#get().internal_handleAgentError(assistantId, 'Gateway connection error');
    });

    client.on('agent_event', (message: AgentEventMessage) => {
      this.internal_handleGatewayAgentEvent(assistantId, message, streamContext);
    });

    client.on('tool_confirmation_request', (message: ToolConfirmationRequestMessage) => {
      log('Tool confirmation request: %s', message.toolCallId);
      this.#get().updateOperationMetadata(streamOperationId, {
        gatewayClient: client,
        needsHumanInput: true,
        pendingApproval: [{ tool: message.tool, toolCallId: message.toolCallId }],
      });
      this.#get().internal_toggleMessageLoading(false, assistantId);
    });

    client.on('input_request', (message: InputRequestMessage) => {
      log('User input request: %s', message.requestId);
      this.#get().updateOperationMetadata(streamOperationId, {
        gatewayClient: client,
        needsHumanInput: true,
        pendingPrompt: message.prompt,
        pendingRequestId: message.requestId,
      });
      this.#get().internal_toggleMessageLoading(false, assistantId);
    });

    client.on('session_complete', (_message: SessionCompleteMessage) => {
      log('Session complete for %s', chatKey);
      this.#get().internal_toggleMessageLoading(false, assistantId);
      this.#get().completeOperation(streamOperationId);
      this.#get().completeOperation(execOperationId);

      // Mark unread completion for background conversations
      const op = this.#get().operations[streamOperationId];
      if (op?.context.agentId) {
        this.#get().markUnreadCompleted(op.context.agentId, op.context.topicId);
      }

      // Disconnect after completion
      client.disconnect();
    });

    client.on('status_update', (message: StatusChangeMessage) => {
      log('Status change for %s: %s', chatKey, message.status);
      if (message.status === 'error' || message.status === 'interrupted') {
        this.#get().internal_toggleMessageLoading(false, assistantId);
      }
    });

    // Register cancel handler
    this.#get().onOperationCancel(streamOperationId, () => {
      log('Cancelling gateway connection for %s', chatKey);
      client.sendInterrupt();
      client.disconnect();
    });

    // Connect
    client.connect(chatKey);

    return client;
  };

  /**
   * Handle agent_event messages from the gateway.
   * Maps gateway AgentStreamEvent kinds to store updates.
   */
  private internal_handleGatewayAgentEvent = (
    assistantId: string,
    message: AgentEventMessage,
    context: { assistantId: string; content: string; reasoning: string },
  ): void => {
    const { internal_dispatchMessage } = this.#get();
    const event = message.event;

    switch (event.kind) {
      case 'text_delta': {
        context.content += event.content;
        internal_dispatchMessage({
          id: assistantId,
          type: 'updateMessage',
          value: { content: context.content },
        });
        break;
      }

      case 'thinking': {
        context.reasoning += event.content;
        internal_dispatchMessage({
          id: assistantId,
          type: 'updateMessage',
          value: { reasoning: { content: context.reasoning } },
        });
        break;
      }

      case 'tool_call_start': {
        // Tool call started - could update tools display
        log('Tool call start: %s (%s)', event.name, event.toolCallId);
        break;
      }

      case 'tool_call_delta': {
        // Tool call arguments streaming
        break;
      }

      case 'tool_call_end': {
        log('Tool call end: %s', event.toolCallId);
        break;
      }

      case 'tool_result': {
        log('Tool result for %s', event.toolCallId);
        // Refresh messages to display tool results from server
        this.#get().refreshMessages();
        break;
      }

      case 'step_complete': {
        log('Step %d complete', event.stepIndex);
        break;
      }

      case 'message_complete': {
        log('Message complete: %s', event.messageId);
        this.#get().internal_toggleMessageLoading(false, assistantId);
        // Refresh to get final persisted state from server
        this.#get().refreshMessages();
        break;
      }
    }
  };

  internal_handleHumanIntervention = async (
    assistantId: string,
    action: string,
    data?: any,
  ): Promise<void> => {
    // Find operation by messageId (assistantId)
    const messageOpId = this.#get().messageOperationMap[assistantId];
    if (!messageOpId) {
      log(`No operation found for assistant message ${assistantId}`);
      return;
    }

    const operation = this.#get().operations[messageOpId];
    if (!operation || !operation.metadata.needsHumanInput) {
      log(`No human intervention needed for operation ${messageOpId}`);
      return;
    }

    try {
      log(`Handling human intervention ${action} for operation ${messageOpId}:`, data);

      // Check if this operation has a gateway client (WebSocket path)
      const gatewayClient = operation.metadata.gatewayClient as IAgentGatewayClient | undefined;
      if (gatewayClient) {
        // Send via WebSocket
        if (action === 'approve' || action === 'reject') {
          const toolCallId =
            data?.toolCallId || operation.metadata.pendingApproval?.[0]?.toolCallId;
          if (toolCallId) {
            gatewayClient.sendToolConfirmation(toolCallId, action === 'approve');
          }
        } else if (action === 'user_input') {
          const requestId = data?.requestId || operation.metadata.pendingRequestId;
          if (requestId && data?.content) {
            gatewayClient.sendUserInput(requestId, data.content);
          }
        }
      } else {
        // Fallback to HTTP for non-gateway operations
        await agentRuntimeService.handleHumanIntervention({
          action: action as any,
          data,
          operationId: messageOpId,
        });
      }

      // Resume loading state
      this.#get().internal_toggleMessageLoading(true, assistantId);

      // Clear human intervention state
      this.#get().updateOperationMetadata(messageOpId, {
        needsHumanInput: false,
        pendingApproval: undefined,
        pendingPrompt: undefined,
        pendingSelect: undefined,
      });

      log(`Human intervention ${action} processed for operation ${messageOpId}`);
    } catch (error) {
      log(`Failed to handle human intervention for operation ${messageOpId}:`, error);
      this.#get().internal_handleAgentError(
        assistantId,
        `Human intervention failed: ${(error as Error).message}`,
      );
    }
  };
}

export type AgentAction = Pick<AgentActionImpl, keyof AgentActionImpl>;
