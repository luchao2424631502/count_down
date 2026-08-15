/// <reference types="vite/client" />

// 可在此声明 PWA 相关类型/环境变量（骨架）
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
