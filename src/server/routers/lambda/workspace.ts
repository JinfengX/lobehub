import { z } from 'zod';

import { WorkspaceModel } from '@/database/models/workspace';
import {
  authedProcedure,
  router,
  workspaceAdminProcedure,
  workspaceOwnerProcedure,
  workspaceProcedure,
} from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const workspaceModelProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

const wsContextProcedure = workspaceProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

const wsAdminProcedure = workspaceAdminProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

const wsOwnerProcedure = workspaceOwnerProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const workspaceRouter = router({
  /**
   * Create a new team workspace
   */
  create: workspaceModelProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        name: z.string().min(1).max(255),
        slug: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.workspaceModel.create(input);
    }),

  /**
   * Delete a workspace (owner only, team workspace only)
   */
  delete: wsOwnerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify it's not a personal workspace
      const ws = await ctx.workspaceModel.findById(input.id);
      if (!ws) throw new Error('Workspace not found');
      if (ws.type === 'personal') throw new Error('Cannot delete personal workspace');

      return ctx.workspaceModel.delete(input.id);
    }),

  /**
   * Get workspace by ID
   */
  getById: wsContextProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) return null;
    return ctx.workspaceModel.findById(ctx.workspaceId);
  }),

  /**
   * Get workspace settings
   */
  getSettings: wsContextProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) return {};
    return ctx.workspaceModel.getSettings(ctx.workspaceId);
  }),

  /**
   * List all workspaces the user belongs to
   */
  list: workspaceModelProcedure.query(async ({ ctx }) => {
    return ctx.workspaceModel.listUserWorkspaces();
  }),

  /**
   * Update workspace info (admin+)
   */
  update: wsAdminProcedure
    .input(
      z.object({
        avatar: z.string().optional(),
        description: z.string().optional(),
        name: z.string().min(1).max(255).optional(),
        slug: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new Error('No workspace context');
      return ctx.workspaceModel.update(ctx.workspaceId, input);
    }),

  /**
   * Update workspace settings (admin+)
   */
  updateSettings: wsAdminProcedure
    .input(z.object({ settings: z.record(z.any()) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new Error('No workspace context');
      return ctx.workspaceModel.updateSettings(ctx.workspaceId, input.settings);
    }),
});
