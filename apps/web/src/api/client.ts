import type {
  ApiError,
  RestoreResult,
} from "@openrecall/contracts";
import type { LocaleTag } from "@openrecall/i18n";

export interface BootstrapResponse {
  readonly apiVersion: 1;
  readonly csrfToken: string;
  readonly databaseRevision: number;
  readonly locale: LocaleTag;
  readonly localeUpdatedAtMs: number;
}

export interface ApiClient {
  readonly bootstrap: () => Promise<BootstrapResponse>;
  readonly get: <T>(path: string) => Promise<T>;
  readonly post: <T>(path: string, body: unknown) => Promise<T>;
  readonly put: <T>(path: string, body: unknown) => Promise<T>;
  readonly delete: <T>(path: string, body: unknown) => Promise<T>;
  readonly download?: (path: string) => Promise<{
    readonly blob: Blob;
    readonly filename: string;
  }>;
  readonly restore?: (
    file: File,
    expectedCurrentRevision: number,
  ) => Promise<RestoreResult>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly envelope: ApiError;

  constructor(status: number, envelope: ApiError) {
    super(envelope.code);
    this.status = status;
    this.envelope = envelope;
  }
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const value: unknown = await response.json();
    if (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string" &&
      "messageKey" in value &&
      typeof value.messageKey === "string"
    ) {
      return value as ApiError;
    }
  } catch {
    // The stable fallback below deliberately excludes response content.
  }

  return {
    code: "HTTP_ERROR",
    messageKey: "error.internal",
  };
}

export function createApiClient(
  fetchImplementation: typeof fetch = globalThis.fetch,
): ApiClient {
  let bootstrapPromise: Promise<BootstrapResponse> | undefined;
  let csrfToken: string | undefined;

  async function fetchBootstrap(): Promise<BootstrapResponse> {
    const response = await fetchImplementation("/api/v1/bootstrap", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new ApiClientError(response.status, await readError(response));
    }

    const bootstrap = (await response.json()) as BootstrapResponse;
    csrfToken = bootstrap.csrfToken;
    return bootstrap;
  }

  function bootstrap(): Promise<BootstrapResponse> {
    bootstrapPromise ??= fetchBootstrap().catch((error: unknown) => {
      bootstrapPromise = undefined;
      throw error;
    });
    return bootstrapPromise;
  }

  async function request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body: unknown,
    didRetry: boolean,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
    };

    const isMutation = method !== "GET";
    if (isMutation) {
      await bootstrap();
      headers["content-type"] = "application/json";
      headers["x-openrecall-csrf"] = csrfToken ?? "";
    }

    const response = await fetchImplementation(path, {
      method,
      headers,
      ...(isMutation ? { body: JSON.stringify(body) } : {}),
    });

    if (isMutation && response.status === 403 && !didRetry) {
      bootstrapPromise = undefined;
      csrfToken = undefined;
      await bootstrap();
      return request<T>(method, path, body, true);
    }

    if (!response.ok) {
      throw new ApiClientError(response.status, await readError(response));
    }

    if (response.status === 204 || response.status === 205) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async function download(
    path: string,
    didRetry = false,
  ): Promise<{ readonly blob: Blob; readonly filename: string }> {
    await bootstrap();
    const response = await fetchImplementation(path, {
      method: "POST",
      headers: {
        accept: "application/vnd.sqlite3",
        "x-openrecall-csrf": csrfToken ?? "",
      },
    });
    if (response.status === 403 && !didRetry) {
      bootstrapPromise = undefined;
      csrfToken = undefined;
      await bootstrap();
      return download(path, true);
    }
    if (!response.ok) {
      throw new ApiClientError(
        response.status,
        await readError(response),
      );
    }
    const disposition =
      response.headers.get("content-disposition") ?? "";
    const match =
      /filename="(openrecall-manual-\d{1,16}-[0-9a-f-]{36}\.sqlite3)"/i.exec(
        disposition,
      );
    return {
      blob: await response.blob(),
      filename: match?.[1] ?? "openrecall-backup.sqlite3",
    };
  }

  async function restore(
    file: File,
    expectedCurrentRevision: number,
    didRetry = false,
  ): Promise<RestoreResult> {
    await bootstrap();
    const body = new FormData();
    body.append(
      "expectedCurrentRevision",
      String(expectedCurrentRevision),
    );
    body.append("database", file);
    const response = await fetchImplementation("/api/v1/restore", {
      method: "POST",
      headers: {
        accept: "application/json",
        "x-openrecall-csrf": csrfToken ?? "",
      },
      body,
    });
    if (response.status === 403 && !didRetry) {
      bootstrapPromise = undefined;
      csrfToken = undefined;
      await bootstrap();
      return restore(file, expectedCurrentRevision, true);
    }
    if (!response.ok) {
      throw new ApiClientError(
        response.status,
        await readError(response),
      );
    }
    const result = (await response.json()) as RestoreResult;
    bootstrapPromise = undefined;
    return result;
  }

  return {
    bootstrap,
    get: <T>(path: string) => request<T>("GET", path, undefined, false),
    post: <T>(path: string, body: unknown) =>
      request<T>("POST", path, body, false),
    put: <T>(path: string, body: unknown) =>
      request<T>("PUT", path, body, false),
    delete: <T>(path: string, body: unknown) =>
      request<T>("DELETE", path, body, false),
    download: (path: string) => download(path),
    restore: (file, expectedCurrentRevision) =>
      restore(file, expectedCurrentRevision),
  };
}
