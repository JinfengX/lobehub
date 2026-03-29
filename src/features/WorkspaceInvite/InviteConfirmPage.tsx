'use client';

import { Button, Result, Spin } from 'antd';
import { memo, useCallback, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import { lambdaClient } from '@/libs/trpc/client';
import { useWorkspaceStore } from '@/store/workspace';

interface InviteConfirmPageProps {
  token: string;
}

const InviteConfirmPage = memo<InviteConfirmPageProps>(({ token }) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);

  const handleAccept = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await lambdaClient.workspaceMember.acceptInvite.mutate({ token });
      setStatus('success');

      if (result?.workspaceId) {
        switchWorkspace(result.workspaceId);
      }
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error?.message || 'Failed to accept invitation');
    }
  }, [token, switchWorkspace]);

  if (status === 'loading') {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100vh' }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  if (status === 'success') {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100vh' }}>
        <Result
          extra={<Button href="/" type="primary">Go to Workspace</Button>}
          status="success"
          subTitle="You have been added to the workspace."
          title="Invitation Accepted"
        />
      </Flexbox>
    );
  }

  if (status === 'error') {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100vh' }}>
        <Result
          extra={<Button href="/">Go Home</Button>}
          status="error"
          subTitle={errorMessage}
          title="Invitation Failed"
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox align="center" justify="center" style={{ height: '100vh' }}>
      <Result
        extra={
          <Button onClick={handleAccept} type="primary">
            Accept Invitation
          </Button>
        }
        status="info"
        subTitle="You have been invited to join a workspace."
        title="Workspace Invitation"
      />
    </Flexbox>
  );
});

InviteConfirmPage.displayName = 'InviteConfirmPage';

export default InviteConfirmPage;
