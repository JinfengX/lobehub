import { type LobeChatDatabase } from '@lobechat/database';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { FileService } from '@/server/services/file';

export class AiChatService {
  private userId: string;
  private messageModel: MessageModel;
  private topicModel: TopicModel;

  constructor(serverDB: LobeChatDatabase, userId: string) {
    this.userId = userId;

    const fileService = new FileService(serverDB, userId);
    this.messageModel = new MessageModel(serverDB, userId, {
      postProcessUrl: (path) => fileService.getFullFileUrl(path),
    });
    this.topicModel = new TopicModel(serverDB, userId);
  }

  async getMessagesAndTopics(params: {
    agentId?: string;
    current?: number;
    groupId?: string;
    includeTopic?: boolean;
    pageSize?: number;
    sessionId?: string;
    threadId?: string;
    topicId?: string;
  }) {
    const [messages, topics] = await Promise.all([
      this.messageModel.query(params),
      params.includeTopic
        ? this.topicModel.query({ agentId: params.agentId, groupId: params.groupId })
        : undefined,
    ]);

    return { messages, topics };
  }
}
