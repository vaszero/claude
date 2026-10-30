/** 게임 엔진(engine.js)의 타입. 상태는 JSON 객체라 여기서는 불투명하게 다룬다. */
export type State = Record<string, unknown> & { archive?: unknown[] };

/** 보낼 메시지. to: 진행자 전체 / 참가자 전체 / 모두 / 요청한 소켓 */
export interface Out {
  to: "hosts" | "players" | "all" | "self";
  ev: string;
  d: unknown;
}

export const C: { title: string };
export function publicContent(): unknown;
export function hostContent(): unknown;
export function fresh(now: number): State;
export function cleanText(s: unknown, max: number): string;
export function isPlayer(s: State, pid: string): boolean;
export function hostView(s: State, online: Set<string>, now: number): unknown;
export function playerView(s: State, pid: string, now: number): unknown;
export function nextWake(s: State, now: number): number | null;
export function tick(s: State, now: number): Out[];
export function onHost(s: State, ev: string, d: unknown, now: number, online: Set<string>): { outs: Out[]; reset?: boolean };
export function onPlayer(s: State, pid: string, ev: string, d: unknown, now: number): Out[];
export function exportData(s: State, now: number): unknown;
export function archiveOf(s: State, now: number): unknown[];
