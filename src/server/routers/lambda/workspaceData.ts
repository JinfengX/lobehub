import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { router, workspaceAdminProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const dataProcedure = workspaceAdminProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentModel: new AgentModel(ctx.serverDB, ctx.userId, wsId),
      knowledgeBaseModel: new KnowledgeBaseModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const workspaceDataRouter = router({
  exportData: dataProcedure.mutation(async ({ ctx }) => {
    const agents = await ctx.agentModel.queryAgents();
    const knowledgeBases = await ctx.knowledgeBaseModel.query();

    return {
      agents,
      exportedAt: new Date().toISOString(),
      knowledgeBases,
      version: 1,
    };
  }),

  importData: dataProcedure
    .input(
      z.object({
        agents: z.array(z.any()).optional(),
        knowledgeBases: z.array(z.any()).optional(),
        onConflict: z.enum(['skip', 'overwrite', 'rename']).default('skip'),
      }),
    )
    .mutation(async ({ input }) => {
      // Placeholder — full import logic will handle conflict resolution
      return {
        agentsImported: input.agents?.length ?? 0,
        knowledgeBasesImported: input.knowledgeBases?.length ?? 0,
      };
    }),
});

export type WorkspaceDataRouter = typeof workspaceDataRouter;
