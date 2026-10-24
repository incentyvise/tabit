/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly NEXT_PUBLIC_PWA_URL?: string;
  readonly NEXT_PUBLIC_ADMIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
