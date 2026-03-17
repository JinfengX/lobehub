# Spotlight UI Shell Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full UI shell for the Spotlight mini-window: InputArea (Textarea + Chips + ShortcutBar), ChatView skeleton, Zustand store, model selection via Menu.popup(), and updated window behavior.

**Architecture:** Replaces existing InputBox shell with multi-component InputArea, adds ChatView skeleton for Plan 2, introduces Spotlight-specific Zustand store for view state management, and updates main process for `type:'panel'` window config, expand-aware positioning, state-dependent blur, and model menu IPC.

**Tech Stack:** React 19, Zustand, antd-style, Electron Menu API, `@lobechat/electron-client-ipc`

**Spec:** `docs/superpowers/specs/2026-03-17-spotlight-ui-design.md`

**Scope:** Plan 1 of 2. This plan delivers a fully interactive UI shell. Plan 2 adds chat functionality (SpotlightMessage renderer, atomic send, syncData broadcast).

---

## File Structure

```
# Modified files
apps/desktop/src/main/appBrowsers.ts               — add type:'panel', height:120
apps/desktop/src/main/core/browser/Browser.ts       — expand-aware showAt, panel post-creation APIs
apps/desktop/src/main/controllers/SpotlightCtr.ts   — blur strategy, model menu IPC, expand resize
packages/electron-client-ipc/src/events/spotlight.ts — add syncData event type

# New files
src/features/Spotlight/store.ts                      — Zustand store
src/features/Spotlight/InputArea/index.tsx            — InputArea composition
src/features/Spotlight/InputArea/Textarea.tsx         — Auto-growing textarea
src/features/Spotlight/InputArea/ModelChip.tsx        — Model selector chip → Menu.popup()
src/features/Spotlight/InputArea/PluginChips.tsx      — Toggleable plugin chips
src/features/Spotlight/InputArea/ShortcutBar.tsx      — Keyboard hint bar
src/features/Spotlight/ChatView/index.tsx             — Chat view skeleton (Plan 2 fills in)

# Modified files (renderer)
src/features/Spotlight/index.tsx                     — SpotlightWindow with view state switching
src/features/Spotlight/style.ts                      — Updated styles for new layout

# Deleted files
src/features/Spotlight/InputBox.tsx                  — Replaced by InputArea
```

---

## Chunk 1: Main Process Updates

### Task 1: Update window config and Browser panel APIs

**Files:**

- Modify: `apps/desktop/src/main/appBrowsers.ts`

- Modify: `apps/desktop/src/main/core/browser/Browser.ts`

- [ ] **Step 1: Update spotlight definition in appBrowsers.ts**

Change the spotlight entry: `height: 56` → `height: 120`, add `type: 'panel'` (remove `resizable: false` since panel type handles this).

Current spotlight config (around line 36-50):

```typescript
  spotlight: {
    fullscreenable: false,
    hasShadow: true,
    height: 56,
    identifier: 'spotlight',
    keepAlive: true,
    maximizable: false,
    minimizable: false,
    path: '/desktop/spotlight',
    resizable: false,
    showOnInit: false,
    skipSplash: true,
    skipTaskbar: true,
    width: 680,
  },
```

Replace with:

```typescript
  spotlight: {
    fullscreenable: false,
    hasShadow: true,
    height: 120,
    identifier: 'spotlight',
    keepAlive: true,
    maximizable: false,
    minimizable: false,
    path: '/desktop/spotlight',
    resizable: false,
    showOnInit: false,
    skipSplash: true,
    skipTaskbar: true,
    type: 'panel',
    width: 680,
  },
```

- [ ] **Step 2: Add panel APIs in Browser.setupWindow()**

In `Browser.ts`, in the `setupWindow()` method, after the existing `setAlwaysOnTop` block for spotlight, add `setHiddenInMissionControl` and `setVisibleOnAllWorkspaces`:

Find:

```typescript
// Spotlight: float above all windows
if (this.identifier === 'spotlight') {
  browserWindow.setAlwaysOnTop(true, 'floating');
}
```

