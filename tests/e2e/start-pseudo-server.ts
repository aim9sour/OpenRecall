import { resolveE2ePorts } from "./ports.js";

const e2ePorts = resolveE2ePorts();
process.env["NODE_ENV"] = "development";
process.env["OPENRECALL_ENABLE_PSEUDO_LOCALE"] = "1";
process.env["OPENRECALL_E2E_API_PORT"] = String(e2ePorts.api[2]);
process.env["OPENRECALL_E2E_WEB_PORT"] = String(e2ePorts.web[2]);
process.env["OPENRECALL_E2E_LOCALE"] = "en-XA";

await import("./start-server.js");
