import { z } from 'zod';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import { router, workspaceAdminProcedure, workspaceProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const usageProcedure = workspaceProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { memberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId) },
  });
});

const adminUsageProcedure = workspaceAdminProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { memberModel: new WorkspaceMemberModel(ctx.serverDB, ctx.userId) },
  });
});

export const workspaceUsageRouter = router({
  getOverview: usageProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) return null;

    const members = await ctx.memberModel.listMembers(ctx.workspaceId);

    return {
      memberCount: members.length,
    };
  }),

  getUsageByMember: adminUsageProcedure
    .input(
      z.object({
        endDate: z.string().optional(),
        startDate: z.string().optional(),
      }),
    )
    .query(async ({ ctx }) => {
      // Placeholder — actual usage aggregation will be implemented
      // when workspace_spend_logs is available in Cloud DB
      return [];
    }),
});

export type WorkspaceUsageRouter = typeof workspaceUsageRouter;