Replace with:

```typescript
// Spotlight: panel behavior
if (this.identifier === 'spotlight') {
  browserWindow.setAlwaysOnTop(true, 'floating');
  browserWindow.setHiddenInMissionControl(true);
  browserWindow.setVisibleOnAllWorkspaces(true);
}
```

- [ ] **Step 3: Change backgroundThrottling for spotlight**

In `Browser.ts`, in `createBrowserWindow()`, the webPreferences currently hardcodes `backgroundThrottling: false`. For spotlight, we want `true` (heavy components only load when visible). Modify the webPreferences section:

Find:

```typescript
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        preload: join(preloadDir, 'index.js'),
        sandbox: false,
        webviewTag: true,
      },
```

Replace with:

```typescript
      webPreferences: {
        backgroundThrottling: this.identifier === 'spotlight',
        contextIsolation: true,
        preload: join(preloadDir, 'index.js'),
        sandbox: false,
        webviewTag: true,
      },
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/appBrowsers.ts apps/desktop/src/main/core/browser/Browser.ts
git commit -m "feat(desktop): update spotlight to type:panel with panel APIs and backgroundThrottling"
```

---

### Task 2: Expand-aware positioning in Browser.showAt()

**Files:**

- Modify: `apps/desktop/src/main/core/browser/Browser.ts`

- [ ] **Step 1: Update showAt() for expand-aware boundary correction**

The current `showAt()` uses the window's current height for boundary correction. Since the window expands from 120→480, we need to reserve space for the max height. Also track expand direction.

Find the current `showAt` method and replace with:

```typescript
  /**
   * Show window at a specific screen coordinate.
   * Reserves space for maximum expanded height (480px) in boundary correction.
   * Stores expand direction for later use by resize.
   */
  private _expandDirection: 'down' | 'up' = 'down';

  get expandDirection() {
    return this._expandDirection;
  }

  showAt(point: { x: number; y: number }): void {
    const display = screen.getDisplayNearestPoint(point);
    const { width } = this.browserWindow.getBounds();
    const maxHeight = 480; // max expanded height for spotlight

    let x = Math.round(point.x - width / 2);
    let y = point.y + 8;

    const bounds = display.workArea;
    x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width));

    // Determine expand direction based on available space below cursor
    if (y + maxHeight > bounds.y + bounds.height) {
      // Not enough space below: position above cursor, expand upward
      y = point.y - 8 - this.browserWindow.getBounds().height;
      y = Math.max(bounds.y, y);
      this._expandDirection = 'up';
    } else {
      y = Math.max(bounds.y, y);
      this._expandDirection = 'down';
    }

    this.browserWindow.setPosition(x, y);
    this.browserWindow.show();
    this.browserWindow.focus();
  }
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main/core/browser/Browser.ts
git commit -m "feat(desktop): expand-aware positioning in Browser.showAt()"
```

---

### Task 3: Update SpotlightCtr — blur strategy, model menu IPC, expand resize

**Files:**

- Modify: `apps/desktop/src/main/controllers/SpotlightCtr.ts`

- [ ] **Step 1: Read the current SpotlightCtr.ts**

Read `apps/desktop/src/main/controllers/SpotlightCtr.ts` to understand the current state before editing.

- [ ] **Step 2: Rewrite SpotlightCtr with new capabilities**

Replace the full file with:

