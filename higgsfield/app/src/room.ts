/**
 * `Room` — 강의 한 번에 쓰는 실시간 방 (Durable Object).
 *
 * 게임 규칙은 ./engine.js 에 있고, 이 파일은 소켓과 저장만 맡는다.
 *
 * 주고받는 메시지는 모두 JSON `{ ev, d }`.
 *   첫 메시지는 반드시 `{ ev: "hello", d: { role, key?, pid? } }`.
 *
 * 방이 잠들었다 깨어나도(hibernation) 이어지도록
 *   - 게임 상태는 매번 ctx.storage 에 저장하고,
 *   - 소켓의 역할·참가자 id 는 소켓 attachment 에 싣는다.
 * 시간이 흐르는 일(말풍선, OX 마감)은 storage 알람으로 처리한다.
 */

import { DurableObject } from "cloudflare:workers";

import * as engine from "./engine.js";
import type { Env } from "./env";
import { DEFAULT_HOST_KEY } from "./host-key";

const PING = "__ping";
const PONG = "__pong";

interface Att {
  connId: string;
  role?: "host" | "player";
  pid?: string;
}

interface Msg {
  ev: string;
  d: unknown;
}

function parse(raw: string | ArrayBuffer): Msg | null {
  if (typeof raw !== "string" || raw.length > 20_000) return null;
  try {
    const m = JSON.parse(raw) as { ev?: unknown; d?: unknown };
    if (typeof m.ev !== "string" || m.ev.length > 40) return null;
    return { ev: m.ev, d: m.d ?? {} };
  } catch {
    return null;
  }
}

export class Room extends DurableObject<Env> {
  private s: engine.State | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<engine.State>("s")) ?? engine.fresh(Date.now());
    });
  }

  private get state(): engine.State {
    if (!this.s) this.s = engine.fresh(Date.now());
    return this.s;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("s", this.state);
    const at = engine.nextWake(this.state);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 5));
  }

  // ── 소켓 ──────────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const att: Att = { connId: crypto.randomUUID().slice(0, 8) };
    server.serializeAttachment(att);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private att(ws: WebSocket): Att {
    return (ws.deserializeAttachment() as Att | null) ?? { connId: "" };
  }

  private sendTo(ws: WebSocket, ev: string, d: unknown): void {
    try {
      ws.send(JSON.stringify({ ev, d }));
    } catch {
      /* 이미 닫힌 소켓 */
    }
  }

  private online(): Set<string> {
    const set = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a.role === "player" && a.pid) set.add(a.pid);
    }
    return set;
  }

  private dispatch(outs: engine.Out[], self: WebSocket | null): void {
    if (!outs.length) return;
    const sockets = this.ctx.getWebSockets();
    for (const o of outs) {
      if (o.to === "self") {
        if (self) this.sendTo(self, o.ev, o.d);
        continue;
      }
      for (const ws of sockets) {
        const a = this.att(ws);
        const isHost = a.role === "host";
        const isPlayer = a.role === "player" && Boolean(a.pid) && engine.isPlayer(this.state, a.pid ?? "");
        if (o.to === "all" ? isHost || isPlayer : o.to === "hosts" ? isHost : isPlayer || (o.ev === "player:reset" && a.role === "player")) {
          this.sendTo(ws, o.ev, o.d);
        }
      }
    }
  }

  /** 화면 상태를 모두에게 보낸다. 짧은 시간 안의 여러 변경은 한 번으로 묶는다. */
  private requestSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncNow();
    }, 60);
  }

  private syncNow(): void {
    const now = Date.now();
    const S = this.state;
    const online = this.online();
    let host: string | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a.role === "host") {
        host ??= JSON.stringify({ ev: "host:state", d: engine.hostView(S, online, now) });
        try {
          ws.send(host);
        } catch {
          /* 무시 */
        }
      } else if (a.role === "player" && a.pid && engine.isPlayer(S, a.pid)) {
        this.sendTo(ws, "player:state", engine.playerView(S, a.pid, now));
      }
    }
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const msg = parse(raw);
    if (!msg) return;
    try {
      await this.onMessage(ws, msg);
    } catch (err) {
      console.error("room message failed:", err instanceof Error ? err.stack : String(err));
    }
  }

  private async onMessage(ws: WebSocket, msg: Msg): Promise<void> {
    const now = Date.now();
    const a = this.att(ws);
    const d = (msg.d ?? {}) as Record<string, unknown>;

    if (msg.ev === "hello") {
      if (d.role === "host") {
        const key = this.env.HOST_KEY || DEFAULT_HOST_KEY;
        if (d.key !== key) {
          this.sendTo(ws, "auth:fail", {});
          ws.close(4001, "bad key");
          return;
        }
        ws.serializeAttachment({ connId: a.connId, role: "host" } satisfies Att);
        this.sendTo(ws, "host:config", { content: engine.hostContent() });
        this.sendTo(ws, "host:state", engine.hostView(this.state, this.online(), now));
        return;
      }
      const pid = engine.cleanText(d.pid, 64);
      if (!pid) {
        ws.close(4002, "no pid");
        return;
      }
      ws.serializeAttachment({ connId: a.connId, role: "player", pid } satisfies Att);
      this.sendTo(ws, "config", engine.publicContent());
      if (engine.isPlayer(this.state, pid)) this.requestSync();
      else this.sendTo(ws, "player:need-join", {});
      return;
    }

    if (a.role === "host") {
      const res = engine.onHost(this.state, msg.ev, d, now, this.online());
      if (res.reset) {
        const archive = engine.archiveOf(this.state, now);
        this.s = engine.fresh(now);
        this.s.archive = archive;
      }
      this.dispatch(res.outs, ws);
      await this.save();
      this.requestSync();
      return;
    }

    if (a.role === "player" && a.pid) {
      const outs = engine.onPlayer(this.state, a.pid, msg.ev, d, now);
      this.dispatch(outs, ws);
      await this.save();
      this.requestSync();
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    if (this.att(ws).role) this.requestSync();
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  override async alarm(): Promise<void> {
    try {
      const outs = engine.tick(this.state, Date.now());
      this.dispatch(outs, null);
      await this.save();
      this.requestSync();
    } catch (err) {
      console.error("room alarm failed:", err instanceof Error ? err.stack : String(err));
    }
  }
}
