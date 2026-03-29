import type { WorkspaceState } from './initialState';

// ======= Workspace selectors ======= //

const activeWorkspace = (s: WorkspaceState) =>
  s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null;

const isTeamWorkspace = (s: WorkspaceState) => {
  const ws = activeWorkspace(s);
  return ws?.type === 'team';
};

const isPersonalWorkspace = (s: WorkspaceState) => {
  const ws = activeWorkspace(s);
  return ws?.type === 'personal';
};

const activeWorkspaceId = (s: WorkspaceState) => s.activeWorkspaceId;
const workspaces = (s: WorkspaceState) => s.workspaces;
const members = (s: WorkspaceState) => s.members;
const myRole = (s: WorkspaceState) => s.myRole;
const isLoading = (s: WorkspaceState) => s.isWorkspaceLoading;

// ======= Permission selectors ======= //

const ROLE_LEVEL: Record<string, number> = { member: 0, editor: 1, admin: 2, owner: 3 };

const isOwner = (s: WorkspaceState) => s.myRole === 'owner';
const isAdmin = (s: WorkspaceState) => ROLE_LEVEL[s.myRole] >= ROLE_LEVEL['admin'];
const isEditor = (s: WorkspaceState) => ROLE_LEVEL[s.myRole] >= ROLE_LEVEL['editor'];

const canManageMembers = (s: WorkspaceState) => isAdmin(s);
const canEditResources = (s: WorkspaceState) => isEditor(s);
const canManageWorkspace = (s: WorkspaceState) => isAdmin(s);
const canDeleteWorkspace = (s: WorkspaceState) => isOwner(s) && isTeamWorkspace(s);

export const workspaceSelectors = {
  activeWorkspace,
  activeWorkspaceId,
  canDeleteWorkspace,
  canEditResources,
  canManageMembers,
  canManageWorkspace,
  isAdmin,
  isEditor,
  isLoading,
  isOwner,
  isPersonalWorkspace,
  isTeamWorkspace,
  members,
  myRole,
  workspaces,
};
