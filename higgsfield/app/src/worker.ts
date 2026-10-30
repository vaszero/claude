/**
 * Worker 입구. 정적 파일(참가자 화면 `/`, 강사 화면 `/host.html` 등)은 플랫폼이
 * 먼저 내주고, 그 밖의 요청만 여기로 온다.
 *   /ws      → 강의 방(하나)으로 연결
 *   /host    → 강사 화면
 */

import type { Env } from "./env";
import { Room } from "./room";

export { Room };

const ROOM_NAME = "main";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected a websocket upgrade", { status: 426 });
      }
      return env.ROOMS.get(env.ROOMS.idFromName(ROOM_NAME)).fetch(request);
    }

    if (request.method === "GET" && (url.pathname === "/host" || url.pathname === "/host/")) {
      return env.ASSETS.fetch(new Request(new URL("/host.html", url), request));
    }

    if (request.method === "GET" && request.headers.get("Accept")?.includes("text/html")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
