import type zhTW from "./locales/zh-TW.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: {
      translation: typeof zhTW;
    };
  }
}
