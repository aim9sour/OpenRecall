import { describe, expect, it } from "vitest";
import { createApiClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("API client", () => {
  it("shares one in-memory bootstrap request", async () => {
    let requestCount = 0;
    const api = createApiClient(async () => {
      requestCount += 1;
      return jsonResponse({
        apiVersion: 1,
        csrfToken: "one-token",
        locale: "en",
      });
    });

    const [first, second] = await Promise.all([
      api.bootstrap(),
      api.bootstrap(),
    ]);

    expect(first).toEqual(second);
    expect(requestCount).toBe(1);
  });

  it("refreshes bootstrap once after a rejected mutation", async () => {
    const mutationTokens: string[] = [];
    let bootstrapCount = 0;
    let mutationCount = 0;
    const api = createApiClient(async (input, init) => {
      if (input === "/api/v1/bootstrap") {
        bootstrapCount += 1;
        return jsonResponse({
          apiVersion: 1,
          csrfToken: `token-${bootstrapCount}`,
          locale: "en",
        });
      }

      mutationCount += 1;
      mutationTokens.push(
        new Headers(init?.headers).get("x-openrecall-csrf") ?? "",
      );
      return mutationCount === 1
        ? jsonResponse(
            {
              code: "CSRF_TOKEN_INVALID",
              messageKey: "error.csrfTokenInvalid",
            },
            403,
          )
        : jsonResponse({ id: "created" }, 201);
    });

    await expect(
      api.post("/api/v1/sections", { name: "Biology" }),
    ).resolves.toEqual({ id: "created" });
    expect(bootstrapCount).toBe(2);
    expect(mutationCount).toBe(2);
    expect(mutationTokens).toEqual(["token-1", "token-2"]);
  });
});