```typescript
import { Menu, ipcMain, screen } from 'electron';

import { BrowsersIdentifiers } from '@/appBrowsers';

import { ControllerModule, IpcMethod, shortcut } from './index';

interface ModelMenuItem {
  group?: string;
  label: string;
  provider: string;
  value: string;
}

export default class SpotlightCtr extends ControllerModule {
  static override readonly groupName = 'spotlight';

  private blurAttached = false;
  private crashRecoveryAttached = false;
  private menuOpen = false;
  private chatState = false;

  afterAppReady() {
    ipcMain.handle('spotlight:ready', () => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      spotlight?.markReady();
    });

    ipcMain.handle('spotlight:hide', () => {
      this.hideSpotlight();
    });

    ipcMain.handle('spotlight:resize', (_event, params: { height: number; width: number }) => {
      const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
      if (!spotlight) return;

      const currentBounds = spotlight.browserWindow.getBounds();
      const newBounds = {
        height: params.height,
        width: params.width,
        x: currentBounds.x,
        y: currentBounds.y,
      };

      // If expanding upward, adjust y so window grows upward
      if (spotlight.expandDirection === 'up' && params.height > currentBounds.height) {
        newBounds.y = currentBounds.y - (params.height - currentBounds.height);
      }

      spotlight.browserWindow.setBounds(newBounds, true);
    });

    ipcMain.handle('spotlight:setChatState', (_event, isChatting: boolean) => {
      this.chatState = isChatting;
    });
  }

  @shortcut('showSpotlight')
  async toggleSpotlight() {
    const spotlight = this.app.browserManager.retrieveByIdentifier(BrowsersIdentifiers.spotlight);

    this.ensureBlurHandler(spotlight);
    this.ensureCrashRecovery(spotlight);

    if (spotlight.browserWindow.isVisible()) {
      this.hideSpotlight();
      return;
    }

    await spotlight.whenReady();

    const cursor = screen.getCursorScreenPoint();
    spotlight.showAt(cursor);
    spotlight.broadcast('spotlightFocus');
  }

  @IpcMethod()
  async openModelMenu(items: ModelMenuItem[]) {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (!spotlight) return null;

    this.menuOpen = true;

    return new Promise<{ model: string; provider: string } | null>((resolve) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = [];
      let currentGroup: string | undefined;

      for (const item of items) {
        if (item.group && item.group !== currentGroup) {
          if (currentGroup !== undefined) {
            menuItems.push({ type: 'separator' });
          }
          menuItems.push({ enabled: false, label: item.group });
          currentGroup = item.group;
        }

        menuItems.push({
          click: () => resolve({ model: item.value, provider: item.provider }),
          label: item.label,
        });
      }

      const menu = Menu.buildFromTemplate(menuItems);

      menu.popup({
        callback: () => {
          this.menuOpen = false;
          // If nothing was selected, resolve null
          resolve(null);
        },
        window: spotlight.browserWindow,
      });
    });
  }

  @IpcMethod()
  async resize(params: { height: number; width: number }) {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (!spotlight) return;

    const currentBounds = spotlight.browserWindow.getBounds();
    const newBounds = {
      height: params.height,
      width: params.width,
      x: currentBounds.x,
      y: currentBounds.y,
    };

    if (spotlight.expandDirection === 'up' && params.height > currentBounds.height) {
      newBounds.y = currentBounds.y - (params.height - currentBounds.height);
    }

    spotlight.browserWindow.setBounds(newBounds, true);
  }

  @IpcMethod()
  async hide() {
    this.hideSpotlight();
  }

  @IpcMethod()
  async expandToMain(params: { agentId: string; groupId?: string; topicId: string }) {
    const mainWindow = this.app.browserManager.getMainWindow();
    const path = params.groupId
      ? `/group/${params.groupId}?topic=${params.topicId}`
      : `/agent/${params.agentId}?topic=${params.topicId}`;

    mainWindow.show();
    mainWindow.broadcast('navigate', { path });
    this.hideSpotlight();
  }

  private hideSpotlight() {
    const spotlight = this.app.browserManager.browsers.get(BrowsersIdentifiers.spotlight);
    if (spotlight) {
      spotlight.hide();
      this.chatState = false;
    }
  }

  private ensureBlurHandler(
    spotlight: ReturnType<typeof this.app.browserManager.retrieveByIdentifier>,
  ) {
    if (this.blurAttached) return;
    this.blurAttached = true;

    spotlight.browserWindow.on('blur', () => {
      // Don't hide if menu is open or in chat state
      if (this.menuOpen || this.chatState) return;
      if (spotlight.browserWindow.isVisible()) {
        spotlight.hide();
      }
    });
  }

  private ensureCrashRecovery(
    spotlight: ReturnType<typeof this.app.browserManager.retrieveByIdentifier>,
  ) {
    if (this.crashRecoveryAttached) return;
    this.crashRecoveryAttached = true;

    spotlight.browserWindow.webContents.on('render-process-gone', () => {
      console.error('[SpotlightCtr] Spotlight renderer crashed, reloading...');
      spotlight.resetReady();
      spotlight.loadUrl(spotlight.options.path).catch((e) => {
        console.error('[SpotlightCtr] Failed to reload after crash:', e);
      });
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/controllers/SpotlightCtr.ts
git commit -m "feat(desktop): SpotlightCtr with blur strategy, model menu IPC, expand-aware resize"
```

