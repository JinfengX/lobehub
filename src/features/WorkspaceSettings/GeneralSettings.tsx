'use client';

import { Form, type FormGroupItemType } from '@lobehub/ui';
import { Input } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceStore, workspaceSelectors } from '@/store/workspace';

const GeneralSettings = memo(() => {
  const { t } = useTranslation('setting');
  const activeWorkspace = useWorkspaceStore(workspaceSelectors.activeWorkspace);
  const isTeam = useWorkspaceStore(workspaceSelectors.isTeamWorkspace);

  if (!activeWorkspace) return null;

  const generalItems: FormGroupItemType = {
    children: [
      {
        children: <Input placeholder={t('workspace.name.placeholder', { ns: 'setting' })} />,
        label: t('workspace.name.title', { ns: 'setting' }),
        name: 'name',
      },
      {
        children: <Input.TextArea rows={3} />,
        label: t('workspace.description.title', { ns: 'setting' }),
        name: 'description',
      },
    ],
    title: t('workspace.general.title', { ns: 'setting' }),
  };

  return (
    <Form
      initialValues={{
        description: activeWorkspace.description ?? '',
        name: activeWorkspace.name,
      }}
      items={[generalItems]}
      itemsType="group"
    />
  );
});

GeneralSettings.displayName = 'GeneralSettings';

export default GeneralSettings;
