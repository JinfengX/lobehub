import { and, count, eq, gte, lte, sql, sum } from 'drizzle-orm';
import { z } from 'zod';

import { agents, files, knowledgeBases, messages, workspaceMembers } from '@/database/schemas';
import { router, workspaceAdminProcedure, workspaceProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const usageProcedure = workspaceProcedure.use(serverDatabase);
const adminUsageProcedure = workspaceAdminProcedure.use(serverDatabase);

export const workspaceUsageRouter = router({
  /**
   * Get workspace overview stats (member+)
   */
  getOverview: usageProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) return null;

    const db = ctx.serverDB;
    const wsId = ctx.workspaceId;

    // Parallel queries for counts
    const [memberCount, agentCount, kbCount, fileStats] = await Promise.all([
      db
        .select({ count: count() })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, wsId)),
      db
        .select({ count: count() })
        .from(agents)
        .where(eq(agents.workspaceId, wsId)),
      db
        .select({ count: count() })
        .from(knowledgeBases)
        .where(eq(knowledgeBases.workspaceId, wsId)),
      db
        .select({ count: count(), totalSize: sum(files.size) })
        .from(files)
        .where(eq(files.workspaceId, wsId)),
    ]);

    return {
      agentCount: agentCount[0]?.count ?? 0,
      fileCount: fileStats[0]?.count ?? 0,
      knowledgeBaseCount: kbCount[0]?.count ?? 0,
      memberCount: memberCount[0]?.count ?? 0,
      storageUsedBytes: Number(fileStats[0]?.totalSize ?? 0),
    };
  }),

  /**
   * Get message usage by date range (admin+)
   */
  getMessageUsage: adminUsageProcedure
    .input(
      z.object({
        endDate: z.string(),
        startDate: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return [];

      const db = ctx.serverDB;

      return db
        .select({
          count: count(),
          date: sql<string>`DATE(${messages.createdAt})`.as('date'),
        })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, ctx.workspaceId),
            gte(messages.createdAt, new Date(input.startDate)),
            lte(messages.createdAt, new Date(input.endDate)),
          ),
        )
        .groupBy(sql`DATE(${messages.createdAt})`)
        .orderBy(sql`DATE(${messages.createdAt})`);
    }),

  /**
   * Get usage breakdown by member (admin+)
   */
  getUsageByMember: adminUsageProcedure
    .input(
      z.object({
        endDate: z.string().optional(),
        startDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.workspaceId) return [];

      const db = ctx.serverDB;

      const conditions = [eq(messages.workspaceId, ctx.workspaceId)];
      if (input.startDate) conditions.push(gte(messages.createdAt, new Date(input.startDate)));
      if (input.endDate) conditions.push(lte(messages.createdAt, new Date(input.endDate)));

      return db
        .select({
          messageCount: count(),
          userId: messages.userId,
        })
        .from(messages)
        .where(and(...conditions))
        .groupBy(messages.userId)
        .orderBy(sql`count(*) DESC`);
    }),
});
