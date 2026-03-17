import { createStyles } from 'antd-style';
import { memo, useCallback } from 'react';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import { useSpotlightStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  chip: css`
    cursor: pointer;

    display: flex;
    gap: 6px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 10px;
    border: none;
    border-radius: 8px;

    font-size: 12px;
    color: ${token.colorTextSecondary};

    background: ${token.colorFillTertiary};

    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  icon: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 5px;

    font-size: 9px;
    font-weight: 600;
    color: white;

    background: linear-gradient(135deg, #6366f1, #8b5cf6);
  `,
  indicator: css`
    font-size: 10px;
    color: ${token.colorTextQuaternary};
  `,
}));

const ModelChip = memo(() => {
  const { styles } = useStyles();
  const currentModel = useSpotlightStore((s) => s.currentModel);
  const setCurrentModel = useSpotlightStore((s) => s.setCurrentModel);
  const enabledModels = useEnabledChatModels();

  const handleClick = useCallback(async () => {
    const items = enabledModels.flatMap((provider) =>
      provider.children.map((model) => ({
        group: provider.name || provider.id,
        label: model.displayName || model.id,
        provider: provider.id,
        value: model.id,
      })),
    );

    const result = await window.electronAPI?.invoke?.('spotlight.openModelMenu', items);
    if (result) {
      setCurrentModel(result);
    }
  }, [enabledModels, setCurrentModel]);

  const displayName = currentModel.model || 'Select Model';

  return (
    <button className={styles.chip} onClick={handleClick}>
      <span className={styles.icon}>AI</span>
      <span>{displayName}</span>
      <span className={styles.indicator}>▼</span>
    </button>
  );
});

ModelChip.displayName = 'ModelChip';

export default ModelChip;
