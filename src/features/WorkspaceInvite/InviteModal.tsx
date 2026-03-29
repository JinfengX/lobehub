'use client';

import { Form, Input, Modal, Select } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';
import { useWorkspaceStore, workspaceSelectors } from '@/store/workspace';

interface InviteModalProps {
  onClose: () => void;
  open: boolean;
}

const InviteModal = memo<InviteModalProps>(({ open, onClose }) => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const activeId = useWorkspaceStore(workspaceSelectors.activeWorkspaceId);

  const handleInvite = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const result = await lambdaClient.workspaceMember.invite.mutate({
        email: values.email,
        role: values.role,
      });

      if (result?.token) {
        const inviteUrl = `${window.location.origin}/invite/${result.token}`;
        await navigator.clipboard.writeText(inviteUrl);
      }

      form.resetFields();
      onClose();
    } catch {
      // validation failed
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      confirmLoading={loading}
      onCancel={onClose}
      onOk={handleInvite}
      open={open}
      title={t('workspace.invite.title', { ns: 'setting' })}
    >
      <Form form={form} initialValues={{ role: 'member' }} layout="vertical">
        <Form.Item
          label={t('workspace.invite.email', { ns: 'setting' })}
          name="email"
          rules={[{ message: 'Please enter a valid email', type: 'email' }]}
        >
          <Input placeholder="user@example.com" />
        </Form.Item>
        <Form.Item label={t('workspace.invite.role', { ns: 'setting' })} name="role">
          <Select
            options={[
              { label: 'Member', value: 'member' },
              { label: 'Editor', value: 'editor' },
              { label: 'Admin', value: 'admin' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
});

InviteModal.displayName = 'InviteModal';

export default InviteModal;
