/**
 * 플랫폼이 배포 때 넣어 주는 바인딩. (app.manifest.json 과 맞출 것)
 */
export interface Env {
  /** 정적 파일 (dist/client) */
  ASSETS: Fetcher;
  /** 강의 방 Durable Object */
  ROOMS: DurableObjectNamespace;
  /** 진행자 키. 웹사이트 설정의 비밀값으로 바꿀 수 있다. 없으면 room.ts 의 기본값. */
  HOST_KEY?: string;
  HF_ENV?: string;
  APP_SLUG?: string;
}
