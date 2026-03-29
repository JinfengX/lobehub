import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { agents, files, knowledgeBases } from '@/database/schemas';
import { router, workspaceAdminProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const dataProcedure = workspaceAdminProcedure.use(serverDatabase);

export const workspaceDataRouter = router({
  /**
   * Export workspace data (agents + knowledge bases config)
   * Admin+ only
   */
  exportData: dataProcedure.mutation(async ({ ctx }) => {
    if (!ctx.workspaceId) throw new Error('No workspace context');

    const db = ctx.serverDB;
    const workspaceId = ctx.workspaceId;

    // Export agents (config only, no messages)
    const workspaceAgents = await db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        chatConfig: agents.chatConfig,
        description: agents.description,
        fewShots: agents.fewShots,
        model: agents.model,
        openingMessage: agents.openingMessage,
        openingQuestions: agents.openingQuestions,
        params: agents.params,
        plugins: agents.plugins,
        provider: agents.provider,
        slug: agents.slug,
        systemRole: agents.systemRole,
        tags: agents.tags,
        title: agents.title,
      })
      .from(agents)
      .where(and(eq(agents.workspaceId, workspaceId)));

    // Export knowledge base structure (without file contents)
    const workspaceKBs = await db
      .select({
        avatar: knowledgeBases.avatar,
        description: knowledgeBases.description,
        isPublic: knowledgeBases.isPublic,
        name: knowledgeBases.name,
        settings: knowledgeBases.settings,
        type: knowledgeBases.type,
      })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.workspaceId, workspaceId));

    // Export file metadata (without actual file content)
    const workspaceFiles = await db
      .select({
        fileType: files.fileType,
        name: files.name,
        size: files.size,
        source: files.source,
      })
      .from(files)
      .where(eq(files.workspaceId, workspaceId));

    return {
      agents: workspaceAgents,
      exportedAt: new Date().toISOString(),
      files: workspaceFiles,
      knowledgeBases: workspaceKBs,
      version: 1,
      workspaceId,
    };
  }),

  /**
   * Import workspace data (agents + knowledge bases)
   * Admin+ only
   */
  importData: dataProcedure
    .input(
      z.object({
        data: z.object({
          agents: z.array(z.record(z.any())).optional(),
          knowledgeBases: z.array(z.record(z.any())).optional(),
          version: z.number(),
        }),
        // 'skip' = skip duplicates, 'overwrite' = overwrite, 'rename' = rename with suffix
        onConflict: z.enum(['skip', 'overwrite', 'rename']).default('skip'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new Error('No workspace context');

      const { data, onConflict } = input;
      const results = { agentsImported: 0, kbsImported: 0 };

      // Import agents
      if (data.agents?.length) {
        for (const agentData of data.agents) {
          try {
            // Check for existing agent with same slug
            if (onConflict === 'skip' && agentData.slug) {
              const existing = await ctx.serverDB.query.agents.findFirst({
                where: and(
                  eq(agents.workspaceId, ctx.workspaceId),
                  eq(agents.slug, agentData.slug),
                ),
              });
              if (existing) continue;
            }

            const slug =
              onConflict === 'rename' && agentData.slug
                ? `${agentData.slug}-imported-${Date.now()}`
                : agentData.slug;

            // Only pick safe fields — prevent id/userId/workspaceId override
            await ctx.serverDB.insert(agents).values({
              avatar: agentData.avatar,
              backgroundColor: agentData.backgroundColor,
              chatConfig: agentData.chatConfig,
              description: agentData.description,
              fewShots: agentData.fewShots,
              model: agentData.model,
              openingMessage: agentData.openingMessage,
              openingQuestions: agentData.openingQuestions,
              params: agentData.params,
              plugins: agentData.plugins,
              provider: agentData.provider,
              slug,
              systemRole: agentData.systemRole,
              tags: agentData.tags,
              title: agentData.title,
              userId: ctx.userId,
              workspaceId: ctx.workspaceId,
            });
            results.agentsImported++;
          } catch {
            // Skip individual failures
          }
        }
      }

      // Import knowledge bases
      if (data.knowledgeBases?.length) {
        for (const kbData of data.knowledgeBases) {
          try {
            // Only pick safe fields
            await ctx.serverDB.insert(knowledgeBases).values({
              avatar: kbData.avatar,
              description: kbData.description,
              isPublic: kbData.isPublic,
              name: kbData.name,
              settings: kbData.settings,
              type: kbData.type,
              userId: ctx.userId,
              workspaceId: ctx.workspaceId,
            });
            results.kbsImported++;
          } catch {
            // Skip individual failures
          }
        }
      }

      return results;
    }),
});
