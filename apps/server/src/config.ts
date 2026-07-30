import envPaths from "env-paths";
import {
  isDevelopmentLocale,
  isProductionLocale,
  type LocaleTag,
} from "@openrecall/i18n";

const LOOPBACK_HOST = "127.0.0.1" as const;
const SERVER_PORT = 3_210 as const;
const PRODUCTION_ORIGIN = "http://127.0.0.1:3210" as const;
const DEVELOPMENT_ORIGIN = "http://127.0.0.1:5173" as const;

export interface ServerConfig {
  readonly authority: string;
  readonly dataDirectory: string;
  readonly host: typeof LOOPBACK_HOST;
  readonly locale: LocaleTag;
  readonly port: typeof SERVER_PORT;
  readonly publicOrigin: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Environment = process.env): ServerConfig {
  if (
    env["OPENRECALL_HOST"] !== undefined &&
    env["OPENRECALL_HOST"] !== LOOPBACK_HOST
  ) {
    throw new Error("SERVER_HOST_NOT_ALLOWED");
  }

  if (
    env["OPENRECALL_PORT"] !== undefined &&
    env["OPENRECALL_PORT"] !== String(SERVER_PORT)
  ) {
    throw new Error("SERVER_PORT_NOT_ALLOWED");
  }

  const isDevelopment = env["NODE_ENV"] === "development";
  const publicOrigin = isDevelopment
    ? DEVELOPMENT_ORIGIN
    : PRODUCTION_ORIGIN;

  if (
    env["OPENRECALL_PUBLIC_ORIGIN"] !== undefined &&
    env["OPENRECALL_PUBLIC_ORIGIN"] !== publicOrigin
  ) {
    throw new Error("SERVER_ORIGIN_NOT_ALLOWED");
  }

  const localeCandidate = env["OPENRECALL_LOCALE"] ?? "ar";
  const pseudoLocaleEnabled =
    isDevelopment &&
    env["OPENRECALL_ENABLE_PSEUDO_LOCALE"] === "1";
  if (
    !isProductionLocale(localeCandidate) &&
    !(
      isDevelopmentLocale(localeCandidate) &&
      pseudoLocaleEnabled
    )
  ) {
    throw new Error("SERVER_LOCALE_NOT_SUPPORTED");
  }
  const locale: LocaleTag = localeCandidate;

  return {
    authority: `${LOOPBACK_HOST}:${SERVER_PORT}`,
    dataDirectory: envPaths("OpenRecall").data,
    host: LOOPBACK_HOST,
    locale,
    port: SERVER_PORT,
    publicOrigin,
  };
}
