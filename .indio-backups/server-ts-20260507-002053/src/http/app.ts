import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { AppConfig } from "../config.js";
import type { IndioRuntime } from "../runtime.js";
import { registerApiRoutes } from "./api-routes.js";
import { registerMediaRoutes } from "./media-routes.js";
import { StreamHub } from "./stream-hub.js";

export async function createHttpApp(
  config: AppConfig,
  runtime: IndioRuntime,
  streamHub: StreamHub
) {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: [config.pwaUrl, /localhost/, /127\.0\.0\.1/]
  });

  await app.register(websocket);

  registerApiRoutes(app, runtime);
  registerMediaRoutes(app, config);
  streamHub.register(app, () => ({
    nowState: runtime.getNowState(),
    plan: runtime.getTodayPlan()
  }));

  app.addHook("onClose", async () => {
    await runtime.shutdown();
  });

  return app;
}
