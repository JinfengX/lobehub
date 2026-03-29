'use client';

import { Avatar, Tag } from '@lobehub/ui';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { useWorkspaceStore } from '@/store/workspace';

const roleColorMap: Record<string, string> = {
  admin: 'blue',
  editor: 'green',
  member: 'default',
  owner: 'gold',
};

const MemberList = memo(() => {
  const members = useWorkspaceStore((s) => s.members);

  if (members.length === 0) {
    return (
      <Flexbox align="center" justify="center" padding={24} style={{ opacity: 0.5 }}>
        No members
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8}>
      {members.map((member) => (
        <Flexbox
          align="center"
          gap={12}
          horizontal
          key={`${member.workspaceId}-${member.userId}`}
          padding={'8px 0'}
        >
          <Avatar avatar={'👤'} size={32} />
          <Flexbox flex={1} style={{ fontSize: 14 }}>
            {member.userId}
          </Flexbox>
          <Tag color={roleColorMap[member.role] || 'default'}>{member.role}</Tag>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

MemberList.displayName = 'MemberList';

export default MemberList;
