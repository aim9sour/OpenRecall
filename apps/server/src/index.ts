import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const server = await buildServer({ config });
  await server.listen({ host: config.host, port: config.port });
}

void start().catch(() => {
  process.stderr.write("OPENRECALL_SERVER_START_FAILED\n");
  process.exitCode = 1;
});
