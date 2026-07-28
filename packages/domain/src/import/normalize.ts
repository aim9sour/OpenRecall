export function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC");
}

export function normalizedDuplicateText(value: string): string {
  return normalizeText(value).trim();
}

export function duplicateKey(front: string, back: string): string {
  return `${normalizedDuplicateText(front)}\u0000${normalizedDuplicateText(back)}`;
}
