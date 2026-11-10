// Page globals used by the desktop E2E suite.
export {};

declare global {
  interface Window {
    /** Test seam installed by src/app/App.tsx. */
    __vuecraft: {
      open(path: string): Promise<void>;
      saveAs(path: string): Promise<boolean>;
      exportSvg(path: string): Promise<boolean>;
      queueFile(path: string): number;
    };
    __TAURI_INTERNALS__: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };
    __inputReady?: boolean;
    __frames: number[];
    __raf: number;
  }
  interface Performance {
    /** Chromium-only. */
    memory?: { usedJSHeapSize: number };
  }
}
