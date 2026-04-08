import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * Hook that detects a running Gateway operation on the current topic
 * and automatically reconnects the WebSocket after page reload.
 */
export const useGatewayReconnect = (topicId?: string | null) => {
  const reconnectedRef = useRef<Set<string>>(new Set());

  const reconnectToGatewayOperation = useChatStore((s) => s.reconnectToGatewayOperation);
  const isGatewayModeEnabled = useChatStore((s) => s.isGatewayModeEnabled);

  useEffect(() => {
    if (!topicId || !isGatewayModeEnabled()) return;

    // Skip if already reconnected to this topic's operation
    if (reconnectedRef.current.has(topicId)) return;

    const topic = topicSelectors.getTopicById(topicId)(useChatStore.getState());
    const runningOp = topic?.metadata?.runningOperation;

    if (!runningOp) return;

    // Mark as reconnected to avoid duplicate connections
    reconnectedRef.current.add(topicId);

    reconnectToGatewayOperation({
      assistantMessageId: runningOp.assistantMessageId,
      operationId: runningOp.operationId,
      topicId,
    }).catch((e) => {
      console.error('[GatewayReconnect] Failed to reconnect:', e);
      // Remove from reconnected set so it can be retried
      reconnectedRef.current.delete(topicId);
    });
  }, [topicId, isGatewayModeEnabled, reconnectToGatewayOperation]);
};
