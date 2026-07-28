import { describe, expect, it } from "vitest";
import { API_VERSION, APP_NAME } from "./app-identity.js";

describe("application identity", () => {
  it("exposes the stable name and API version used at package boundaries", () => {
    expect(APP_NAME).toBe("OpenRecall");
    expect(API_VERSION).toBe(1);
  });
});
