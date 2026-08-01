import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  LOCALE_STORAGE_KEY,
  readRememberedLocale,
  rememberLocale,
  subscribeToRememberedLocale,
} from "./locale-storage.js";

describe("locale storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("remembers a supported production locale", () => {
    rememberLocale("en");

    expect(readRememberedLocale()).toBe("en");
  });

  it("falls back safely when storage is blocked or contains an invalid locale", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "not-a-locale");
    expect(readRememberedLocale()).toBe("ar");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readRememberedLocale()).toBe("ar");
  });

  it("ignores blocked writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => rememberLocale("en")).not.toThrow();
  });

  it("notifies only for another-tab changes to a supported production locale", () => {
    const onLocale = vi.fn();
    const unsubscribe = subscribeToRememberedLocale(onLocale);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LOCALE_STORAGE_KEY,
        newValue: "ar",
        storageArea: localStorage,
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LOCALE_STORAGE_KEY,
        newValue: "en-XA",
        storageArea: localStorage,
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "other-key",
        newValue: "en",
        storageArea: localStorage,
      }),
    );

    expect(onLocale).toHaveBeenCalledTimes(1);
    expect(onLocale).toHaveBeenCalledWith("ar");
    unsubscribe();
  });
});
