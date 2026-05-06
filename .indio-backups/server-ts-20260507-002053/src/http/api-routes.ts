import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatRequest, AdvanceRequest, UpdateCodexSettingsRequest } from "@indio/contracts";
import type { IndioRuntime } from "../runtime.js";

export function registerApiRoutes(app: FastifyInstance, runtime: IndioRuntime): void {
  app.get("/health", async () => ({
    ok: true,
    mode: runtime.getConfigMode(),
    codex: await runtime.getCodexStatus(),
    music: runtime.getMusicStatus(),
    tts: runtime.getTtsStatus()
  }));

  app.get("/api/now", async () => ({
    now: runtime.getNowState()
  }));

  app.get("/api/next", async () => ({
    next: runtime.getNextTrack()
  }));

  app.get("/api/taste", async () => runtime.getTasteSummary());

  app.get("/api/plan/today", async () => ({
    plan: runtime.getTodayPlan()
  }));

  app.get("/api/music/bootstrap", async () => ({
    music: runtime.getMusicBootstrap()
  }));

  app.get("/api/codex/bootstrap", async () => ({
    settings: runtime.getCodexSettings(),
    status: await runtime.getCodexStatus()
  }));

  app.post("/api/codex/settings", async (request, reply) => {
    const schema = z.object({
      authSource: z.enum(["shared-cli", "project-api", "openai-compatible"]),
      projectApiKey: z.string().optional(),
      clearProjectApiKey: z.boolean().optional(),
      compatibleApiKey: z.string().optional(),
      compatibleBaseUrl: z.string().optional(),
      compatibleModel: z.string().optional(),
      compatibleResponseFormat: z.enum(["json-object", "json-schema"]).optional(),
      clearCompatibleApiKey: z.boolean().optional()
    });
    const body = schema.parse(request.body) satisfies UpdateCodexSettingsRequest;

    try {
      return await runtime.updateCodexSettings(body);
    } catch (error) {
      request.log.warn({ err: error }, "codex settings update failed");
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Codex 设置更新失败。"
      });
    }
  });

  app.post("/api/music/login/qr", async () => ({
    session: await runtime.createMusicQrLogin()
  }));

  app.get("/api/music/login/qr/check", async (request) => {
    const query = z.object({
      key: z.string().min(1)
    });
    const { key } = query.parse(request.query);

    return {
      status: await runtime.checkMusicQrLogin(key),
      music: runtime.getMusicBootstrap()
    };
  });

  app.post("/api/music/logout", async () => {
    await runtime.logoutMusic();

    return {
      ok: true,
      music: runtime.getMusicBootstrap()
    };
  });

  app.post("/api/chat", async (request, reply) => {
    const schema = z.object({
      message: z.string().min(1)
    });
    const body = schema.parse(request.body) satisfies ChatRequest;

    try {
      return await runtime.handleTurn({
        source: "manual",
        userInput: body.message
      });
    } catch (error) {
      request.log.warn({ err: error }, "chat turn was not ready");
      return reply.code(503).send({
        error: error instanceof Error ? error.message : "电台这轮还没准备好，请稍等再试。"
      });
    }
  });

  app.post("/api/radio/advance", async (request, reply) => {
    const schema = z.object({
      currentSegmentId: z.string().min(1).optional()
    });

    const body = schema.parse(request.body ?? {}) satisfies AdvanceRequest;

    try {
      return {
        nowState: await runtime.advancePreparedSegment(body.currentSegmentId)
      };
    } catch (error) {
      request.log.warn({ err: error }, "radio segment advance was not ready");
      return reply.code(503).send({
        error: error instanceof Error ? error.message : "下一段电台还没准备好，请稍等。"
      });
    }
  });

  app.get("/api/pulse", async (request, reply) => {
    try {
      return await runtime.handleTurn({
        source: "schedule"
      });
    } catch (error) {
      request.log.warn({ err: error }, "scheduled turn was not ready");
      return reply.code(503).send({
        error: error instanceof Error ? error.message : "电台这轮还没准备好，请稍后。"
      });
    }
  });
}
