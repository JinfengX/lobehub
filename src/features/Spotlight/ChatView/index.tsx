import { createStyles } from 'antd-style';
import { memo } from 'react';

import { useSpotlightStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  expandButton: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;
    align-self: flex-end;

    margin-block: 4px;
    margin-inline: 12px;
    padding-block: 4px;
    padding-inline: 8px;
    border: none;
    border-radius: 4px;

    font-size: 11px;
    color: ${token.colorTextTertiary};

    background: none;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  messageList: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 8px;
    padding-inline: 16px;
  `,
  placeholder: css`
    display: flex;
    align-items: center;
    justify-content: center;

    height: 100%;

    font-size: 13px;
    color: ${token.colorTextQuaternary};
  `,
}));

const ChatView = memo(() => {
  const { styles } = useStyles();
  const messages = useSpotlightStore((s) => s.messages);

  const handleExpandToMain = async () => {
    const { agentId, topicId, groupId } = useSpotlightStore.getState();
    if (!topicId) return;
    await window.electronAPI?.invoke?.('spotlight.expandToMain', { agentId, groupId, topicId });
  };

  return (
    <div className={styles.container}>
      <button className={styles.expandButton} onClick={handleExpandToMain}>
        ↗ Open in main window
      </button>
      <div className={styles.messageList}>
        {messages.length === 0 ? (
          <div className={styles.placeholder}>Messages will appear here</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 8, fontSize: 13 }}>
              <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong> {msg.content}
              {msg.loading && ' ▌'}
            </div>
          ))
        )}
      </div>
    </div>
  );
});

ChatView.displayName = 'ChatView';

export default ChatView;
