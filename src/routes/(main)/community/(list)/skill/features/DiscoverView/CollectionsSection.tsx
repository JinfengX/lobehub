'use client';

import { Block, Flexbox, Grid, Text } from '@lobehub/ui';
import { Tag } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import Title from '@/routes/(main)/community/components/Title';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    position: relative;

    height: 200px;
    padding: 24px;
    border-radius: 16px;
  `,
  card_dark: css`
    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
  `,
  card_light: css`
    background: linear-gradient(135deg, #f0f0f0 0%, #e5e5e5 100%);
  `,
  desc: css`
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
  `,
  desc_dark: css`
    color: rgb(255 255 255 / 65%);
  `,
  desc_light: css`
    color: rgb(0 0 0 / 65%);
  `,
  tag: css`
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  `,
  title: css`
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.3;
  `,
  title_dark: css`
    color: rgb(255 255 255 / 88%);
  `,
  title_light: css`
    color: rgb(0 0 0 / 88%);
  `,
}));

interface CollectionCardProps {
  description: string;
  title: string;
}

const CollectionCard = memo<CollectionCardProps>(({ title, description }) => {
  const { t } = useTranslation('discover');
  const isDark = useIsDark();

  return (
    <Block
      clickable
      className={cx(styles.card, isDark ? styles.card_dark : styles.card_light)}
      style={{ cursor: 'pointer' }}
    >
      <Flexbox gap={12} height={'100%'} justify={'flex-end'}>
        <Tag className={styles.tag} color={isDark ? 'default' : 'default'}>
          {t('skills.sections.collection')}
        </Tag>
        <Text className={cx(styles.title, isDark ? styles.title_dark : styles.title_light)}>
          {title}
        </Text>
        <Text className={cx(styles.desc, isDark ? styles.desc_dark : styles.desc_light)}>
          {description}
        </Text>
      </Flexbox>
    </Block>
  );
});

const CollectionsSection = memo(() => {
  const { t } = useTranslation('discover');

  const collections = [
    {
      description: t('skills.sections.collection1Desc'),
      title: t('skills.sections.collection1Title'),
    },
    {
      description: t('skills.sections.collection2Desc'),
      title: t('skills.sections.collection2Title'),
    },
  ];

  return (
    <Flexbox gap={16}>
      <Title>{t('skills.sections.collections')}</Title>
      <Grid maxItemWidth={400} rows={2} width={'100%'}>
        {collections.map((item) => (
          <CollectionCard key={item.title} {...item} />
        ))}
      </Grid>
    </Flexbox>
  );
});

export default CollectionsSection;