---

### Task 4: Add syncData broadcast event type

**Files:**

- Modify: `packages/electron-client-ipc/src/events/spotlight.ts`

- [ ] **Step 1: Update event types**

Replace the file content with:

```typescript
export interface SpotlightBroadcastEvents {
  /**
   * Ask spotlight renderer to focus the input box.
   */
  spotlightFocus: () => void;

  /**
   * Cross-window data sync notification.
   * Receiving windows should revalidate the specified SWR cache keys.
   */
  syncData: (data: { keys: string[]; source: string }) => void;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/electron-client-ipc/src/events/spotlight.ts
git commit -m "feat(electron-client-ipc): add syncData broadcast event for cross-window sync"
```

---

## Chunk 2: Spotlight Zustand Store + UI Components

### Task 5: Create Spotlight Zustand store

**Files:**

- Create: `src/features/Spotlight/store.ts`

- [ ] **Step 1: Create the store**

```typescript
import { create } from 'zustand';

interface SpotlightState {
  activePlugins: string[];
  agentId: string;
  currentModel: { model: string; provider: string };
  groupId?: string;
  inputValue: string;
  messages: { content: string; id: string; loading?: boolean; role: 'user' | 'assistant' }[];
  streaming: boolean;
  topicId: string | null;
  viewState: 'input' | 'chat';
}

interface SpotlightActions {
  reset: () => void;
  setCurrentModel: (model: { model: string; provider: string }) => void;
  setInputValue: (value: string) => void;
  setViewState: (state: 'input' | 'chat') => void;
  togglePlugin: (pluginId: string) => void;
}

const initialState: SpotlightState = {
  activePlugins: [],
  agentId: 'default',
  currentModel: { model: '', provider: '' },
  inputValue: '',
  messages: [],
  streaming: false,
  topicId: null,
  viewState: 'input',
};

export const useSpotlightStore = create<SpotlightState & SpotlightActions>()((set) => ({
  ...initialState,

  reset: () => set(initialState),

  setCurrentModel: (model) => set({ currentModel: model }),

  setInputValue: (value) => set({ inputValue: value }),

  setViewState: (viewState) => {
    set({ viewState });
    // Notify main process of chat state for blur strategy
    window.electronAPI?.invoke?.('spotlight:setChatState', viewState === 'chat');
  },

  togglePlugin: (pluginId) =>
    set((state) => ({
      activePlugins: state.activePlugins.includes(pluginId)
        ? state.activePlugins.filter((id) => id !== pluginId)
        : [...state.activePlugins, pluginId],
    })),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/features/Spotlight/store.ts
git commit -m "feat(spotlight): create Zustand store for spotlight state"
```

---

### Task 6: Create Textarea component

**Files:**

- Create: `src/features/Spotlight/InputArea/Textarea.tsx`

- [ ] **Step 1: Create Textarea with auto-grow**

