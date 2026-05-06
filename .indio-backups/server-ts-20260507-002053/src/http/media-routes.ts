import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";

function contentTypeForAudio(filename: string): string {
  const extension = extname(filename);

  if (extension === ".wav") {
    return "audio/wav";
  }

  if (extension === ".ogg" || extension === ".opus") {
    return "audio/ogg";
  }

  if (extension === ".aac") {
    return "audio/aac";
  }

  if (extension === ".flac") {
    return "audio/flac";
  }

  return "audio/mpeg";
}

export function registerMediaRoutes(app: FastifyInstance, config: AppConfig): void {
  app.get("/media/tts/:filename", async (request, reply) => {
    const params = z.object({
      filename: z.string().regex(/^[a-f0-9]{16}\.(mp3|wav|ogg|opus|aac|flac)$/)
    });
    const { filename } = params.parse(request.params);
    const filePath = resolve(config.cacheDir, filename);

    try {
      await access(filePath);
    } catch {
      return reply.code(404).send({
        error: "TTS file not found"
      });
    }

    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.type(contentTypeForAudio(filename));
    return reply.send(createReadStream(filePath));
  });
}
