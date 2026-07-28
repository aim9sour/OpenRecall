import type { ApiError } from "@openrecall/contracts";
import type { LocaleTag } from "@openrecall/i18n";

export interface BootstrapResponse {
  readonly apiVersion: 1;
  readonly csrfToken: string;
  readonly locale: LocaleTag;
}

export interface ApiClient {
  readonly bootstrap: () => Promise<BootstrapResponse>;
  readonly get: <T>(path: string) => Promise<T>;
  readonly post: <T>(path: string, body: unknown) => Promise<T>;
  readonly put: <T>(path: string, body: unknown) => Promise<T>;
  readonly delete: <T>(path: string, body: unknown) => Promise<T>;
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

  return {
    bootstrap,
    get: <T>(path: string) => request<T>("GET", path, undefined, false),
    post: <T>(path: string, body: unknown) =>
      request<T>("POST", path, body, false),
    put: <T>(path: string, body: unknown) =>
      request<T>("PUT", path, body, false),
    delete: <T>(path: string, body: unknown) =>
      request<T>("DELETE", path, body, false),
  };
}