```typescript
import { type ChangeEvent, type KeyboardEvent, useEffect, useRef } from 'react';
import { createStyles } from 'antd-style';

const useStyles = createStyles(({ css, token }) => ({
  attachment: css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    font-size: 14px;
    cursor: pointer;
    background: ${token.colorFillTertiary};
    border: none;
    border-radius: 8px;

    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  container: css`
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 12px 16px 4px;
    -webkit-app-region: no-drag;
  `,
  textarea: css`
    flex: 1;
    max-height: 96px;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
    color: ${token.colorText};
    resize: none;
    background: transparent;
    border: none;
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

  // Auto-focus on spotlightFocus IPC event
  useEffect(() => {
    const handler = () => {
      textareaRef.current?.focus();
    };
    window.electron?.ipcRenderer.on('spotlightFocus', handler);
    return () => {
      window.electron?.ipcRenderer.removeListener('spotlightFocus', handler);
    };
  }, []);

  // Auto-grow textarea height
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
        ref={textareaRef}
        autoFocus
        className={styles.textarea}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything, > commands, @ search..."
        rows={1}
        value={value}
      />
      <button className={styles.attachment} title="Attach file (⌘V)">
        📎
      </button>
    </div>
  );
};

export default SpotlightTextarea;
```

- [ ] **Step 2: Commit**

```bash
git add src/features/Spotlight/InputArea/Textarea.tsx
git commit -m "feat(spotlight): create auto-growing Textarea component"
```

---

### Task 7: Create ModelChip component

**Files:**

- Create: `src/features/Spotlight/InputArea/ModelChip.tsx`

- [ ] **Step 1: Create ModelChip with Menu.popup() IPC**

```typescript
import { createStyles } from 'antd-style';
import { memo, useCallback } from 'react';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';

import { useSpotlightStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  chip: css`
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 4px 10px;
    font-size: 12px;
    color: ${token.colorTextSecondary};
    cursor: pointer;
    background: ${token.colorFillTertiary};
    border: none;
    border-radius: 8px;

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
    font-size: 9px;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border-radius: 5px;
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
    // Serialize model list for main process Menu.popup()
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
```

- [ ] **Step 2: Commit**

```bash
git add src/features/Spotlight/InputArea/ModelChip.tsx
git commit -m "feat(spotlight): create ModelChip with Menu.popup() IPC"
```

---

### Task 8: Create PluginChips and ShortcutBar

**Files:**

- Create: `src/features/Spotlight/InputArea/PluginChips.tsx`

- Create: `src/features/Spotlight/InputArea/ShortcutBar.tsx`

- [ ] **Step 1: Create PluginChips**

```typescript
import { createStyles } from 'antd-style';
import { memo } from 'react';

import { useSpotlightStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  chip: css`
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 4px 10px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    background: ${token.colorFillQuaternary};
    border: 1px solid transparent;
    border-radius: 8px;
    transition: all 0.2s;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  chipActive: css`
    color: ${token.colorPrimary};
    background: ${token.colorPrimaryBg};
    border-color: ${token.colorPrimaryBorder};
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
          key={plugin.id}
          className={cx(styles.chip, activePlugins.includes(plugin.id) && styles.chipActive)}
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
```

- [ ] **Step 2: Create ShortcutBar**

```typescript
import { createStyles } from 'antd-style';
import { memo } from 'react';

import { useSpotlightStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  bar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 16px;
    border-top: 1px solid ${token.colorBorderSecondary};
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
    padding: 1px 5px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
    background: ${token.colorFillTertiary};
    border-radius: 4px;
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
```

- [ ] **Step 3: Commit**

```bash
git add src/features/Spotlight/InputArea/PluginChips.tsx src/features/Spotlight/InputArea/ShortcutBar.tsx
git commit -m "feat(spotlight): create PluginChips and ShortcutBar components"
```

---

### Task 9: Create InputArea composition and ChatView skeleton

**Files:**

- Create: `src/features/Spotlight/InputArea/index.tsx`

- Create: `src/features/Spotlight/ChatView/index.tsx`

- [ ] **Step 1: Create InputArea**

```typescript
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
    padding: 4px 16px 8px;
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
```

- [ ] **Step 2: Create ChatView skeleton**

This is a placeholder that Plan 2 will fill with SpotlightMessage and real chat functionality.

```typescript
import { createStyles } from 'antd-style';
import { memo } from 'react';

import { useSpotlightStore } from '../store';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  `,
  expandButton: css`
    display: flex;
    gap: 4px;
    align-items: center;
    align-self: flex-end;
    padding: 4px 8px;
    margin: 4px 12px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    background: none;
    border: none;
    border-radius: 4px;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  messageList: css`
    flex: 1;
    padding: 8px 16px;
    overflow-y: auto;
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
          <div className={styles.placeholder}>Messages will appear here (Plan 2)</div>
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
```

- [ ] **Step 3: Commit**

```bash
git add src/features/Spotlight/InputArea/index.tsx src/features/Spotlight/ChatView/index.tsx
git commit -m "feat(spotlight): create InputArea composition and ChatView skeleton"
```

---

### Task 10: Update SpotlightWindow and styles, delete InputBox

**Files:**

- Modify: `src/features/Spotlight/index.tsx`

- Modify: `src/features/Spotlight/style.ts`

- Delete: `src/features/Spotlight/InputBox.tsx`

- [ ] **Step 1: Update style.ts**

Replace the full file:

```typescript
import { createStyles } from 'antd-style';

export const useStyles = createStyles(({ css, token }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;
  `,
  dragHandle: css`
    height: 4px;
    cursor: default;
    -webkit-app-region: drag;
  `,
}));
```

- [ ] **Step 2: Rewrite SpotlightWindow (index.tsx)**

Replace the full file:

```typescript
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
        // Command mode — TODO Plan 2
        console.info('Command:', value.slice(1).trim());
        handleHide();
        return;
      }

      if (value.startsWith('@')) {
        // Search mode — TODO Plan 2
        console.info('Search:', value.slice(1).trim());
        return;
      }

      // Chat mode: expand window and switch to chat view
      if (viewState === 'input') {
        window.electronAPI?.invoke?.('spotlight:resize', { height: 480, width: 680 });
        setViewState('chat');
      }

      // TODO Plan 2: actual send message via chat service
      console.info('Chat:', value);
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
```

- [ ] **Step 3: Delete InputBox.tsx**

```bash
rm src/features/Spotlight/InputBox.tsx
```

- [ ] **Step 4: Lint modified files**

```bash
bunx eslint src/features/Spotlight/index.tsx src/features/Spotlight/style.ts --fix
```

- [ ] **Step 5: Commit**

```bash
git add src/features/Spotlight/index.tsx src/features/Spotlight/style.ts
git rm src/features/Spotlight/InputBox.tsx
git commit -m "feat(spotlight): SpotlightWindow with view state switching, replace InputBox with InputArea"
```

---

## Summary

| Task | Description                                                             | Files                                                |
| ---- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | Window config: type:panel, height:120, panel APIs, backgroundThrottling | `appBrowsers.ts`, `Browser.ts`                       |
| 2    | Expand-aware positioning                                                | `Browser.ts`                                         |
| 3    | SpotlightCtr: blur strategy, model menu, expand resize                  | `SpotlightCtr.ts`                                    |
| 4    | syncData broadcast event type                                           | `electron-client-ipc/spotlight.ts`                   |
| 5    | Spotlight Zustand store                                                 | `store.ts` (new)                                     |
| 6    | Textarea component                                                      | `InputArea/Textarea.tsx` (new)                       |
| 7    | ModelChip with Menu.popup()                                             | `InputArea/ModelChip.tsx` (new)                      |
| 8    | PluginChips + ShortcutBar                                               | `InputArea/PluginChips.tsx`, `ShortcutBar.tsx` (new) |
| 9    | InputArea composition + ChatView skeleton                               | `InputArea/index.tsx`, `ChatView/index.tsx` (new)    |
| 10   | SpotlightWindow rewrite + cleanup                                       | `index.tsx`, `style.ts`, delete `InputBox.tsx`       |
