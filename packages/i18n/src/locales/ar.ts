import type { LocaleDefinition } from "../types.js";

export const arabicLocale = {
  tag: "ar",
  displayName: "العربية",
  direction: "rtl",
  resources: {
    "app.name": "أوبن ريكول",
    "nav.home": "الرئيسية",
    "nav.statistics": "الإحصاءات",
    "nav.settings": "الإعدادات",
    "section.create": "إنشاء قسم",
    "section.name": "اسم القسم",
    "section.cardsCount_zero": "لا توجد بطاقات",
    "section.cardsCount_one": "بطاقة واحدة",
    "section.cardsCount_two": "بطاقتان",
    "section.cardsCount_few": "{{count}} بطاقات",
    "section.cardsCount_many": "{{count}} بطاقة",
    "section.cardsCount_other": "{{count}} بطاقة",
    "import.preview": "معاينة الاستيراد",
    "import.commit": "استيراد البطاقات",
    "error.summary": "يرجى تصحيح الأخطاء التالية.",
  },
} as const satisfies LocaleDefinition;
