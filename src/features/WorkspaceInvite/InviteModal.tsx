import { Button, Form, Input, Modal, Select, message } from 'antd';
import { memo, useCallback, useState } from 'react';

import type { WorkspaceRole } from '@/libs/trpc/lambda/middleware/workspace';
import { useWorkspaceStore } from '@/store/workspace';

interface InviteModalProps {
  onClose: () => void;
  open: boolean;
}

const ROLE_OPTIONS = [
  { label: 'Admin', value: 'admin' },
  { label: 'Editor', value: 'editor' },
  { label: 'Member', value: 'member' },
];

const InviteModal = memo<InviteModalProps>(({ open, onClose }) => {
  const inviteMember = useWorkspaceStore((s) => s.inviteMember);
  const [loading, setLoading] = useState(false);

  const handleInvite = useCallback(
    async (values: { email: string; role: WorkspaceRole }) => {
      setLoading(true);
      try {
        await inviteMember(values.email, values.role);
        message.success('Invitation sent');
        onClose();
      } catch {
        message.error('Failed to send invitation');
      } finally {
        setLoading(false);
      }
    },
    [inviteMember, onClose],
  );

  return (
    <Modal
      onCancel={onClose}
      open={open}
      title="Invite Member"
      footer={null}
    >
      <Form initialValues={{ role: 'member' }} layout="vertical" onFinish={handleInvite}>
        <Form.Item
          label="Email"
          name="email"
          rules={[
            { required: true, message: 'Please enter email' },
            { type: 'email', message: 'Invalid email' },
          ]}
        >
          <Input placeholder="user@example.com" />
        </Form.Item>

        <Form.Item label="Role" name="role">
          <Select options={ROLE_OPTIONS} />
        </Form.Item>

        <Form.Item>
          <Button block htmlType="submit" loading={loading} type="primary">
            Send Invitation
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
});

InviteModal.displayName = 'InviteModal';

export default InviteModal;
