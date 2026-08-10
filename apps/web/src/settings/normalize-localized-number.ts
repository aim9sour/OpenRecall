const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeLocalizedNumber(value: string): string | null {
  if (/[٬,]/u.test(value)) return null;
  let normalized = "";
  for (const character of value.trim()) {
    const arabicIndex = ARABIC_INDIC.indexOf(character);
    const persianIndex = PERSIAN.indexOf(character);
    if (arabicIndex >= 0) normalized += String(arabicIndex);
    else if (persianIndex >= 0) normalized += String(persianIndex);
    else if (character === "٫") normalized += ".";
    else normalized += character;
  }
  return normalized;
}
