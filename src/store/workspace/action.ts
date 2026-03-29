import type { StateCreator } from 'zustand/vanilla';

import type { WorkspaceRole } from '@/libs/trpc/lambda/middleware/workspace';

import type { WorkspaceItem, WorkspaceMemberItem, WorkspaceState } from './initialState';

const WORKSPACE_ID_KEY = 'lobe-active-workspace-id';

export interface WorkspaceAction {
  // Workspace CRUD
  createWorkspace: (params: { description?: string; name: string }) => Promise<WorkspaceItem | null>;
  deleteWorkspace: (id: string) => Promise<void>;
  fetchWorkspaces: () => Promise<void>;
  switchWorkspace: (id: string) => void;
  updateWorkspace: (params: {
    avatar?: string;
    description?: string;
    name?: string;
  }) => Promise<void>;

  // Member management
  fetchMembers: () => Promise<void>;
  inviteMember: (email: string, role: WorkspaceRole) => Promise<string>;
  removeMember: (userId: string) => Promise<void>;
  updateMemberRole: (userId: string, role: WorkspaceRole) => Promise<void>;

  // Internal
  _restoreActiveWorkspace: () => void;
}

export const createWorkspaceSlice: StateCreator<
  WorkspaceState & WorkspaceAction,
  [['zustand/devtools', never]]
> = (set, get) => ({
  // ======= Workspace CRUD ======= //

  createWorkspace: async (params) => {
    // TODO: call trpc workspace.create
    // For now, return null as placeholder
    return null;
  },

  deleteWorkspace: async (id) => {
    // TODO: call trpc workspace.delete
    const { workspaces, activeWorkspaceId } = get();
    const filtered = workspaces.filter((w) => w.id !== id);
    set({ workspaces: filtered });

    // If deleted the active one, switch to personal
    if (activeWorkspaceId === id) {
      const personal = filtered.find((w) => w.type === 'personal');
      if (personal) {
        get().switchWorkspace(personal.id);
      }
    }
  },

  fetchWorkspaces: async () => {
    set({ isWorkspaceLoading: true });
    // TODO: call trpc workspace.list
    // For now, set loading to false
    set({ isWorkspaceLoading: false });
  },

  switchWorkspace: (id) => {
    const { workspaces, members } = get();
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;

    // Find my role in this workspace
    // TODO: this should come from the workspace.list API response
    const myMember = members.find((m) => m.workspaceId === id);
    const myRole: WorkspaceRole = myMember?.role ?? (ws.type === 'personal' ? 'owner' : 'member');

    set({
      activeWorkspaceId: id,
      myRole,
    });

    // Persist to localStorage
    try {
      localStorage.setItem(WORKSPACE_ID_KEY, id);
    } catch {
      // Ignore storage errors
    }
  },

  updateWorkspace: async (params) => {
    // TODO: call trpc workspace.update
    const { activeWorkspaceId, workspaces } = get();
    if (!activeWorkspaceId) return;

    set({
      workspaces: workspaces.map((w) =>
        w.id === activeWorkspaceId ? { ...w, ...params } : w,
      ),
    });
  },

  // ======= Member Management ======= //

  fetchMembers: async () => {
    // TODO: call trpc workspaceMember.list
  },

  inviteMember: async (_email, _role) => {
    // TODO: call trpc workspaceMember.invite
    return '';
  },

  removeMember: async (_userId) => {
    // TODO: call trpc workspaceMember.remove
    const { activeWorkspaceId, members } = get();
    if (!activeWorkspaceId) return;
    set({
      members: members.filter(
        (m) => !(m.workspaceId === activeWorkspaceId && m.userId === _userId),
      ),
    });
  },

  updateMemberRole: async (_userId, _role) => {
    // TODO: call trpc workspaceMember.updateRole
  },

  // ======= Internal ======= //

  _restoreActiveWorkspace: () => {
    try {
      const savedId = localStorage.getItem(WORKSPACE_ID_KEY);
      if (savedId) {
        set({ activeWorkspaceId: savedId });
      }
    } catch {
      // Ignore storage errors
    }
  },
});
