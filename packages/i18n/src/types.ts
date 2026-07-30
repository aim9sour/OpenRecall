export const SUPPORTED_LOCALES = ["ar", "en"] as const;
export const DEVELOPMENT_LOCALES = ["en-XA"] as const;

export type ProductionLocaleTag = (typeof SUPPORTED_LOCALES)[number];
export type DevelopmentLocaleTag =
  (typeof DEVELOPMENT_LOCALES)[number];
export type LocaleTag =
  | ProductionLocaleTag
  | DevelopmentLocaleTag;
export type TextDirection = "ltr" | "rtl";

export function isProductionLocale(
  value: string,
): value is ProductionLocaleTag {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isDevelopmentLocale(
  value: string,
): value is DevelopmentLocaleTag {
  return (DEVELOPMENT_LOCALES as readonly string[]).includes(value);
}

export interface LocaleDefinition<
  Tag extends LocaleTag = LocaleTag,
> {
  readonly tag: Tag;
  readonly displayName: string;
  readonly direction: TextDirection;
  readonly formatLocale: string;
  readonly resources: Readonly<Record<string, string>>;
}
