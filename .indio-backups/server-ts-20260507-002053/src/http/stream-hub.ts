import type { FastifyInstance } from "fastify";
import type { PlanEntry, NowState, StreamEvent } from "@indio/contracts";

type SocketLike = {
  readyState: number;
  send: (data: string) => void;
  on?: (event: string, listener: () => void) => void;
};

export class StreamHub {
  private readonly clients = new Set<SocketLike>();

  publish(event: StreamEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }

  register(app: FastifyInstance, snapshot: () => { nowState: NowState | null; plan: PlanEntry[] }): void {
    app.get("/stream", { websocket: true }, (socket) => {
      const client = socket as SocketLike;
      this.clients.add(client);

      const { nowState, plan } = snapshot();
      if (nowState) {
        client.send(
          JSON.stringify({
            type: "state.update",
            payload: nowState
          } satisfies StreamEvent)
        );
      }

      client.send(
        JSON.stringify({
          type: "plan.update",
          payload: plan
        } satisfies StreamEvent)
      );

      client.on?.("close", () => {
        this.clients.delete(client);
      });
    });
  }
}
