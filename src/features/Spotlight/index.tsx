import { lazy, memo, Suspense, useCallback } from 'react';

import InputArea from './InputArea';
import { useSpotlightStore } from './store';
import { useStyles } from './style';

const ChatView = lazy(() => import('./ChatView'));

const SpotlightWindow = memo(() => {
  const { styles } = useStyles();
  const viewState = useSpotlightStore((s) => s.viewState);
  const inputValue = useSpotlightStore((s) => s.inputValue);
  const setInputValue = useSpotlightStore((s) => s.setInputValue);
  const setViewState = useSpotlightStore((s) => s.setViewState);

  const handleHide = useCallback(() => {
    window.electronAPI?.invoke?.('spotlight:hide');
  }, []);

  const handleSubmit = useCallback(
    (value: string) => {
      if (value.startsWith('>')) {
        handleHide();
        return;
      }

      if (value.startsWith('@')) {
        return;
      }

      if (viewState === 'input') {
        window.electronAPI?.invoke?.('spotlight:resize', { height: 480, width: 680 });
        setViewState('chat');
      }

      setInputValue('');
    },
    [handleHide, viewState, setViewState, setInputValue],
  );

  return (
    <div className={styles.container}>
      <div className={styles.dragHandle} />

      {viewState === 'chat' && (
        <Suspense fallback={null}>
          <ChatView />
        </Suspense>
      )}

      <InputArea
        value={inputValue}
        onEscape={handleHide}
        onSubmit={handleSubmit}
        onValueChange={setInputValue}
      />
    </div>
  );
});

SpotlightWindow.displayName = 'SpotlightWindow';

export default SpotlightWindow;
