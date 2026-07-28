process.env["OPENRECALL_E2E_API_PORT"] = "3211";
process.env["OPENRECALL_E2E_WEB_PORT"] = "5174";
process.env["OPENRECALL_E2E_LOCALE"] = "en";

await import("./start-server.js");
