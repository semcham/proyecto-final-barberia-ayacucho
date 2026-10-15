/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TERMS_VERSION?: string;
  readonly VITE_PRIVACY_POLICY_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
