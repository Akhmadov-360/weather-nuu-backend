import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import websocket, { type WebSocket } from "@fastify/websocket";
import type { WsEvent } from "@weather/contracts";

declare module "fastify" {
  interface FastifyInstance {
    broadcast: (event: WsEvent) => void;
  }
}

/**
 * Minimal in-process pub/sub: fine for a single API instance. If this
 * ever runs behind more than one replica, swap the Set for a Redis
 * pub/sub channel — the `broadcast` call sites don't need to change.
 */
export const websocketPlugin: FastifyPluginAsync = fp(async (app) => {
  await app.register(websocket);

  const clients = new Set<WebSocket>();

  app.get("/v1/ws/sensors", { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  app.decorate("broadcast", (event: WsEvent) => {
    const message = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  });
});
