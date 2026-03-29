import { randomBytes } from 'crypto';

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

const INVITATION_EXPIRY_DAYS = 7;

const wsModelProcedure = workspaceProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId) },
  });
});

const wsAdminModelProcedure = workspaceAdminProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId) },
  });
});

const wsOwnerModelProcedure = workspaceOwnerProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId) },
  });
});

const acceptInviteProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { workspaceModel: new WorkspaceModel(ctx.serverDB, ctx.userId) },
  });
});

export const workspaceMemberRouter = router({
  /**
   * Accept an invitation via token
   */
  acceptInvite: acceptInviteProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.workspaceModel.findInvitationByToken(input.token);

      if (!invitation) throw new Error('Invitation not found');
      if (invitation.status !== 'pending') throw new Error('Invitation is no longer valid');
      if (new Date() > invitation.expiresAt) {
        await ctx.workspaceModel.updateInvitationStatus(invitation.id, 'expired');
        throw new Error('Invitation has expired');
      }

      // Add user as member
      await ctx.workspaceModel.addMember({
        role: invitation.role as 'admin' | 'editor' | 'member',
        userId: ctx.userId,
        workspaceId: invitation.workspaceId,
      });

      // Mark invitation as accepted
      await ctx.workspaceModel.updateInvitationStatus(invitation.id, 'accepted');

      return { workspaceId: invitation.workspaceId };
    }),

  /**
   * Create an invitation (admin+)
   */
  invite: wsAdminModelProcedure
    .input(
      z.object({
        email: z.string().email().optional(),
        role: z.enum(['admin', 'editor', 'member']).default('member'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new Error('No workspace context');

      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

      return ctx.workspaceModel.createInvitation({
        email: input.email,
        expiresAt,
        role: input.role,
        status: 'pending',
        token,
        workspaceId: ctx.workspaceId,
      });
    }),

  /**
   * Leave workspace (member+, owner cannot leave)
   */
  leave: wsModelProcedure.mutation(async ({ ctx }) => {
    if (!ctx.workspaceId) throw new Error('No workspace context');
    if (ctx.workspaceRole === 'owner') throw new Error('Owner cannot leave workspace');

    return ctx.workspaceModel.removeMember(ctx.workspaceId, ctx.userId);
  }),

  /**
   * List workspace members
   */
  list: wsModelProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) return [];
    return ctx.workspaceModel.listMembers(ctx.workspaceId);
  }),

  /**
   * List pending invitations (admin+)
   */
  listInvitations: wsAdminModelProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) return [];
    return ctx.workspaceModel.listPendingInvitations(ctx.workspaceId);
  }),

  /**
   * Remove a member (admin+, cannot remove owner)
   */
  remove: wsAdminModelProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new Error('No workspace context');

      // Check the target is not the owner
      const target = await ctx.workspaceModel.getMember(ctx.workspaceId, input.userId);
      if (!target) throw new Error('Member not found');
      if (target.role === 'owner') throw new Error('Cannot remove workspace owner');

      return ctx.workspaceModel.removeMember(ctx.workspaceId, input.userId);
    }),

  /**
   * Revoke a pending invitation (admin+)
   */
  revokeInvitation: wsAdminModelProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.workspaceModel.updateInvitationStatus(input.id, 'revoked');
    }),

  /**
   * Update member role (owner only)
   */
  updateRole: wsOwnerModelProcedure
    .input(
      z.object({
        role: z.enum(['admin', 'editor', 'member']),
        userId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new Error('No workspace context');

      // Cannot change owner role
      const target = await ctx.workspaceModel.getMember(ctx.workspaceId, input.userId);
      if (!target) throw new Error('Member not found');
      if (target.role === 'owner') throw new Error('Cannot change owner role');

      return ctx.workspaceModel.updateMemberRole(ctx.workspaceId, input.userId, input.role);
    }),
});
