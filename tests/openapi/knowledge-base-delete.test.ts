import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { KnowledgeBaseService } from '../../packages/openapi/src/services/knowledge-base.service';

describe('KnowledgeBaseService.deleteKnowledgeBase', () => {
  let db: LobeChatDatabase;

  beforeEach(() => {
    db = {
      query: {
        knowledgeBases: {
          findFirst: vi.fn().mockResolvedValue({ id: 'kb-1', userId: 'user-1' }),
        },
      },
    } as unknown as LobeChatDatabase;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createService = () => {
    const service = new KnowledgeBaseService(db, 'user-1');

    vi.spyOn(service as any, 'log').mockImplementation(() => {});
    vi.spyOn(service as any, 'resolveOperationPermission').mockResolvedValue({
      isPermitted: true,
      message: '',
    });

    return service;
  };

  it('should always delete exclusive files together with the knowledge base', async () => {
    const service = createService();
    const deleteWithFilesSpy = vi.fn().mockResolvedValue({
      deletedFiles: [],
    });

    Reflect.set(service, 'knowledgeBaseModel', {
      deleteWithFiles: deleteWithFilesSpy,
    });

    await expect(service.deleteKnowledgeBase('kb-1')).resolves.toEqual({
      message: 'Knowledge base deleted successfully',
      success: true,
    });

    expect(deleteWithFilesSpy).toHaveBeenCalledWith('kb-1');
  });
});
