import { createStyles } from 'antd-style';
import { type ChangeEvent, type KeyboardEvent, useEffect, useRef } from 'react';

const useStyles = createStyles(({ css, token }) => ({
  attachment: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: none;
    border-radius: 8px;

    font-size: 14px;

    background: ${token.colorFillTertiary};

    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  container: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;

    padding-block: 12px 4px;
    padding-inline: 16px;

    -webkit-app-region: no-drag;
  `,
  textarea: css`
    resize: none;

    flex: 1;

    max-height: 96px;
    border: none;

    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    color: ${token.colorText};

    background: transparent;
    outline: none;

    &::placeholder {
      color: ${token.colorTextQuaternary};
    }
  `,
}));

interface TextareaProps {
  onEscape: () => void;
  onSubmit: (value: string) => void;
  onValueChange: (value: string) => void;
  value: string;
}

const SpotlightTextarea = ({ value, onValueChange, onSubmit, onEscape }: TextareaProps) => {
  const { styles } = useStyles();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handler = () => {
      textareaRef.current?.focus();
    };
    window.electron?.ipcRenderer.on('spotlightFocus', handler);
    return () => {
      window.electron?.ipcRenderer.removeListener('spotlightFocus', handler);
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (value) {
        onValueChange('');
      } else {
        onEscape();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && value.trim()) {
      e.preventDefault();
      onSubmit(value.trim());
    }
  };

  return (
    <div className={styles.container}>
      <textarea
        autoFocus
        className={styles.textarea}
        placeholder="Ask anything, > commands, @ search..."
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button className={styles.attachment} title="Attach file">
        📎
      </button>
    </div>
  );
};

export default SpotlightTextarea;
