import type { LocaleDefinition } from "../types.js";

export const englishLocale = {
  tag: "en",
  displayName: "English",
  direction: "ltr",
  resources: {
    "app.name": "OpenRecall",
    "nav.home": "Home",
    "nav.statistics": "Statistics",
    "nav.settings": "Settings",
    "section.create": "Create section",
    "section.name": "Section name",
    "section.cardsCount_one": "{{count}} card",
    "section.cardsCount_other": "{{count}} cards",
    "import.preview": "Preview import",
    "import.commit": "Import cards",
    "error.summary": "Please correct the following errors.",
  },
} as const satisfies LocaleDefinition;
