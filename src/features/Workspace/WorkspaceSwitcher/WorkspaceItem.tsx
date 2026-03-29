import { Avatar } from '@lobehub/ui';
import { Typography } from 'antd';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import type { WorkspaceItem as WorkspaceItemType } from '@/store/workspace';

interface WorkspaceItemProps {
  isActive?: boolean;
  item: WorkspaceItemType;
  onClick?: () => void;
}

const WorkspaceItem = memo<WorkspaceItemProps>(({ item, isActive, onClick }) => {
  return (
    <Flexbox
      align="center"
      gap={12}
      horizontal
      onClick={onClick}
      padding={'8px 12px'}
      style={{
        borderRadius: 8,
        cursor: 'pointer',
        opacity: isActive ? 1 : 0.8,
      }}
    >
      <Avatar
        avatar={item.avatar || (item.type === 'personal' ? '👤' : '🏢')}
        size={32}
        style={{ flexShrink: 0 }}
      />
      <Flexbox gap={2} style={{ flex: 1, overflow: 'hidden' }}>
        <Typography.Text ellipsis strong={isActive}>
          {item.name}
        </Typography.Text>
        {item.description && (
          <Typography.Text ellipsis type="secondary" style={{ fontSize: 12 }}>
            {item.description}
          </Typography.Text>
        )}
      </Flexbox>
      {isActive && <span style={{ color: 'var(--lobe-color-primary)', fontSize: 16 }}>✓</span>}
    </Flexbox>
  );
});

WorkspaceItem.displayName = 'WorkspaceItem';

export default WorkspaceItem;
