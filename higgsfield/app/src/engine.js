/*
 * 병원 CS 플레이 — 게임 엔진
 *
 * Node 서버(server.js)의 규칙을 Durable Object용으로 옮긴 것.
 * 상태는 전부 JSON(일반 객체·배열)이라 방 저장소에 그대로 저장되고,
 * 시간이 흐르는 일(말풍선 등장·퇴장, OX 마감)은 nextWake()/tick()으로 처리한다.
 *
 * 핸들러는 보낼 메시지 목록을 돌려준다: { to, ev, d }
 *   to: "hosts" | "players" | "all" | "self"
 */
import RAW from "./content.js";

// ───────────────────────── 콘텐츠 ─────────────────────────

function prepare(raw) {
  const c = JSON.parse(JSON.stringify(raw));
  const fail = (m) => { throw new Error(`[콘텐츠 오류] ${m}`); };
  if (!Array.isArray(c.departments) || !c.departments.length) fail("departments");
  c.quiz = c.quiz || [];
  c.scenarios = c.scenarios || [];
  c.ox = c.ox || [];
  c.quiz.forEach((q, i) => {
    if (!(q.answer >= 1 && q.answer <= q.options.length)) fail(`quiz ${i + 1}`);
    q.answer -= 1;
  });
  c.scenarios.forEach((s, i) => {
    if (!(s.best >= 1 && s.best <= s.options.length)) fail(`scenarios ${i + 1}`);
    s.best -= 1;
  });
  c.ox.forEach((q, i) => { if (!["O", "X"].includes(q.answer)) fail(`ox ${i + 1}`); });
  if (!c.whack?.bad?.length || !c.whack?.good?.length) fail("whack");
  if (!c.cloudPrompts?.length) fail("cloudPrompts");
  c.settings = Object.assign({ whackSeconds: 60, oxSeconds: 12, cloudMaxPerPerson: 3 }, c.settings);
  return c;
}

export const C = prepare(RAW);

/** 진행자 화면용: 정답·해설까지 포함한 전체 콘텐츠 */
export function hostContent() {
  return C;
}

/** 참가자 화면용: 정답·해설을 뺀 콘텐츠 */
export function publicContent() {
  return {
    title: C.title,
    brand: C.brand,
    logo: C.logo || "",
    departments: C.departments,
    settings: C.settings,
    quiz: C.quiz.map((q) => ({ question: q.question, options: q.options })),
    scenarios: C.scenarios.map((s) => ({ tag: s.tag, title: s.title, situation: s.situation, quote: s.quote, options: s.options })),
    ox: C.ox.map((q) => ({ statement: q.statement })),
    cloudPrompts: C.cloudPrompts,
  };
}

// ───────────────────────── 상태 ─────────────────────────

function freshWhack() {
  return {
    status: "ready", startedAt: 0, endsAt: 0, nextSpawnAt: 0, seq: 0,
    scores: {}, bubbles: {}, badStats: {}, goodMistakes: {}, participants: 0,
  };
}

export function fresh(now) {
  return {
    startedAt: new Date(now).toISOString(),
    phase: "lobby",
    players: {},
    quiz: { mode: null, open: false, answers: { pre: {}, post: {} } },
    vote: { index: 0, stage: "question", votes: C.scenarios.map(() => ({})) },
    whack: freshWhack(),
    ox: { index: -1, stage: "ready", endsAt: 0, answers: C.ox.map(() => ({})), revealed: [] },
    cloud: { index: 0, entries: C.cloudPrompts.map(() => []), hidden: C.cloudPrompts.map(() => []) },
    archive: [],
  };
}

// ───────────────────────── 유틸 ─────────────────────────

