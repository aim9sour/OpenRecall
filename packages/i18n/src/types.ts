export const SUPPORTED_LOCALES = ["ar", "en"] as const;

export type LocaleTag = (typeof SUPPORTED_LOCALES)[number];
export type TextDirection = "ltr" | "rtl";

export interface LocaleDefinition {
  readonly tag: LocaleTag;
  readonly displayName: string;
  readonly direction: TextDirection;
  readonly resources: Readonly<Record<string, string>>;
}
