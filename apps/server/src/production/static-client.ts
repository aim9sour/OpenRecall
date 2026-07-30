import staticPlugin from "@fastify/static";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

const ONE_YEAR_SECONDS = 31_536_000;
const HASHED_ASSET =
  /(?:^|[/\\])[^/\\]+-[A-Za-z0-9_-]{6,}\.(?:css|js|mjs|png|svg|webp|woff2?)$/u;
const SECTION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const STUDY_DAY =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;

export function productionStaticClientRoot(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return environment["NODE_ENV"] === "development"
    ? undefined
    : root;
}

function pathnameAndQuery(request: FastifyRequest): URL {
  return new URL(request.raw.url ?? "/", "http://openrecall.invalid");
}

function isApiPath(pathname: string): boolean {
  const normalized = pathname.replace(/%(?:2f|5c)/giu, "/");
  return normalized === "/api" || normalized.startsWith("/api/");
}

function isAllowedClientQueryEntry(
  key: string,
  value: string,
): boolean {
  if (key === "sectionId") {
    return value === "" || SECTION_ID.test(value);
  }
  if (key === "fromStudyDay" || key === "toStudyDay") {
    return value === "" || STUDY_DAY.test(value);
  }
  return false;
}

function hasDisallowedClientQuery(request: FastifyRequest): boolean {
  const url = pathnameAndQuery(request);
  if (
    isApiPath(url.pathname) ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.includes(".")
  ) {
    return false;
  }
  return [...url.searchParams.entries()].some(
    ([key, value]) => !isAllowedClientQueryEntry(key, value),
  );
}

function sendNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({
    code: "NOT_FOUND",
    messageKey: "error.notFound",
  });
}

export function registerProductionNotFoundHandler(
  server: FastifyInstance,
  staticClientRoot?: string,
): void {
  server.setNotFoundHandler((request, reply) => {
    const { pathname } = pathnameAndQuery(request);
    if (
      staticClientRoot === undefined ||
      isApiPath(pathname) ||
      (request.method !== "GET" && request.method !== "HEAD")
    ) {
      return sendNotFound(reply);
    }
    if (hasDisallowedClientQuery(request)) {
      return reply.code(400).send({
        code: "QUERY_NOT_ALLOWED",
        messageKey: "error.validation",
      });
    }

    reply.header("Cache-Control", "no-store");
    return reply
      .type("text/html; charset=utf-8")
      .sendFile("index.html", {
        immutable: false,
        maxAge: 0,
      });
  });
}

export async function registerStaticClient(
  server: FastifyInstance,
  root: string,
): Promise<void> {
  server.addHook("onRequest", async (request, reply) => {
    if (hasDisallowedClientQuery(request)) {
      return reply.code(400).send({
        code: "QUERY_NOT_ALLOWED",
        messageKey: "error.validation",
      });
    }
  });
  server.addHook("onSend", async (request, reply, payload) => {
    const contentType = reply.getHeader("content-type");
    if (
      isApiPath(pathnameAndQuery(request).pathname) ||
      (typeof contentType === "string" &&
        contentType.startsWith("text/html"))
    ) {
      reply.header("Cache-Control", "no-store");
    }
    return payload;
  });

  await server.register(staticPlugin, {
    root,
    index: "index.html",
    redirect: false,
    setHeaders(reply, filePath) {
      if (HASHED_ASSET.test(filePath)) {
        reply.header(
          "Cache-Control",
          `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
        );
      }
    },
  });
}
