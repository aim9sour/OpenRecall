process.env["NODE_ENV"] = "development";
process.env["OPENRECALL_ENABLE_PSEUDO_LOCALE"] = "1";
process.env["OPENRECALL_E2E_API_PORT"] = "3212";
process.env["OPENRECALL_E2E_WEB_PORT"] = "5175";
process.env["OPENRECALL_E2E_LOCALE"] = "en-XA";

await import("./start-server.js");
