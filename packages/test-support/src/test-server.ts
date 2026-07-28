export const TEST_AUTHORITY = "127.0.0.1:3210" as const;
export const TEST_ORIGIN = "http://127.0.0.1:3210" as const;

export function testRequestHeaders(
  options: {
    readonly csrfToken?: string;
    readonly origin?: string;
  } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    host: TEST_AUTHORITY,
  };

  if (options.origin !== undefined) {
    headers["origin"] = options.origin;
  }
  if (options.csrfToken !== undefined) {
    headers["x-openrecall-csrf"] = options.csrfToken;
  }

  return headers;
}
