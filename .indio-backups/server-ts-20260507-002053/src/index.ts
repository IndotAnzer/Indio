import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http/app.js";
import { StreamHub } from "./http/stream-hub.js";
import { IndioRuntime } from "./runtime.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(currentDir, "../../.env"), override: true });

const config = loadConfig();
const streamHub = new StreamHub();
const runtime = new IndioRuntime(config, (event) => {
  streamHub.publish(event);
});
const app = await createHttpApp(config, runtime, streamHub);

try {
  await runtime.bootstrap();
  await app.listen({
    host: config.host,
    port: config.port
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
