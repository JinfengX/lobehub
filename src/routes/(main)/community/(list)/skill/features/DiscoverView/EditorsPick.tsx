'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { Tag } from 'antd';
import { createStaticStyles, cx, responsive } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';

const styles = createStaticStyles(({ css }) => ({
  banner: css`
    position: relative;

    width: 100%;
    padding-block: 32px;
    padding-inline: 40px;
    border-radius: 16px;

    ${responsive.sm} {
      padding-block: 20px;
      padding-inline: 24px;
    }
  `,
  banner_dark: css`
    background: linear-gradient(135deg, #2a2a2a 0%, #3a3a3a 50%, #2a2a2a 100%);
  `,
  banner_light: css`
    background: linear-gradient(135deg, #e8e8e8 0%, #f5f5f5 50%, #e0e0e0 100%);
  `,
  description: css`
    margin: 0;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.6;

    ${responsive.sm} {
      font-size: 13px;
    }
  `,
  description_dark: css`
    color: rgb(255 255 255 / 65%);
  `,
  description_light: css`
    color: rgb(0 0 0 / 65%);
  `,
  tag: css`
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  `,
  title: css`
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    line-height: 1.3;

    ${responsive.sm} {
      font-size: 22px;
    }
  `,
  title_dark: css`
    color: rgb(255 255 255 / 88%);
  `,
  title_light: css`
    color: rgb(0 0 0 / 88%);
  `,
}));

const EditorsPick = memo(() => {
  const { t } = useTranslation('discover');
  const isDark = useIsDark();

  return (
    <Flexbox
      className={cx(styles.banner, isDark ? styles.banner_dark : styles.banner_light)}
      width={'100%'}
    >
      <Flexbox gap={12} style={{ maxWidth: 500, position: 'relative', zIndex: 1 }}>
        <Tag className={styles.tag} color={isDark ? 'default' : 'default'}>
          {t('skills.sections.editorsPick')}
        </Tag>
        <h2 className={cx(styles.title, isDark ? styles.title_dark : styles.title_light)}>
          {t('skills.sections.editorsPickTitle')}
        </h2>
        <p
          className={cx(
            styles.description,
            isDark ? styles.description_dark : styles.description_light,
          )}
        >
          {t('skills.sections.editorsPickDesc')}
        </p>
        <Flexbox horizontal gap={12} style={{ marginBlockStart: 8 }}>
          <Button style={{ background: isDark ? '#fff' : '#fff', color: '#000' }} type="primary">
            {t('skills.sections.getSkill')}
          </Button>
          <Button style={{ background: isDark ? '#333' : '#333', color: '#fff' }}>
            {t('skills.sections.learnMore')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default EditorsPick;
