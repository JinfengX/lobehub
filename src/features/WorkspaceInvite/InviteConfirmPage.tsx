import { Avatar } from '@lobehub/ui';
import { Button, Result, Spin, Typography } from 'antd';
import { memo, useCallback, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

interface InviteConfirmPageProps {
  token: string;
}

const InviteConfirmPage = memo<InviteConfirmPageProps>(({ token }) => {
  const [status, setStatus] = useState<'loading' | 'ready' | 'accepted' | 'error'>('ready');
  const [error, setError] = useState<string | null>(null);

  const handleAccept = useCallback(async () => {
    setStatus('loading');
    try {
      // TODO: call trpc workspaceMember.acceptInvite({ token })
      setStatus('accepted');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }, [token]);

  if (status === 'loading') {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100vh' }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  if (status === 'accepted') {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100vh' }}>
        <Result
          extra={
            <Button href="/" type="primary">
              Go to Workspace
            </Button>
          }
          status="success"
          subTitle="You can now access the workspace resources."
          title="Successfully Joined!"
        />
      </Flexbox>
    );
  }

  if (status === 'error') {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100vh' }}>
        <Result
          extra={
            <Button href="/" type="primary">
              Go Home
            </Button>
          }
          status="error"
          subTitle={error || 'The invitation may have expired or been revoked.'}
          title="Invitation Failed"
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox align="center" gap={24} justify="center" style={{ height: '100vh' }}>
      <Avatar avatar="🏢" size={64} />
      <Typography.Title level={3}>You&apos;ve been invited to a Workspace</Typography.Title>
      <Typography.Text type="secondary">
        Click below to accept the invitation and join the workspace.
      </Typography.Text>
      <Flexbox gap={12} horizontal>
        <Button onClick={handleAccept} size="large" type="primary">
          Accept Invitation
        </Button>
        <Button href="/" size="large">
          Decline
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

InviteConfirmPage.displayName = 'InviteConfirmPage';

export default InviteConfirmPage;
