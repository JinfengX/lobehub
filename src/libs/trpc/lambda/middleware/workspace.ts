import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { workspaceMembers, workspaces } from '@/database/schemas';

import { trpc } from '../init';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'member';

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  member: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/**
 * Check if currentRole meets the minimum required role level
 */
export const hasMinRole = (currentRole: WorkspaceRole, minRole: WorkspaceRole): boolean => {
  return ROLE_HIERARCHY[currentRole] >= ROLE_HIERARCHY[minRole];
};

/**
 * Workspace middleware — resolves workspaceId from request context
 * and validates user membership. Injects workspaceId and workspaceRole into context.
 *
 * If no X-Workspace-Id header is present, falls back to the user's personal workspace.
 */
export const workspaceAuth = trpc.middleware(async (opts) => {
  const { ctx } = opts;

  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const serverDB = await getServerDB();

  // Get workspaceId from context (extracted from X-Workspace-Id header in createLambdaContext)
  let workspaceId = ctx.workspaceId as string | undefined;

  // Fall back to personal workspace if no workspace specified
  if (!workspaceId) {
    const personalWs = await serverDB.query.workspaces.findFirst({
      where: and(eq(workspaces.ownerId, ctx.userId), eq(workspaces.type, 'personal')),
    });

    if (!personalWs) {
      // No personal workspace yet — pre-migration user, proceed with owner-level access
      return opts.next({
        ctx: {
          userId: ctx.userId,
          workspaceId: null as unknown as string,
          workspaceRole: 'owner' as WorkspaceRole,
        },
      });
    }

    workspaceId = personalWs.id;
  }

  // Validate membership
  const member = await serverDB.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, ctx.userId),
    ),
  });

  if (!member) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not a member of this workspace',
    });
  }

  return opts.next({
    ctx: {
      userId: ctx.userId,
      workspaceId,
      workspaceRole: member.role as WorkspaceRole,
    },
  });
});

/**
 * Create a role-gated middleware that requires a minimum workspace role
 */
export const requireWorkspaceRole = (minRole: WorkspaceRole) =>
  trpc.middleware(async (opts) => {
    const { ctx } = opts as { ctx: { workspaceRole: WorkspaceRole } };

    if (!ctx.workspaceRole || !hasMinRole(ctx.workspaceRole, minRole)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `This action requires at least ${minRole} role`,
      });
    }

    return opts.next();
  });
