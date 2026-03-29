import { useTranslation } from 'react-i18next';

import WorkspaceSettings from '@/features/WorkspaceSettings';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.workspace')} />
      <WorkspaceSettings />
    </>
  );
};

export default Page;