export function cleanText(s, max) {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const PHASES = ["lobby", "quiz", "vote", "whack", "ox", "cloud", "report"];
const vals = (o) => Object.values(o);
const quizScore = (arr) => C.quiz.reduce((s, q, i) => s + (arr[i] === q.answer ? 1 : 0), 0);
const nameOf = (S, pid) => S.players[pid]?.name || "";
const deptOf = (S, pid) => S.players[pid]?.dept;

// ───────────────────────── 집계 ─────────────────────────

function quizStats(S) {
  const n = C.quiz.length || 1;
  const calc = (map) => {
    const arr = vals(map);
    return {
      count: arr.length,
      avg: arr.length ? arr.reduce((s, a) => s + quizScore(a), 0) / (arr.length * n) : null,
      per: C.quiz.map((q, i) => (arr.length ? arr.filter((a) => a[i] === q.answer).length / arr.length : null)),
    };
  };
  const { pre, post } = S.quiz.answers;
  const both = Object.keys(post).filter((id) => pre[id]);
  return {
    pre: calc(pre),
    post: calc(post),
    matched: {
      count: both.length,
      pre: both.length ? both.reduce((s, id) => s + quizScore(pre[id]), 0) / (both.length * n) : null,
      post: both.length ? both.reduce((s, id) => s + quizScore(post[id]), 0) / (both.length * n) : null,
    },
  };
}

function voteCounts(S, i) {
  const counts = C.scenarios[i].options.map(() => 0);
  for (const v of vals(S.vote.votes[i])) counts[v] += 1;
  return counts;
}

function whackBoard(S, limit) {
  const rows = Object.entries(S.whack.scores)
    .filter(([pid]) => S.players[pid])
    .map(([pid, score]) => ({ pid, name: nameOf(S, pid), dept: deptOf(S, pid), score }))
    .sort((a, b) => b.score - a.score);
  return limit ? rows.slice(0, limit) : rows;
}

function whackDepts(S) {
  const agg = {};
  for (const r of whackBoard(S)) {
    const a = agg[r.dept] || (agg[r.dept] = { dept: r.dept, sum: 0, n: 0 });
    a.sum += r.score; a.n += 1;
  }
  return vals(agg).map((a) => ({ dept: a.dept, n: a.n, avg: Math.round(a.sum / a.n) })).sort((a, b) => b.avg - a.avg);
}

function whackReview(S) {
  const w = S.whack;
  const bad = vals(w.badStats).map((b) => ({
    text: b.text, alt: b.alt, shown: b.shown,
    catchRate: w.participants && b.shown ? Math.min(1, b.hits / (b.shown * w.participants)) : 0,
  }));
  const confused = Object.entries(w.goodMistakes).map(([text, n]) => ({ text, n })).sort((a, b) => b.n - a.n).slice(0, 3);
  return { bad, confused };
}

function oxBoard(S) {
  const members = {};
  for (const p of vals(S.players)) members[p.dept] = (members[p.dept] || 0) + 1;
  const rows = C.departments.filter((d) => members[d]).map((d) => ({ dept: d, members: members[d], score: 0, answered: 0 }));
  for (const i of S.ox.revealed) {
    const ans = C.ox[i].answer;
    for (const row of rows) {
      let total = 0, correct = 0;
      for (const [pid, a] of Object.entries(S.ox.answers[i])) {
        if (deptOf(S, pid) !== row.dept) continue;
        total += 1;
        if (a === ans) correct += 1;
      }
      if (total) row.score += Math.round((correct / total) * 100);
      row.answered += total;
    }
  }
  return rows.sort((a, b) => b.score - a.score);
}

function cloudWords(S, i) {
  const counts = {};
  for (const e of S.cloud.entries[i]) {
    const key = e.text.replace(/[.!?~,]+$/g, "");
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const hidden = new Set(S.cloud.hidden[i]);
  return Object.entries(counts).map(([text, count]) => ({ text, count, hidden: hidden.has(text) })).sort((a, b) => b.count - a.count);
}

// ───────────────────────── 화면 데이터 ─────────────────────────

export function hostView(S, online, now) {
  const players = vals(S.players);
  const oxI = S.ox.index;
  const oxCounts = { O: 0, X: 0 };
  if (oxI >= 0) for (const a of vals(S.ox.answers[oxI])) oxCounts[a] += 1;
  const cl = S.cloud.entries[S.cloud.index];
  return {
    now,
    phase: S.phase,
    total: players.length,
    online: Object.keys(S.players).filter((pid) => online.has(pid) || isBot(pid)).length,
    demo: botIds(S).length,
    deptCounts: C.departments.map((d) => ({ dept: d, count: players.filter((p) => p.dept === d).length })),
    recent: players.slice(-40).map((p) => ({ name: p.name, dept: p.dept })),
    quiz: { mode: S.quiz.mode, open: S.quiz.open, stats: quizStats(S) },
    vote: {
      index: S.vote.index,
      stage: S.vote.stage,
      total: Object.keys(S.vote.votes[S.vote.index] || {}).length,
      counts: C.scenarios.length ? voteCounts(S, S.vote.index) : [],
    },
    whack: {
      status: S.whack.status,
      endsAt: S.whack.endsAt,
      participants: S.whack.participants,
      board: whackBoard(S, 8).map(({ name, dept, score }) => ({ name, dept, score })),
      depts: whackDepts(S),
      review: S.whack.status === "ended" ? whackReview(S) : null,
    },
    ox: {
      index: oxI, stage: S.ox.stage, endsAt: S.ox.endsAt,
      answered: oxI >= 0 ? Object.keys(S.ox.answers[oxI]).length : 0,
      counts: oxCounts, board: oxBoard(S), revealedCount: S.ox.revealed.length,
    },
    cloud: {
      index: S.cloud.index,
      words: cloudWords(S, S.cloud.index),
      entries: cl.length,
      people: new Set(cl.map((e) => e.pid)).size,
    },
    report: S.phase === "report" ? reportData(S) : null,
  };
}

function reportData(S) {
  return {
    votes: C.scenarios.map((sc, i) => {
      const counts = voteCounts(S, i);
      const total = counts.reduce((a, b) => a + b, 0);
      return { title: sc.title, total, bestRate: total ? counts[sc.best] / total : null };
    }),
    cloud: C.cloudPrompts.map((prompt, i) => ({ prompt, words: cloudWords(S, i).filter((w) => !w.hidden).slice(0, 10) })),
    whackTop: whackBoard(S, 3).map(({ name, dept, score }) => ({ name, dept, score })),
  };
}

export function isPlayer(S, pid) {
  return Boolean(pid && S.players[pid]);
}

export function playerView(S, pid, now) {
  const p = S.players[pid];
  const pre = S.quiz.answers.pre[pid];
  const post = S.quiz.answers.post[pid];
  const vI = S.vote.index;
  const oxI = S.ox.index;
  const w = S.whack;
  let rank = null;
  if (w.status === "ended") {
    const idx = whackBoard(S).findIndex((r) => r.pid === pid);
    rank = idx >= 0 ? idx + 1 : null;
  }
  const myVotes = S.vote.votes[vI] || {};
  return {
    now,
    phase: S.phase,
    me: { name: p.name, dept: p.dept },
    quiz: {
      mode: S.quiz.mode,
      open: S.quiz.open,
      submitted: S.quiz.mode ? Boolean(S.quiz.answers[S.quiz.mode][pid]) : false,
      preScore: post && pre ? quizScore(pre) : null,
      postScore: post ? quizScore(post) : null,
      total: C.quiz.length,
    },
    vote: {
      index: vI,
      stage: S.vote.stage,
      mine: pid in myVotes ? myVotes[pid] : null,
      best: S.vote.stage === "answer" ? C.scenarios[vI].best : null,
      counts: S.vote.stage !== "question" && C.scenarios.length ? voteCounts(S, vI) : null,
    },
    whack: {
      status: w.status,
      endsAt: w.endsAt,
      score: w.scores[pid] ?? 0,
      rank,
      of: Object.keys(w.scores).length,
      bubbles: w.status === "running"
        ? vals(w.bubbles).map((b) => ({ id: b.id, slot: b.slot, text: b.text, hit: b.hits.includes(pid) }))
        : [],
    },
    ox: {
      index: oxI,
      stage: S.ox.stage,
      endsAt: S.ox.endsAt,
      mine: oxI >= 0 ? S.ox.answers[oxI][pid] || null : null,
      answer: S.ox.stage === "reveal" && oxI >= 0 ? C.ox[oxI].answer : null,
      explain: S.ox.stage === "reveal" && oxI >= 0 ? C.ox[oxI].explain : null,
    },
    cloud: {
      index: S.cloud.index,
      mine: S.cloud.entries[S.cloud.index].filter((e) => e.pid === pid).map((e) => e.text),
    },
  };
}

// ───────────────────────── 금지 멘트 잡기 ─────────────────────────

function whackEnd(S, outs) {
  const w = S.whack;
  for (const b of vals(w.bubbles)) outs.push({ to: "all", ev: "whack:despawn", d: { id: b.id } });
  w.bubbles = {};
  if (w.status === "running") w.status = "ended";
}

function whackStart(S, now, online) {
  const outs = [];
  whackEnd(S, outs);
  const w = (S.whack = freshWhack());
  w.status = "running";
  w.startedAt = now;
  w.endsAt = now + C.settings.whackSeconds * 1000;
  w.nextSpawnAt = now + 900;
  for (const pid of [...online, ...botIds(S)]) if (S.players[pid]) w.scores[pid] = 0;
  w.participants = Object.keys(w.scores).length;
  return outs;
}

function whackSpawn(S, now, outs) {
  const w = S.whack;
  const bubbles = vals(w.bubbles);
  const used = new Set(bubbles.map((b) => b.slot));
  const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !used.has(i));
  if (!free.length) return;
  const slot = free[Math.floor(Math.random() * free.length)];
  const onScreen = new Set(bubbles.map((b) => b.text));
  const bad = Math.random() < 0.62;
  const pool = bad ? C.whack.bad : C.whack.good.map((text) => ({ text }));
  const candidates = pool.filter((x) => !onScreen.has(x.text));
  if (!candidates.length) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const progress = (now - w.startedAt) / (w.endsAt - w.startedAt);
  const life = Math.round(3000 - 900 * progress);
  const b = { id: ++w.seq, slot, text: pick.text, bad, alt: pick.alt || "", born: now, life, hits: [], first: null };
  w.bubbles[b.id] = b;
  if (bad) {
    const st = w.badStats[b.text] || (w.badStats[b.text] = { text: b.text, alt: b.alt, shown: 0, hits: 0 });
    st.shown += 1;
  }
  outs.push({ to: "players", ev: "whack:spawn", d: { id: b.id, slot, text: b.text, life } });
  outs.push({ to: "hosts", ev: "whack:spawn", d: { id: b.id, slot, text: b.text, life, bad } });
}

function whackHit(S, pid, id, now, outs) {
  const w = S.whack;
  if (w.status !== "running") return;
  const b = w.bubbles[id];
  if (!b || b.hits.includes(pid)) return;
  b.hits.push(pid);
  if (!(pid in w.scores)) { w.scores[pid] = 0; w.participants = Object.keys(w.scores).length; }
  let pts;
  let first = false;
  if (b.bad) {
    const t = Math.min(1, (now - b.born) / b.life);
    pts = 30 + Math.round(70 * (1 - t));
    if (!b.first) { b.first = pid; first = true; pts += 20; }
    w.badStats[b.text].hits += 1;
  } else {
    pts = -50;
    w.goodMistakes[b.text] = (w.goodMistakes[b.text] || 0) + 1;
  }
  w.scores[pid] += pts;
  outs.push({ to: "hosts", ev: "whack:fx", d: { id: b.id, slot: b.slot, name: nameOf(S, pid), bad: b.bad, first, pts } });
  outs.push({ to: "self", ev: "whack:hitres", d: { id: b.id, pts, bad: b.bad, first } });
}

// ───────────────────────── 체험용 가상 참가자 ─────────────────────────
// 강사가 혼자서도 전체 흐름을 볼 수 있도록, 방 안에서 자동으로 응답하는 참가자.

const BOT_NAMES = ["김간호", "접수천사", "이치료", "박원무", "최방사", "정실장", "한수납", "윤코디", "강주임", "조선생", "오간호", "서치료"];
const isBot = (pid) => pid.startsWith("demo-");
const botIds = (S) => Object.keys(S.players).filter(isBot);

function addBots(S, now) {
  const depts = C.departments.slice(0, Math.min(4, C.departments.length));
  BOT_NAMES.forEach((name, i) => {
    const pid = `demo-${i}`;
    if (!S.players[pid]) S.players[pid] = { name, dept: depts[i % depts.length], joinedAt: now + i };
    if (S.whack.status === "running" && !(pid in S.whack.scores)) S.whack.scores[pid] = 0;
  });
  S.whack.participants = Object.keys(S.whack.scores).length;
}

function removeBots(S) {
  for (const pid of botIds(S)) {
    delete S.players[pid];
    delete S.quiz.answers.pre[pid];
    delete S.quiz.answers.post[pid];
    for (const v of S.vote.votes) delete v[pid];
    for (const a of S.ox.answers) delete a[pid];
    delete S.whack.scores[pid];
  }
  S.cloud.entries = S.cloud.entries.map((list) => list.filter((e) => !isBot(e.pid)));
  S.whack.participants = Object.keys(S.whack.scores).length;
}

function botWaiting(S, pid, now) {
  if (S.phase === "quiz" && S.quiz.open && S.quiz.mode) return !S.quiz.answers[S.quiz.mode][pid];
  if (S.phase === "vote" && S.vote.stage === "question") return !(pid in S.vote.votes[S.vote.index]);
  if (S.phase === "ox" && S.ox.stage === "question" && now < S.ox.endsAt) return !S.ox.answers[S.ox.index][pid];
  if (S.phase === "cloud" && (C.demoCloud || [])[S.cloud.index]?.length) {
    return !S.cloud.entries[S.cloud.index].some((e) => e.pid === pid);
  }
  return false;
}

function botStep(S, now) {
  const outs = [];
  const r = Math.random;
  for (const pid of botIds(S)) {
    const skill = 0.5 + (Number(pid.slice(5)) % 4) * 0.08;
    if (botWaiting(S, pid, now) && r() < 0.22) {
      if (S.phase === "quiz") {
        const boost = S.quiz.mode === "post" ? 0.3 : 0;
        S.quiz.answers[S.quiz.mode][pid] = C.quiz.map((q) => (r() < skill + boost ? q.answer : Math.floor(r() * q.options.length)));
      } else if (S.phase === "vote") {
        const sc = C.scenarios[S.vote.index];
        S.vote.votes[S.vote.index][pid] = r() < 0.55 ? sc.best : Math.floor(r() * sc.options.length);
      } else if (S.phase === "ox") {
        const a = C.ox[S.ox.index].answer;
        S.ox.answers[S.ox.index][pid] = r() < skill + 0.2 ? a : a === "O" ? "X" : "O";
      } else if (S.phase === "cloud") {
        const pool = C.demoCloud[S.cloud.index];
        S.cloud.entries[S.cloud.index].push({ pid, text: pool[Math.floor(r() * pool.length)], at: now });
      }
    }
    if (S.whack.status === "running") {
      for (const b of vals(S.whack.bubbles)) {
        if (b.hits.includes(pid) || now - b.born < 400) continue;
        if (r() < (b.bad ? 0.06 : 0.006)) whackHit(S, pid, b.id, now, outs);
      }
    }
  }
  return outs.filter((o) => o.to !== "self");
}

// ───────────────────────── 시간 ─────────────────────────

/** 다음에 깨어나야 할 시각(ms). 없으면 null. */
export function nextWake(S, now) {
  const t = [];
  if (botIds(S).some((pid) => botWaiting(S, pid, now))) t.push(now + 500);
  const w = S.whack;
  if (w.status === "running") {
    t.push(w.endsAt, w.nextSpawnAt);
    for (const b of vals(w.bubbles)) t.push(b.born + b.life);
  }
  if (S.ox.stage === "question" && S.ox.endsAt) t.push(S.ox.endsAt + 300);
  return t.length ? Math.min(...t) : null;
}

/** now까지 밀린 시간 이벤트를 처리한다. */
export function tick(S, now) {
  const outs = [];
  const w = S.whack;
  if (w.status === "running") {
    for (const b of vals(w.bubbles)) {
      if (b.born + b.life <= now) {
        delete w.bubbles[b.id];
        outs.push({ to: "all", ev: "whack:despawn", d: { id: b.id } });
      }
    }
    if (now >= w.endsAt) whackEnd(S, outs);
    else if (w.nextSpawnAt <= now) {
      whackSpawn(S, now, outs);
      const progress = (now - w.startedAt) / (w.endsAt - w.startedAt);
      w.nextSpawnAt = now + 1050 - 450 * progress + Math.random() * 300;
    }
  }
  if (S.ox.stage === "question" && S.ox.endsAt && now >= S.ox.endsAt + 300) S.ox.stage = "locked";
  outs.push(...botStep(S, now));
  return outs;
}

// ───────────────────────── 진행자 ─────────────────────────

/** 진행자 이벤트. { outs, reset? } */
export function onHost(S, ev, d, now, online) {
  const outs = [];
  d = d || {};
  switch (ev) {
    case "host:phase":
      if (!PHASES.includes(d.phase)) break;
      if (S.phase === "whack" && d.phase !== "whack" && S.whack.status === "running") whackEnd(S, outs);
      S.phase = d.phase;
      break;
    case "quiz:open":
      if (!["pre", "post"].includes(d.mode)) break;
      S.quiz.mode = d.mode;
      S.quiz.open = true;
      break;
    case "quiz:close":
      S.quiz.open = false;
      break;
    case "vote:goto":
      if (Number.isInteger(d.index) && d.index >= 0 && d.index < C.scenarios.length) {
        S.vote.index = d.index;
        S.vote.stage = "question";
      }
      break;
    case "vote:stage":
      if (["question", "result", "answer"].includes(d.stage)) S.vote.stage = d.stage;
      break;
    case "whack:start":
      outs.push(...whackStart(S, now, online));
      break;
    case "whack:stop":
      whackEnd(S, outs);
      break;
    case "whack:reset":
      whackEnd(S, outs);
      S.whack = freshWhack();
      break;
    case "ox:goto": {
      const i = d.index;
      if (!(Number.isInteger(i) && i >= 0 && i < C.ox.length)) break;
      S.ox.index = i;
      S.ox.stage = "question";
      S.ox.answers[i] = {};
      S.ox.revealed = S.ox.revealed.filter((x) => x !== i);
      S.ox.endsAt = now + C.settings.oxSeconds * 1000;
      break;
    }
    case "ox:reveal":
      if (S.ox.index < 0) break;
      S.ox.stage = "reveal";
      S.ox.endsAt = 0;
      if (!S.ox.revealed.includes(S.ox.index)) S.ox.revealed.push(S.ox.index);
      break;
    case "ox:reset":
      S.ox = fresh(now).ox;
      break;
    case "cloud:open":
      if (Number.isInteger(d.index) && d.index >= 0 && d.index < C.cloudPrompts.length) S.cloud.index = d.index;
      break;
    case "cloud:hide": {
      const h = S.cloud.hidden[S.cloud.index];
      const t = String(d.text ?? "");
      if (t && !h.includes(t)) h.push(t);
      break;
    }
    case "cloud:unhide":
      S.cloud.hidden[S.cloud.index] = [];
      break;
    case "demo:add":
      addBots(S, now);
      break;
    case "demo:remove":
      removeBots(S);
      break;
    case "host:export":
      outs.push({ to: "self", ev: "host:exportData", d: exportBoth(S, now) });
      break;
    case "session:reset":
      whackEnd(S, outs);
      outs.push({ to: "players", ev: "player:reset", d: {} });
      return { outs, reset: true };
    default:
      break;
  }
  return { outs };
}

// ───────────────────────── 참가자 ─────────────────────────

export function onPlayer(S, pid, ev, d, now) {
  const outs = [];
  d = d || {};
  if (ev === "player:join") {
    const name = cleanText(d.name, 10);
    const dept = C.departments.includes(d.dept) ? d.dept : null;
    if (!name) return [{ to: "self", ev: "join:error", d: "닉네임을 입력해 주세요." }];
    if (!dept) return [{ to: "self", ev: "join:error", d: "부서를 선택해 주세요." }];
    const p = S.players[pid];
    if (p) { p.name = name; p.dept = dept; }
    else {
      S.players[pid] = { name, dept, joinedAt: now };
      if (S.whack.status === "running") {
        S.whack.scores[pid] = 0;
        S.whack.participants = Object.keys(S.whack.scores).length;
      }
    }
    return outs;
  }
  if (!S.players[pid]) return outs;

  if (ev === "quiz:submit") {
    const q = S.quiz;
    if (!q.open || d.mode !== q.mode || q.answers[q.mode][pid]) return outs;
    if (!Array.isArray(d.answers) || d.answers.length !== C.quiz.length) return outs;
    q.answers[q.mode][pid] = d.answers.map((a, i) => (Number.isInteger(a) && a >= 0 && a < C.quiz[i].options.length ? a : -1));
  } else if (ev === "vote:cast") {
    const v = S.vote;
    if (d.index !== v.index || v.stage !== "question") return outs;
    const n = C.scenarios[v.index]?.options.length || 0;
    if (!(Number.isInteger(d.option) && d.option >= 0 && d.option < n)) return outs;
    v.votes[v.index][pid] = d.option;
  } else if (ev === "whack:hit") {
    whackHit(S, pid, Number(d.id), now, outs);
  } else if (ev === "ox:answer") {
    const ox = S.ox;
    if (d.index !== ox.index || ox.stage !== "question" || now > ox.endsAt + 300) return outs;
    if (!["O", "X"].includes(d.choice)) return outs;
    ox.answers[ox.index][pid] = d.choice;
  } else if (ev === "cloud:submit") {
    const c = S.cloud;
    if (d.index !== c.index) return outs;
    const text = cleanText(d.text, 15);
    if (!text) return outs;
    const mine = c.entries[c.index].filter((e) => e.pid === pid);
    if (mine.length >= C.settings.cloudMaxPerPerson) return outs;
    c.entries[c.index].push({ pid, text, at: now });
  }
  return outs;
}

// ───────────────────────── 결과 내보내기 ─────────────────────────

export function exportData(S, now) {
  const qs = quizStats(S);
  const players = vals(S.players);
  return {
    title: C.title,
    startedAt: S.startedAt,
    savedAt: new Date(now).toISOString(),
    participants: players.map((p) => ({ name: p.name, dept: p.dept })),
    departments: C.departments.map((d) => ({ dept: d, count: players.filter((p) => p.dept === d).length })),
    quiz: {
      preCount: qs.pre.count, postCount: qs.post.count, preAvg: qs.pre.avg, postAvg: qs.post.avg, matched: qs.matched,
      questions: C.quiz.map((q, i) => ({ question: q.question, answer: q.options[q.answer], pre: qs.pre.per[i], post: qs.post.per[i] })),
    },
    votes: C.scenarios.map((sc, i) => {
      const counts = voteCounts(S, i);
      return { title: sc.title, situation: sc.situation, best: sc.options[sc.best], options: sc.options.map((o, k) => ({ option: o, count: counts[k] })) };
    }),
    whack: {
      participants: S.whack.participants,
      ranking: whackBoard(S).map(({ name, dept, score }) => ({ name, dept, score })),
      departments: whackDepts(S),
      ...whackReview(S),
    },
    ox: {
      ranking: oxBoard(S),
      questions: C.ox.map((q, i) => {
        const a = vals(S.ox.answers[i]);
        return { statement: q.statement, answer: q.answer, responses: a.length, correctRate: a.length ? a.filter((x) => x === q.answer).length / a.length : null };
      }),
    },
    cloud: C.cloudPrompts.map((prompt, i) => ({ prompt, words: cloudWords(S, i) })),
  };
}

function exportCsv(d) {
  const rows = [];
  const pctS = (x) => (x == null ? "" : `${Math.round(x * 100)}%`);
  const add = (...cols) => rows.push(cols.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","));
  add("병원 CS 플레이 결과", d.title);
  add("시작", d.startedAt);
  add("저장", d.savedAt);
  add("참여 인원", d.participants.length);
  add();
  add("[부서별 참여]");
  d.departments.forEach((x) => add(x.dept, x.count));
  add();
  add("[사전·사후 퀴즈]", "사전", "사후");
  add("제출 인원", d.quiz.preCount, d.quiz.postCount);
  add("평균 정답률", pctS(d.quiz.preAvg), pctS(d.quiz.postAvg));
  add(`두 번 모두 참여(${d.quiz.matched.count}명) 평균`, pctS(d.quiz.matched.pre), pctS(d.quiz.matched.post));
  add("문항", "사전 정답률", "사후 정답률", "정답");
  d.quiz.questions.forEach((q, i) => add(`Q${i + 1}. ${q.question}`, pctS(q.pre), pctS(q.post), q.answer));
  add();
  add("[응대 멘트 투표]", "선택지", "응답 수", "추천 응대");
  d.votes.forEach((v) => v.options.forEach((o) => add(v.title, o.option, o.count, o.option === v.best ? "추천" : "")));
  add();
  add("[금지 멘트 잡기 순위]", "부서", "점수");
  d.whack.ranking.forEach((r, i) => add(`${i + 1}위 ${r.name}`, r.dept, r.score));
  add("금지 멘트", "바꿔 말하기", "평균 캐치율");
  d.whack.bad.forEach((b) => add(b.text, b.alt, pctS(b.catchRate)));
  add();
  add("[부서 대항 OX]", "점수", "인원");
  d.ox.ranking.forEach((r) => add(r.dept, r.score, r.members));
  add("문항", "정답", "응답 수", "정답률");
  d.ox.questions.forEach((q) => add(q.statement, q.answer, q.responses, pctS(q.correctRate)));
  add();
  add("[익명 워드클라우드]", "응답", "횟수", "화면 숨김");
  d.cloud.forEach((c) => c.words.forEach((w) => add(c.prompt, w.text, w.count, w.hidden ? "숨김" : "")));
  return rows.join("\r\n");
}

function exportBoth(S, now) {
  const data = exportData(S, now);
  const dt = new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return { name: `cs-play-${dt}`, json: JSON.stringify(data, null, 2), csv: "﻿" + exportCsv(data) };
}

/** 세션 초기화 전에 결과를 보관해 둔다 (최근 5개). */
export function archiveOf(S, now) {
  if (!Object.keys(S.players).length) return S.archive || [];
  return [{ savedAt: new Date(now).toISOString(), data: exportData(S, now) }, ...(S.archive || [])].slice(0, 5);
}
