import { createStyles } from 'antd-style';
import { memo } from 'react';

import { useSpotlightStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  chip: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 10px;
    border: 1px solid transparent;
    border-radius: 8px;

    font-size: 12px;
    color: ${token.colorTextTertiary};

    background: ${token.colorFillQuaternary};

    transition: all 0.2s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  chipActive: css`
    border-color: ${token.colorPrimaryBorder};
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
  `,
  container: css`
    display: flex;
    gap: 6px;
    align-items: center;
  `,
}));

const AVAILABLE_PLUGINS = [
  { icon: '🌐', id: 'web-search', label: 'Web Search' },
  { icon: '📚', id: 'knowledge-base', label: 'KB' },
];

const PluginChips = memo(() => {
  const { styles, cx } = useStyles();
  const activePlugins = useSpotlightStore((s) => s.activePlugins);
  const togglePlugin = useSpotlightStore((s) => s.togglePlugin);

  return (
    <div className={styles.container}>
      {AVAILABLE_PLUGINS.map((plugin) => (
        <button
          className={cx(styles.chip, activePlugins.includes(plugin.id) && styles.chipActive)}
          key={plugin.id}
          onClick={() => togglePlugin(plugin.id)}
        >
          <span>{plugin.icon}</span>
          <span>{plugin.label}</span>
        </button>
      ))}
    </div>
  );
});

PluginChips.displayName = 'PluginChips';

export default PluginChips;
