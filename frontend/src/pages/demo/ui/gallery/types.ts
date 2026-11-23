import type { ComponentType } from "react";

/** 展示頁的一個元件;name 同時是卡片標題與目錄錨點(程式識別字,不翻譯) */
export interface Demo {
  name: string;
  /** 一句話說明用途或注意事項 */
  description?: string;
  Component: ComponentType;
}
