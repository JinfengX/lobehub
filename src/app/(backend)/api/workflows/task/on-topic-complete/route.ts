import debug from 'debug';
import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';

const log = debug('lobe-server:workflows:task:on-topic-complete');

/**
 * Webhook handler for task topic completion.
 *
 * Called by AgentRuntime's onComplete hook (via QStash in production)
 * when a topic finishes executing. Triggers the task lifecycle flow:
 * heartbeat → handoff → review → checkpoint → self-schedule next topic.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Hook event fields (from AgentHookEvent) + webhook body extras
    const { taskId, userId, operationId, topicId, reason, lastAssistantContent, errorMessage } =
      body;

    if (!taskId || !userId) {
      return NextResponse.json({ error: 'Missing taskId or userId' }, { status: 400 });
    }

    log(
      'Received: taskId=%s topicId=%s reason=%s operationId=%s',
      taskId,
      topicId,
      reason,
      operationId,
    );

    const db = await getServerDB();
    const lifecycle = new TaskLifecycleService(db, userId);

    await lifecycle.onTopicComplete({
      errorMessage,
      lastAssistantContent,
      operationId: operationId || '',
      reason: reason || 'done',
      taskId,
      taskIdentifier: '', // not available from webhook, lifecycle will resolve
      topicId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[task:on-topic-complete] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}
