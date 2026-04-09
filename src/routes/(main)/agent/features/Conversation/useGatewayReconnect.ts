import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * Hook that detects a running Gateway operation on the current topic
 * and automatically reconnects the WebSocket after page reload.
 *
 * Subscribes to the topic's runningOperation metadata so it triggers
 * even when topic data arrives asynchronously from SWR.
 */
export const useGatewayReconnect = (topicId?: string | null) => {
  const reconnectedRef = useRef<Set<string>>(new Set());

  const reconnectToGatewayOperation = useChatStore((s) => s.reconnectToGatewayOperation);
  const isGatewayModeEnabled = useChatStore((s) => s.isGatewayModeEnabled);

  // Subscribe to the topic's runningOperation so the effect re-fires
  // when topic metadata arrives from SWR (initially empty on page load)
  const runningOperation = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata?.runningOperation : undefined,
  );

  useEffect(() => {
    if (!topicId || !runningOperation || !isGatewayModeEnabled()) return;

    // Skip if already reconnected to this operation
    if (reconnectedRef.current.has(runningOperation.operationId)) return;

    // Mark as reconnected to avoid duplicate connections
    reconnectedRef.current.add(runningOperation.operationId);

    reconnectToGatewayOperation({
      assistantMessageId: runningOperation.assistantMessageId,
      operationId: runningOperation.operationId,
      scope: runningOperation.scope,
      threadId: runningOperation.threadId,
      topicId,
    }).catch((e) => {
      console.error('[GatewayReconnect] Failed to reconnect:', e);
      reconnectedRef.current.delete(runningOperation.operationId);
    });
  }, [topicId, runningOperation, isGatewayModeEnabled, reconnectToGatewayOperation]);
};
