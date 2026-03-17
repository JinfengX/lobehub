import { createStyles } from 'antd-style';
import { memo } from 'react';

import { useSpotlightStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  bar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 6px;
    padding-inline: 16px;
    border-block-start: 1px solid ${token.colorBorderSecondary};
  `,
  group: css`
    display: flex;
    gap: 12px;
    align-items: center;
  `,
  hint: css`
    display: flex;
    gap: 4px;
    align-items: center;

    font-size: 11px;
    color: ${token.colorTextQuaternary};
  `,
  key: css`
    padding-block: 1px;
    padding-inline: 5px;
    border-radius: 4px;

    font-size: 11px;
    color: ${token.colorTextTertiary};

    background: ${token.colorFillTertiary};
  `,
}));

const ShortcutBar = memo(() => {
  const { styles } = useStyles();
  const viewState = useSpotlightStore((s) => s.viewState);

  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <span className={styles.hint}>
          <kbd className={styles.key}>Esc</kbd> Close
        </span>
      </div>
      <div className={styles.group}>
        {viewState === 'chat' && (
          <span className={styles.hint}>
            <kbd className={styles.key}>⌘N</kbd> New Chat
          </span>
        )}
        <span className={styles.hint}>
          <kbd className={styles.key}>⌘V</kbd> Paste Image
        </span>
        <span className={styles.hint}>
          <kbd className={styles.key}>Enter</kbd> Send
        </span>
      </div>
    </div>
  );
});

ShortcutBar.displayName = 'ShortcutBar';

export default ShortcutBar;
