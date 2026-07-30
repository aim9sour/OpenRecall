import type { LocaleDefinition } from "../types.js";
import { englishLocale } from "./en.js";

const ACCENTS: Readonly<Record<string, string>> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "đ",
  e: "é",
  f: "ƒ",
  g: "ğ",
  h: "ħ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ļ",
  m: "ɱ",
  n: "ñ",
  o: "ó",
  p: "þ",
  q: "ɋ",
  r: "ŕ",
  s: "š",
  t: "ŧ",
  u: "ú",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
};

function accent(character: string): string {
  const lower = character.toLowerCase();
  const replacement = ACCENTS[lower] ?? character;
  const cased =
    character === character.toUpperCase()
      ? replacement.toUpperCase()
      : replacement;
  return /[aeiou]/i.test(character)
    ? `${cased}${cased}`
    : cased;
}

export function pseudoLocalize(message: string): string {
  const transformed = message.replace(
    /\{\{[^{}]+\}\}|[A-Za-z]/g,
    (token) => (token.startsWith("{{") ? token : accent(token)),
  );
  return `［${transformed}］`;
}

export const pseudoEnglishLocale = {
  tag: "en-XA",
  displayName: "Pseudo English",
  direction: "ltr",
  formatLocale: "en-US",
  resources: Object.fromEntries(
    Object.entries(englishLocale.resources).map(([key, message]) => [
      key,
      pseudoLocalize(message),
    ]),
  ),
} as const satisfies LocaleDefinition<"en-XA">;
