import { createStyles } from 'antd-style';
import { memo } from 'react';

import ModelChip from './ModelChip';
import PluginChips from './PluginChips';
import ShortcutBar from './ShortcutBar';
import SpotlightTextarea from './Textarea';

const useStyles = createStyles(({ css }) => ({
  chipsRow: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 4px 8px;
    padding-inline: 16px;
  `,
}));

interface InputAreaProps {
  onEscape: () => void;
  onSubmit: (value: string) => void;
  onValueChange: (value: string) => void;
  value: string;
}

const InputArea = memo<InputAreaProps>(({ value, onValueChange, onSubmit, onEscape }) => {
  const { styles } = useStyles();

  return (
    <>
      <SpotlightTextarea
        value={value}
        onEscape={onEscape}
        onSubmit={onSubmit}
        onValueChange={onValueChange}
      />
      <div className={styles.chipsRow}>
        <ModelChip />
        <PluginChips />
      </div>
      <ShortcutBar />
    </>
  );
});

InputArea.displayName = 'InputArea';

export default InputArea;
