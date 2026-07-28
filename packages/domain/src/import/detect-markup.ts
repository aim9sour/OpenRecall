const COMMENT_OR_DECLARATION = /<(?:!--|![A-Za-z]|\?)/i;
const OPEN_OR_CLOSE_TAG =
  /<\/?[A-Za-z][A-Za-z0-9:-]*(?=[\s/>])(?:[^<>]*?)>/;

export function containsMarkup(value: string): boolean {
  return COMMENT_OR_DECLARATION.test(value) || OPEN_OR_CLOSE_TAG.test(value);
}
