import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';

import { workspaceAuditLogs } from '@/database/schemas';
import { router, workspaceAdminProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const auditProcedure = workspaceAdminProcedure.use(serverDatabase);

export const workspaceAuditLogRouter = router({
  query: auditProcedure
    .input(
      z.object({
        action: z.string().optional(),
        endDate: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        resourceType: z.string().optional(),
        startDate: z.string().optional(),
        userId: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.workspaceId) return { items: [], total: 0 };

      const conditions = [eq(workspaceAuditLogs.workspaceId, ctx.workspaceId)];

      if (input.action) conditions.push(eq(workspaceAuditLogs.action, input.action));
      if (input.resourceType)
        conditions.push(eq(workspaceAuditLogs.resourceType, input.resourceType));
      if (input.userId) conditions.push(eq(workspaceAuditLogs.userId, input.userId));
      if (input.startDate)
        conditions.push(gte(workspaceAuditLogs.createdAt, new Date(input.startDate)));
      if (input.endDate)
        conditions.push(lte(workspaceAuditLogs.createdAt, new Date(input.endDate)));

      const items = await ctx.serverDB.query.workspaceAuditLogs.findMany({
        limit: input.limit,
        offset: input.offset,
        orderBy: [desc(workspaceAuditLogs.createdAt)],
        where: and(...conditions),
      });

      return { items, total: items.length };
    }),
});

export type WorkspaceAuditLogRouter = typeof workspaceAuditLogRouter;
