import { localeDefinitions } from "./locale-definitions.js";
import type {
  LocaleDefinition,
  LocaleTag,
} from "./types.js";

const registry = new Map<LocaleTag, LocaleDefinition>(
  Object.values(localeDefinitions).map((definition) => [
    definition.tag,
    definition,
  ]),
);

function validateDefinition(definition: LocaleDefinition): void {
  if (
    definition.tag.trim().length === 0 ||
    definition.displayName.trim().length === 0 ||
    definition.formatLocale.trim().length === 0 ||
    (definition.direction !== "ltr" &&
      definition.direction !== "rtl") ||
    Object.keys(definition.resources).length === 0 ||
    Object.values(definition.resources).some(
      (message) => message.trim().length === 0,
    )
  ) {
    throw new Error("LOCALE_DEFINITION_INVALID");
  }
  try {
    Intl.getCanonicalLocales(definition.formatLocale);
  } catch {
    throw new Error("LOCALE_DEFINITION_INVALID");
  }
}

export function registerLocale(
  definition: LocaleDefinition,
): void {
  validateDefinition(definition);
  if (registry.has(definition.tag)) {
    throw new Error("LOCALE_ALREADY_REGISTERED");
  }
  registry.set(definition.tag, definition);
}

export function getLocaleDefinition(
  tag: LocaleTag,
): LocaleDefinition {
  const definition = registry.get(tag);
  if (definition === undefined) {
    throw new Error("LOCALE_NOT_REGISTERED");
  }
  return definition;
}

export function registeredLocaleTags(): readonly LocaleTag[] {
  return [...registry.keys()];
}
