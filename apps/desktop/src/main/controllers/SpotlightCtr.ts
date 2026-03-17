import { Panel } from '@lobechat/electron-panel';
import { ipcMain, Menu, screen } from 'electron';

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
  private panel?: Panel;
  private panelInitialized = false;

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

    this.initializePanel(spotlight);

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

  @IpcMethod()
  async notifySync(params: { keys: string[] }) {
    this.app.browserManager.broadcastToOtherWindows('syncData', {
      keys: params.keys,
      source: 'spotlight',
    });
  }

  private initializePanel(
    spotlight: ReturnType<typeof this.app.browserManager.retrieveByIdentifier>,
  ) {
    if (this.panelInitialized) return;
    this.panelInitialized = true;

    try {
      const handle = spotlight.browserWindow.getNativeWindowHandle();
      this.panel = new Panel(handle);
      this.panel.panelize();
      this.panel.enableNativeDrag({ height: 44, width: 680, x: 0, y: 0 });
    } catch (e) {
      console.error('[SpotlightCtr] Failed to initialize native panel:', e);
    }
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
