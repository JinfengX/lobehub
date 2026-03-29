import { and, eq } from 'drizzle-orm';

import {
  type NewWorkspace,
  type NewWorkspaceInvitation,
  type NewWorkspaceMember,
  type WorkspaceItem,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '../schemas';
import type { LobeChatDatabase } from '../type';

export class WorkspaceModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  // ======= Workspace CRUD ======= //

  create = async (params: Pick<NewWorkspace, 'name' | 'slug' | 'description' | 'avatar'>) => {
    const [workspace] = await this.db
      .insert(workspaces)
      .values({
        ...params,
        ownerId: this.userId,
        type: 'team',
      })
      .returning();

    // Auto-add creator as owner member
    await this.db.insert(workspaceMembers).values({
      role: 'owner',
      userId: this.userId,
      workspaceId: workspace.id,
    });

    return workspace;
  };

  findById = async (id: string) => {
    return this.db.query.workspaces.findFirst({
      where: eq(workspaces.id, id),
    });
  };

  findBySlug = async (slug: string) => {
    return this.db.query.workspaces.findFirst({
      where: eq(workspaces.slug, slug),
    });
  };

  /**
   * List all workspaces the current user belongs to
   */
  listUserWorkspaces = async () => {
    const members = await this.db.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.userId, this.userId),
    });

    if (members.length === 0) return [];

    const workspaceIds = members.map((m) => m.workspaceId);

    const results = await this.db
      .select()
      .from(workspaces)
      .where(
        workspaceIds.length === 1
          ? eq(workspaces.id, workspaceIds[0])
          : // For multiple IDs, use IN clause via sql
            eq(workspaces.id, workspaceIds[0]), // simplified — will enhance with inArray
      );

    // Actually use proper query for multiple:
    const allWorkspaces = [];
    for (const wsId of workspaceIds) {
      const ws = await this.db.query.workspaces.findFirst({
        where: eq(workspaces.id, wsId),
      });
      if (ws) allWorkspaces.push(ws);
    }

    return allWorkspaces;
  };

  update = async (id: string, value: Partial<Pick<WorkspaceItem, 'name' | 'slug' | 'description' | 'avatar' | 'settings'>>) => {
    return this.db
      .update(workspaces)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(workspaces.id, id))
      .returning();
  };

  delete = async (id: string) => {
    // Only allow deleting team workspaces, not personal
    return this.db
      .delete(workspaces)
      .where(and(eq(workspaces.id, id), eq(workspaces.type, 'team')));
  };

  getPersonalWorkspace = async () => {
    return this.db.query.workspaces.findFirst({
      where: and(eq(workspaces.ownerId, this.userId), eq(workspaces.type, 'personal')),
    });
  };

  getSettings = async (id: string) => {
    const ws = await this.findById(id);
    return ws?.settings ?? {};
  };

  updateSettings = async (id: string, settings: Record<string, any>) => {
    return this.db
      .update(workspaces)
      .set({ settings, updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  };

  // ======= Member Management ======= //

  listMembers = async (workspaceId: string) => {
    return this.db.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.workspaceId, workspaceId),
    });
  };

  getMember = async (workspaceId: string, userId: string) => {
    return this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    });
  };

  addMember = async (params: NewWorkspaceMember) => {
    const [member] = await this.db
      .insert(workspaceMembers)
      .values(params)
      .onConflictDoNothing()
      .returning();

    return member;
  };

  removeMember = async (workspaceId: string, userId: string) => {
    return this.db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
  };

  updateMemberRole = async (
    workspaceId: string,
    userId: string,
    role: 'admin' | 'editor' | 'member',
  ) => {
    return this.db
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
  };

  // ======= Invitations ======= //

  createInvitation = async (params: Omit<NewWorkspaceInvitation, 'inviterId'>) => {
    const [invitation] = await this.db
      .insert(workspaceInvitations)
      .values({ ...params, inviterId: this.userId })
      .returning();

    return invitation;
  };

  findInvitationByToken = async (token: string) => {
    return this.db.query.workspaceInvitations.findFirst({
      where: eq(workspaceInvitations.token, token),
    });
  };

  listPendingInvitations = async (workspaceId: string) => {
    return this.db.query.workspaceInvitations.findMany({
      where: and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.status, 'pending'),
      ),
    });
  };

  updateInvitationStatus = async (id: string, status: 'accepted' | 'expired' | 'revoked') => {
    return this.db
      .update(workspaceInvitations)
      .set({ status })
      .where(eq(workspaceInvitations.id, id));
  };
}
