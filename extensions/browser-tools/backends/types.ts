export type ViewportPreset = 'desktop' | 'mobile';

export type ViewportOptions = {
  preset?: ViewportPreset;
  width?: number;
  height?: number;
};

export type ConsoleEntry = {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'page-error';
  text: string;
  url: string | null;
  timestamp: number;
};

export type BrowserStatus = {
  isOpen: boolean;
  url: string | null;
  viewport: { width: number; height: number } | null;
};

export type BrowserBackendName = 'agent-browser';

export type RenderedPage = {
  html: string;
  contentHtml?: string;
  title: string;
  url: string;
  backend: BrowserBackendName;
};

export type BrowserInteractParams = {
  action: 'click' | 'type' | 'scroll' | 'select' | 'hover' | 'wait';
  selector?: string;
  text?: string;
  value?: string;
  direction?: 'up' | 'down';
  amount?: number;
  timeout?: number;
};

export type BrowserScreenshotResult = {
  imageBase64: string;
  /** Mime type of the encoded image (JPEG after compression, PNG on fallback). */
  mimeType: 'image/jpeg' | 'image/png';
  /**
   * Base64 of the raw, uncapped PNG capture. Present only when the caller asked
   * for it via `screenshot({ capturePng: true })`, e.g. to save it to disk.
   */
  pngBase64?: string;
  url: string | null;
  viewport: { width: number; height: number } | null;
};

export interface BrowserBackend {
  readonly name: BrowserBackendName;
  isOpen(): boolean;
  getStatus(): BrowserStatus;
  /**
   * Bind a CDP connect target for this session. The first non-null target
   * wins; later calls (and null) are ignored. When bound, the backend connects
   * to the running browser instead of launching its own.
   */
  bindCdpTarget(target: string | null): void;
  navigate(
    url: string,
    options?: { preset?: ViewportPreset; width?: number; height?: number; waitMs?: number },
  ): Promise<{ url: string; viewport: { width: number; height: number } | null }>;
  setViewport(
    preset?: ViewportPreset,
    width?: number,
    height?: number,
  ): Promise<{ width: number; height: number }>;
  screenshot(options?: {
    url?: string;
    preset?: ViewportPreset;
    width?: number;
    height?: number;
    waitMs?: number;
    /** Also return the raw PNG bytes (base64) alongside the encoded image. */
    capturePng?: boolean;
  }): Promise<BrowserScreenshotResult>;
  interact(params: BrowserInteractParams): Promise<{
    url: string | null;
    viewport: { width: number; height: number } | null;
  }>;
  getConsoleEntries(options?: {
    level?: ConsoleEntry['level'][];
    clear?: boolean;
  }): Promise<ConsoleEntry[]>;
  renderPage(url: string): Promise<RenderedPage>;
  close(): Promise<void>;
}
