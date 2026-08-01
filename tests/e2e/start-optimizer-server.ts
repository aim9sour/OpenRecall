import { resolveE2ePorts } from "./ports.js";

const e2ePorts = resolveE2ePorts();
process.env["OPENRECALL_E2E_API_PORT"] = String(e2ePorts.api[4]);
process.env["OPENRECALL_E2E_WEB_PORT"] = String(e2ePorts.web[4]);
process.env["OPENRECALL_E2E_LOCALE"] = "ar";
await import("./start-server.js");
