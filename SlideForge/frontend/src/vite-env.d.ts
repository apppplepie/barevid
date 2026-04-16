/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Electron preload 注入，仅桌面端存在 */
interface BarevidElectronAPI {
  readonly isDesktop: true;
  getBackendUrl?: () => Promise<string>;
  getApiSecrets?: () => Promise<{
    deepseekApiKey: string;
    doubaoTtsAppId: string;
    doubaoTtsAccessToken: string;
  }>;
  setApiSecrets?: (s: {
    deepseekApiKey?: string;
    doubaoTtsAppId?: string;
    doubaoTtsAccessToken?: string;
  }) => Promise<void>;
  openSecretsEnvFile?: () => Promise<void>;
  revealUserDataFolder?: () => Promise<void>;
  onOpenApiSecrets?: (cb: () => void) => () => void;
}

interface Window {
  electronAPI?: BarevidElectronAPI;
}
