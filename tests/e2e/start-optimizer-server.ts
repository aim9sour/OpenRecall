process.env["OPENRECALL_E2E_API_PORT"] = "3214";
process.env["OPENRECALL_E2E_WEB_PORT"] = "5177";
process.env["OPENRECALL_E2E_LOCALE"] = "ar";
await import("./start-server.js");
