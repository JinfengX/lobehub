# Electron Panel Native Addon Design

> Plan 3 of Spotlight Window — NSPanel N-API addon for Raycast-like panel behavior.

## Goal

Replace Electron `BrowserWindow` panel-level workarounds with true NSPanel-grade behavior via a native N-API addon. The addon converts an existing `NSWindow` (obtained from `getNativeWindowHandle()`) into a floating panel with native drag and animated resize.

## Package

- **Name:** `@lobechat/electron-panel`
- **Location:** `packages/electron-panel/` (monorepo internal)
- **Platform:** macOS only; other platforms export no-op stubs
- **Build:** `prebuildify --napi` (arm64 + x64), loaded via `node-gyp-build`

## Architecture

### Strategy: Runtime Property Injection

Rather than isa-swizzling `NSWindow` → `NSPanel` (risky, breaks Electron internals), we set NSPanel-equivalent properties on the existing `NSWindow` at runtime. This covers all behaviors needed for Spotlight.

### API: ObjectWrap Instance

Follows the `electron-liquid-glass` pattern — `Napi::ObjectWrap<Panel>` bound once to a window handle, methods called on the instance.

## Package Structure

```
packages/electron-panel/
├── package.json
├── binding.gyp
├── src/
│   ├── panel.cc          # N-API bindings (Napi::ObjectWrap<Panel>)
│   └── panel_mac.mm      # Objective-C++ native implementation
├── js/
│   └── index.ts          # TypeScript wrapper + type exports
└── tsconfig.json
```

## Features

### 1. Panelize

Set NSPanel-grade properties on the `NSWindow`:

```objc
nsWindow.floatingPanel = YES;
nsWindow.becomesKeyOnlyIfNeeded = YES;
nsWindow.hidesOnDeactivate = NO;
nsWindow.collectionBehavior |=
    NSWindowCollectionBehaviorCanJoinAllSpaces |
    NSWindowCollectionBehaviorFullScreenAuxiliary;
nsWindow.level = NSFloatingWindowLevel;
```

**Effect:** Window floats above all windows, does not steal focus from other apps, does not hide when app loses focus, visible on all Spaces.

### 2. Native Drag

Replace `-webkit-app-region: drag` with a native transparent `NSView` overlay:

- Create a transparent `NSView` subclass positioned at a caller-specified rect
- Override `mouseDown:` / `mouseDragged:` to call `[nsWindow performWindowDragWithEvent:]`
- Supports dynamic rect updates (e.g., when window expands, drag region changes)
- `disableNativeDrag()` removes the overlay view

**Why native over CSS:** Smoother drag, no Electron event loop latency, consistent with macOS panel conventions.

### 3. Animated Resize

Replace `BrowserWindow.setBounds()` with native animated frame change:

```objc
[NSAnimationContext runAnimationGroup:^(NSAnimationContext *ctx) {
    ctx.duration = duration;
    ctx.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
    [[nsWindow animator] setFrame:newFrame display:YES];
}];
```

**Parameters:** `{ x, y, width, height }` target frame, optional `duration` (default 0.2s).

## N-API Binding Layer (panel.cc)

```cpp
class Panel : public Napi::ObjectWrap<Panel> {
    NSWindow* nsWindow_;  // Cached from handle Buffer in constructor

    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    Panel(const Napi::CallbackInfo& info);

    void Panelize(const Napi::CallbackInfo& info);
    void EnableNativeDrag(const Napi::CallbackInfo& info);   // {x, y, width, height}
    void DisableNativeDrag(const Napi::CallbackInfo& info);
    void AnimateResize(const Napi::CallbackInfo& info);       // {x, y, width, height}, duration?
};
```

**Handle resolution in constructor:**

```cpp
auto buffer = info[0].As<Napi::Buffer<unsigned char>>();
NSView* rootView = *reinterpret_cast<NSView**>(buffer.Data());
nsWindow_ = [rootView window];
```

**Thread safety:** All Objective-C calls dispatched via:

```cpp
dispatch_sync(dispatch_get_main_queue(), ^{ /* ... */ });
```

## TypeScript Wrapper (js/index.ts)

```typescript
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Panel {
  private _addon: NativePanel;

  constructor(handle: Buffer) {
    this._addon = new NativePanel(handle);
  }

  panelize(): void;
  enableNativeDrag(rect: Rect): void;
  disableNativeDrag(): void;
  animateResize(frame: Rect, duration?: number): void;
}
```

Non-macOS platforms export a `PanelStub` class with identical interface and no-op methods.

## Integration Points

| File                                  | Change                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/desktop/native-deps.config.mjs` | Add `@lobechat/electron-panel` to darwin native modules list                           |
| `electron.vite.config.ts`             | Covered by `getExternalDependencies()`                                                 |
| `electron-builder.mjs`                | Covered by `getAsarUnpackPatterns()`                                                   |
| `SpotlightCtr.ts`                     | Initialize `Panel` on window ready, call `panelize()` + `enableNativeDrag()`           |
| `Browser.ts`                          | Remove Spotlight-specific `setAlwaysOnTop`/`setVisibleOnAllWorkspaces` (addon handles) |
| Spotlight resize IPC                  | Replace `setBounds` with `panel.animateResize()`                                       |

## SpotlightCtr Integration

```typescript
import { Panel } from '@lobechat/electron-panel';

class SpotlightCtr {
  private panel?: Panel;

  onSpotlightReady() {
    const handle = this.spotlight.browserWindow.getNativeWindowHandle();
    this.panel = new Panel(handle);
    this.panel.panelize();
    this.panel.enableNativeDrag({ x: 0, y: 0, width: 680, height: 44 });
  }

  onResize(frame: Rect) {
    this.panel?.animateResize(frame);
  }
}
```

## Risks & Mitigations

| Risk                                                 | Mitigation                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `floatingPanel` property may not exist on `NSWindow` | Runtime check with `respondsToSelector:`, degrade gracefully                                   |
| Electron version upgrade breaks handle layout        | Buffer → NSView\*\* pattern is stable across Electron versions (same as electron-liquid-glass) |
| Native drag view conflicts with web content events   | Drag view is transparent, positioned only over non-interactive header area                     |
| `prebuildify` binary mismatch                        | CI builds for both arm64 and x64; fallback to runtime `node-gyp` compile                       |

## Out of Scope

- isa-swizzle NSWindow → NSPanel (rejected: too risky)
- Follow-cursor positioning (already implemented in SpotlightCtr)
- Window appearance/vibrancy (handled by electron-liquid-glass)
