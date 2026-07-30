import { describe, expect, it } from "vitest";
import { createApiClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("API client", () => {
  it("sends PUT and DELETE as CSRF-protected mutations", async () => {
    const methods: string[] = [];
    const api = createApiClient(async (input, init) => {
      if (input === "/api/v1/bootstrap") {
        return jsonResponse({
          apiVersion: 1,
          csrfToken: "one-token",
          locale: "en",
        });
      }
      methods.push(init?.method ?? "");
      expect(new Headers(init?.headers).get("x-openrecall-csrf")).toBe(
        "one-token",
      );
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse({ id: "updated" });
    });

    await api.put("/api/v1/cards/one", { value: 1 });
    await api.delete("/api/v1/cards/one", { confirmation: "one" });
    expect(methods).toEqual(["PUT", "DELETE"]);
  });

  it("accepts a successful response with no content", async () => {
    const api = createApiClient(async (input) =>
      input === "/api/v1/bootstrap"
        ? jsonResponse({
            apiVersion: 1,
            csrfToken: "one-token",
            locale: "en",
          })
        : new Response(null, { status: 204 }),
    );

    await expect(api.post<void>("/api/v1/shown", {})).resolves.toBeUndefined();
  });

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

  it("downloads a CSRF-protected SQLite response and accepts only a safe generated filename", async () => {
    const api = createApiClient(async (input, init) => {
      if (input === "/api/v1/bootstrap") {
        return jsonResponse({
          apiVersion: 1,
          csrfToken: "download-token",
          locale: "en",
        });
      }
      expect(init?.method).toBe("POST");
      expect(
        new Headers(init?.headers).get("x-openrecall-csrf"),
      ).toBe("download-token");
      return new Response("SQLite format 3\u0000", {
        headers: {
          "content-disposition":
            'attachment; filename="openrecall-manual-8000-01234567-89ab-4cde-8fab-0123456789ab.sqlite3"',
          "content-type": "application/vnd.sqlite3",
        },
      });
    });

    const result = await api.download?.("/api/v1/backup");
    expect(result?.filename).toBe(
      "openrecall-manual-8000-01234567-89ab-4cde-8fab-0123456789ab.sqlite3",
    );
    expect(await result?.blob.text()).toBe("SQLite format 3\u0000");
  });

  it("uploads a restore as multipart without setting a boundary and invalidates cached revision data", async () => {
    let bootstrapCount = 0;
    const api = createApiClient(async (input, init) => {
      if (input === "/api/v1/bootstrap") {
        bootstrapCount += 1;
        return jsonResponse({
          apiVersion: 1,
          csrfToken: `restore-token-${bootstrapCount}`,
          databaseRevision: bootstrapCount,
          locale: "en",
        });
      }
      expect(input).toBe("/api/v1/restore");
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toBeNull();
      expect(headers.get("x-openrecall-csrf")).toBe(
        "restore-token-1",
      );
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      expect((body as FormData).get("expectedCurrentRevision")).toBe(
        "1",
      );
      expect((body as FormData).get("database")).toBeInstanceOf(
        File,
      );
      return jsonResponse({
        databaseRevision: 2,
        restoredUserVersion: 5,
        preRestoreBackupFilename: "safe.sqlite3",
      });
    });

    const restored = await api.restore?.(
      new File(["SQLite format 3\u0000"], "private-name.sqlite3"),
      1,
    );
    expect(restored?.databaseRevision).toBe(2);
    await api.bootstrap();
    expect(bootstrapCount).toBe(2);
  });
});
