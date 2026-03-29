import type { WorkspaceRole } from '@/libs/trpc/lambda/middleware/workspace';

export interface WorkspaceItem {
  avatar?: string | null;
  description?: string | null;
  id: string;
  name: string;
  slug: string;
  type: 'personal' | 'team';
}

export interface WorkspaceMemberItem {
  joinedAt: string;
  role: WorkspaceRole;
  userId: string;
  workspaceId: string;
}

export interface WorkspaceState {
  activeWorkspaceId: string | null;
  isWorkspaceLoading: boolean;
  members: WorkspaceMemberItem[];
  myRole: WorkspaceRole;
  workspaces: WorkspaceItem[];
}

export const initialWorkspaceState: WorkspaceState = {
  activeWorkspaceId: null,
  isWorkspaceLoading: false,
  members: [],
  myRole: 'owner',
  workspaces: [],
};
