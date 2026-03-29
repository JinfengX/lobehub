'use client';

import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useWorkspaceStore, workspaceSelectors } from '@/store/workspace';

import GeneralSettings from './GeneralSettings';
import MemberList from './MemberList';

const WorkspaceSettings = memo(() => {
  const isTeam = useWorkspaceStore(workspaceSelectors.isTeamWorkspace);

  return (
    <Flexbox gap={24}>
      <GeneralSettings />
      {isTeam && <MemberList />}
    </Flexbox>
  );
});

WorkspaceSettings.displayName = 'WorkspaceSettings';

export default WorkspaceSettings;
