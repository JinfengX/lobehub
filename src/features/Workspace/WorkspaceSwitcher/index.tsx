import { Avatar } from '@lobehub/ui';
import { Divider, Popover, Typography } from 'antd';
import { Plus, Settings } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useWorkspaceStore, workspaceSelectors } from '@/store/workspace';

import WorkspaceItem from './WorkspaceItem';

const WorkspaceSwitcher = memo(() => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);

  const activeWorkspace = useWorkspaceStore(workspaceSelectors.activeWorkspace);
  const workspaces = useWorkspaceStore(workspaceSelectors.workspaces);
  const activeWorkspaceId = useWorkspaceStore(workspaceSelectors.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);

  const handleSwitch = useCallback(
    (id: string) => {
      switchWorkspace(id);
      setOpen(false);
    },
    [switchWorkspace],
  );

  const content = (
    <Flexbox gap={4} style={{ maxWidth: 280, minWidth: 220 }}>
      <Flexbox padding={'8px 12px'}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Workspaces
        </Typography.Text>
      </Flexbox>

      {workspaces.map((ws) => (
        <WorkspaceItem
          isActive={ws.id === activeWorkspaceId}
          item={ws}
          key={ws.id}
          onClick={() => handleSwitch(ws.id)}
        />
      ))}

      <Divider style={{ margin: '4px 0' }} />

      <Flexbox
        align="center"
        gap={8}
        horizontal
        onClick={() => {
          // TODO: open create workspace modal
          setOpen(false);
        }}
        padding={'8px 12px'}
        style={{ cursor: 'pointer', opacity: 0.7 }}
      >
        <Plus size={16} />
        <Typography.Text>Create Workspace</Typography.Text>
      </Flexbox>

      <Flexbox
        align="center"
        gap={8}
        horizontal
        onClick={() => {
          // TODO: navigate to workspace settings
          setOpen(false);
        }}
        padding={'8px 12px'}
        style={{ cursor: 'pointer', opacity: 0.7 }}
      >
        <Settings size={16} />
        <Typography.Text>Workspace Settings</Typography.Text>
      </Flexbox>
    </Flexbox>
  );

  const displayName = activeWorkspace?.name || 'Personal';
  const displayAvatar =
    activeWorkspace?.avatar ||
    (activeWorkspace?.type === 'personal' ? '👤' : '🏢');

  return (
    <Popover
      content={content}
      onOpenChange={setOpen}
      open={open}
      placement="bottomLeft"
      trigger="click"
    >
      <Flexbox
        align="center"
        gap={8}
        horizontal
        style={{
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: 8,
        }}
      >
        <Avatar avatar={displayAvatar} size={24} />
        <Typography.Text ellipsis strong style={{ maxWidth: 120 }}>
          {displayName}
        </Typography.Text>
      </Flexbox>
    </Popover>
  );
});

WorkspaceSwitcher.displayName = 'WorkspaceSwitcher';

export default WorkspaceSwitcher;
