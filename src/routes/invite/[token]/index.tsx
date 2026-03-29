import { memo } from 'react';
import { useParams } from 'react-router-dom';

import { InviteConfirmPage } from '@/features/WorkspaceInvite';

const InvitePage = memo(() => {
  const { token } = useParams<{ token: string }>();

  if (!token) return null;

  return <InviteConfirmPage token={token} />;
});

InvitePage.displayName = 'InvitePage';

export default InvitePage;
