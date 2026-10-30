'use strict';
/*
 * 병원 CS 플레이 — QR 참여형 실시간 교육 게임 서버
 *  - /        참가자(휴대폰) 화면
 *  - /host    강사(프로젝터) 화면  →  /host?key=진행자키
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || String(crypto.randomInt(1000, 10000));
const CONTENT_FILE = process.env.CONTENT_FILE || path.join(__dirname, 'content', 'hospital-cs.json');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// ───────────────────────── 콘텐츠 ─────────────────────────

function loadContent(file) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fail = (m) => { throw new Error(`[콘텐츠 오류] ${m} — ${file}`); };
  if (!Array.isArray(c.departments) || !c.departments.length) fail('departments(부서 목록)가 비어 있습니다');
  (c.quiz || []).forEach((q, i) => {
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2) fail(`quiz ${i + 1}번 문항 형식`);
    if (!(q.answer >= 1 && q.answer <= q.options.length)) fail(`quiz ${i + 1}번 정답 번호(1부터)`);
    q.answer -= 1; // 파일은 1부터, 내부는 0부터
  });
  (c.scenarios || []).forEach((s, i) => {
    if (!s.situation || !Array.isArray(s.options) || s.options.length < 2) fail(`scenarios ${i + 1}번 형식`);
    if (!(s.best >= 1 && s.best <= s.options.length)) fail(`scenarios ${i + 1}번 추천 번호(1부터)`);
    s.best -= 1;
  });
  (c.ox || []).forEach((q, i) => {
    if (!q.statement || !['O', 'X'].includes(q.answer)) fail(`ox ${i + 1}번 (answer는 "O" 또는 "X")`);
  });
  if (!c.whack || !c.whack.bad?.length || !c.whack.good?.length) fail('whack(금지/좋은 멘트)');
  if (!c.cloudPrompts?.length) fail('cloudPrompts(워드클라우드 질문)');
  c.quiz = c.quiz || [];
  c.scenarios = c.scenarios || [];
  c.ox = c.ox || [];
  c.settings = Object.assign({ whackSeconds: 60, oxSeconds: 12, cloudMaxPerPerson: 3 }, c.settings);
  return c;
}

const content = loadContent(CONTENT_FILE);

function publicContent() {
  return {
    title: content.title,
    brand: content.brand,
    departments: content.departments,
    settings: content.settings,
    quiz: content.quiz.map((q) => ({ question: q.question, options: q.options })),
    scenarios: content.scenarios.map((s) => ({ tag: s.tag, title: s.title, situation: s.situation, quote: s.quote, options: s.options })),
    ox: content.ox.map((q) => ({ statement: q.statement })),
    cloudPrompts: content.cloudPrompts,
  };
}

// ───────────────────────── 상태 ─────────────────────────

function freshState() {
  return {
    startedAt: new Date().toISOString(),
    phase: 'lobby',
    players: new Map(), // pid -> { pid, name, dept, joinedAt, sockets:Set }
    quiz: { mode: null, open: false, answers: { pre: new Map(), post: new Map() } },
    vote: { index: 0, stage: 'question', votes: content.scenarios.map(() => new Map()) },
    whack: freshWhack(),
    ox: { index: -1, stage: 'ready', endsAt: 0, answers: content.ox.map(() => new Map()), revealed: new Set(), timer: null },
    cloud: { index: 0, entries: content.cloudPrompts.map(() => []), hidden: content.cloudPrompts.map(() => new Set()) },
  };
}

function freshWhack() {
  return {
    status: 'ready', // ready | running | ended
    endsAt: 0,
    seq: 0,
    scores: new Map(), // pid -> 점수
    bubbles: new Map(), // id -> { id, slot, text, bad, alt, born, life, hits:Set, first }
    badStats: new Map(), // text -> { text, alt, shown, hits, caught }
    goodMistakes: new Map(), // text -> 잘못 누른 횟수
    participants: 0,
    timers: new Set(),
  };
}

let state = freshState();
let joinUrl = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : `http://localhost:${PORT}`;

// ───────────────────────── 서버 ─────────────────────────

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.disable('x-powered-by');
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));

app.get('/api/qr.svg', async (req, res) => {
  try {
    const svg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14213d', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch (e) {
    res.status(500).end();
  }
});

function requireKey(req, res, next) {
  if (req.query.key !== HOST_KEY) return res.status(403).send('진행자 키가 필요합니다');
  next();
}

app.get('/api/export.json', requireKey, (req, res) => {
  res.set('Content-Disposition', `attachment; filename="cs-play-${stamp()}.json"`);
  res.json(exportData());
});

app.get('/api/export.csv', requireKey, (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="cs-play-${stamp()}.csv"`);
  res.send('﻿' + exportCsv(exportData()));
});

app.get('/healthz', (req, res) => res.send('ok'));

// ───────────────────────── 유틸 ─────────────────────────

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function cleanText(s, max) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

function detectJoinUrl(headers) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = String(headers['x-forwarded-host'] || headers.host || `localhost:${PORT}`).split(',')[0].trim();
  const proto = String(headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  if (/^(localhost|127\.|\[::1\])/.test(host)) {
    const ip = lanIp();
    if (ip) return `http://${ip}:${PORT}`;
  }
  return `${proto}://${host}`;
}

const onlinePlayers = () => [...state.players.values()].filter((p) => p.sockets.size > 0);
const deptOf = (pid) => state.players.get(pid)?.dept;
const nameOf = (pid) => state.players.get(pid)?.name || '';

function quizScore(arr) {
  return content.quiz.reduce((s, q, i) => s + (arr[i] === q.answer ? 1 : 0), 0);
}

// ───────────────────────── 집계 ─────────────────────────

function quizStats() {
  const n = content.quiz.length || 1;
  const calc = (map) => {
    const arr = [...map.values()];
    return {
      count: arr.length,
      avg: arr.length ? arr.reduce((s, a) => s + quizScore(a), 0) / (arr.length * n) : null,
      per: content.quiz.map((q, i) => (arr.length ? arr.filter((a) => a[i] === q.answer).length / arr.length : null)),
    };
  };
  const { pre, post } = state.quiz.answers;
  const both = [...post.keys()].filter((id) => pre.has(id));
  return {
    pre: calc(pre),
    post: calc(post),
    matched: {
      count: both.length,
      pre: both.length ? both.reduce((s, id) => s + quizScore(pre.get(id)), 0) / (both.length * n) : null,
      post: both.length ? both.reduce((s, id) => s + quizScore(post.get(id)), 0) / (both.length * n) : null,
    },
  };
}

function voteCounts(i) {
  const counts = content.scenarios[i].options.map(() => 0);
  for (const v of state.vote.votes[i].values()) counts[v] += 1;
  return counts;
}

function whackBoard(limit) {
  const rows = [...state.whack.scores.entries()]
    .filter(([pid]) => state.players.has(pid))
    .map(([pid, score]) => ({ pid, name: nameOf(pid), dept: deptOf(pid), score }))
    .sort((a, b) => b.score - a.score);
  return limit ? rows.slice(0, limit) : rows;
}

function whackDepts() {
  const agg = new Map();
  for (const r of whackBoard()) {
    const a = agg.get(r.dept) || { dept: r.dept, sum: 0, n: 0 };
    a.sum += r.score; a.n += 1;
    agg.set(r.dept, a);
  }
  return [...agg.values()].map((a) => ({ dept: a.dept, n: a.n, avg: Math.round(a.sum / a.n) })).sort((a, b) => b.avg - a.avg);
}

function whackReview() {
  const w = state.whack;
  const bad = [...w.badStats.values()].map((b) => ({
    text: b.text,
    alt: b.alt,
    shown: b.shown,
    catchRate: w.participants && b.shown ? Math.min(1, b.hits / (b.shown * w.participants)) : 0,
  }));
  const confused = [...w.goodMistakes.entries()].map(([text, n]) => ({ text, n })).sort((a, b) => b.n - a.n).slice(0, 3);
  return { bad, confused };
}

function oxBoard() {
  const members = new Map();
  for (const p of state.players.values()) members.set(p.dept, (members.get(p.dept) || 0) + 1);
  const rows = content.departments
    .filter((d) => members.get(d))
    .map((d) => ({ dept: d, members: members.get(d), score: 0, answered: 0 }));
  for (const i of state.ox.revealed) {
    const ans = content.ox[i].answer;
    for (const row of rows) {
      let total = 0, correct = 0;
      for (const [pid, a] of state.ox.answers[i]) {
        if (deptOf(pid) !== row.dept) continue;
        total += 1;
        if (a === ans) correct += 1;
      }
      if (total) row.score += Math.round((correct / total) * 100);
      row.answered += total;
    }
  }
  return rows.sort((a, b) => b.score - a.score);
}

function cloudWords(i) {
  const counts = new Map();
  for (const e of state.cloud.entries[i]) {
    const key = e.text.replace(/[.!?~,]+$/g, '');
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const hidden = state.cloud.hidden[i];
  return [...counts.entries()].map(([text, count]) => ({ text, count, hidden: hidden.has(text) })).sort((a, b) => b.count - a.count);
}

// ───────────────────────── 화면 데이터 ─────────────────────────

function hostView() {
  const s = state;
  const players = [...s.players.values()];
  const deptCounts = content.departments.map((d) => ({ dept: d, count: players.filter((p) => p.dept === d).length }));
  const oxI = s.ox.index;
  const oxCounts = { O: 0, X: 0 };
  if (oxI >= 0) for (const a of s.ox.answers[oxI].values()) oxCounts[a] += 1;
  const cloudAll = cloudWords(s.cloud.index);

  return {
    now: Date.now(),
    phase: s.phase,
    joinUrl,
    total: players.length,
    online: onlinePlayers().length,
    deptCounts,
    recent: players.slice(-40).map((p) => ({ name: p.name, dept: p.dept })),
    quiz: { mode: s.quiz.mode, open: s.quiz.open, stats: quizStats() },
    vote: {
      index: s.vote.index,
      stage: s.vote.stage,
      total: s.vote.votes[s.vote.index]?.size || 0,
      counts: content.scenarios.length ? voteCounts(s.vote.index) : [],
    },
    whack: {
      status: s.whack.status,
      endsAt: s.whack.endsAt,
      participants: s.whack.participants,
      board: whackBoard(8).map(({ name, dept, score }) => ({ name, dept, score })),
      depts: whackDepts(),
      review: s.whack.status === 'ended' ? whackReview() : null,
    },
    ox: {
      index: oxI,
      stage: s.ox.stage,
      endsAt: s.ox.endsAt,
      answered: oxI >= 0 ? s.ox.answers[oxI].size : 0,
      counts: oxCounts,
      board: oxBoard(),
      revealedCount: s.ox.revealed.size,
    },
    cloud: {
      index: s.cloud.index,
      words: cloudAll,
      entries: s.cloud.entries[s.cloud.index].length,
      people: new Set(s.cloud.entries[s.cloud.index].map((e) => e.pid)).size,
    },
    report: s.phase === 'report' ? reportData() : null,
  };
}

function reportData() {
  return {
    votes: content.scenarios.map((sc, i) => {
      const counts = voteCounts(i);
      const total = counts.reduce((a, b) => a + b, 0);
      return { title: sc.title, total, bestRate: total ? counts[sc.best] / total : null };
    }),
    cloud: content.cloudPrompts.map((prompt, i) => ({
      prompt,
      words: cloudWords(i).filter((w) => !w.hidden).slice(0, 10),
    })),
    whackTop: whackBoard(3).map(({ name, dept, score }) => ({ name, dept, score })),
  };
}

function playerView(pid) {
  const s = state;
  const p = s.players.get(pid);
  const pre = s.quiz.answers.pre.get(pid);
  const post = s.quiz.answers.post.get(pid);
  const vI = s.vote.index;
  const oxI = s.ox.index;
  const w = s.whack;
  let rank = null;
  if (w.status === 'ended') {
    const idx = whackBoard().findIndex((r) => r.pid === pid);
    rank = idx >= 0 ? idx + 1 : null;
  }
  return {
    now: Date.now(),
    phase: s.phase,
    me: { name: p.name, dept: p.dept },
    quiz: {
      mode: s.quiz.mode,
      open: s.quiz.open,
      submitted: s.quiz.mode ? s.quiz.answers[s.quiz.mode].has(pid) : false,
      preScore: post && pre ? quizScore(pre) : null,
      postScore: post ? quizScore(post) : null,
      total: content.quiz.length,
    },
    vote: {
      index: vI,
      stage: s.vote.stage,
      mine: s.vote.votes[vI]?.has(pid) ? s.vote.votes[vI].get(pid) : null,
      best: s.vote.stage === 'answer' ? content.scenarios[vI].best : null,
      counts: s.vote.stage !== 'question' && content.scenarios.length ? voteCounts(vI) : null,
    },
    whack: {
      status: w.status,
      endsAt: w.endsAt,
      score: w.scores.get(pid) ?? 0,
      rank,
      of: w.scores.size,
      bubbles: w.status === 'running'
        ? [...w.bubbles.values()].map((b) => ({ id: b.id, slot: b.slot, text: b.text, hit: b.hits.has(pid) }))
        : [],
    },
    ox: {
      index: oxI,
      stage: s.ox.stage,
      endsAt: s.ox.endsAt,
      mine: oxI >= 0 ? s.ox.answers[oxI].get(pid) || null : null,
      answer: s.ox.stage === 'reveal' && oxI >= 0 ? content.ox[oxI].answer : null,
      explain: s.ox.stage === 'reveal' && oxI >= 0 ? content.ox[oxI].explain : null,
    },
    cloud: {
      index: s.cloud.index,
      mine: s.cloud.entries[s.cloud.index].filter((e) => e.pid === pid).map((e) => e.text),
    },
  };
}

let syncPending = false;
function sync() {
  if (syncPending) return;
  syncPending = true;
  setTimeout(() => {
    syncPending = false;
    io.to('hosts').emit('host:state', hostView());
    for (const p of state.players.values()) {
      if (p.sockets.size) io.to(`p:${p.pid}`).emit('player:state', playerView(p.pid));
    }
  }, 60);
}

// ───────────────────────── 금지 멘트 잡기 ─────────────────────────

function wTimer(fn, ms) {
  const w = state.whack;
  const t = setTimeout(() => { w.timers.delete(t); fn(); }, ms);
  w.timers.add(t);
}

function whackStop() {
  const w = state.whack;
  for (const t of w.timers) clearTimeout(t);
  w.timers.clear();
  for (const id of w.bubbles.keys()) io.emit('whack:despawn', { id });
  w.bubbles.clear();
}

function whackStart() {
  whackStop();
  const w = (state.whack = freshWhack());
  const dur = content.settings.whackSeconds * 1000;
  w.status = 'running';
  w.startedAt = Date.now();
  w.endsAt = w.startedAt + dur;
  for (const p of onlinePlayers()) w.scores.set(p.pid, 0);
  w.participants = w.scores.size;
  const loop = () => {
    if (w !== state.whack || w.status !== 'running') return;
    whackSpawn(w);
    const progress = (Date.now() - w.startedAt) / dur;
    wTimer(loop, 1050 - 450 * progress + Math.random() * 300); // 갈수록 빨라짐
  };
  wTimer(loop, 900);
  wTimer(() => whackEnd(w), dur);
  sync();
}

function whackSpawn(w) {
  const used = new Set([...w.bubbles.values()].map((b) => b.slot));
  const free = [...Array(9).keys()].filter((i) => !used.has(i));
  if (!free.length) return;
  const slot = free[Math.floor(Math.random() * free.length)];
  const onScreen = new Set([...w.bubbles.values()].map((b) => b.text));
  const bad = Math.random() < 0.62;
  const pool = bad ? content.whack.bad : content.whack.good.map((text) => ({ text }));
  const candidates = pool.filter((x) => !onScreen.has(x.text));
  if (!candidates.length) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const progress = (Date.now() - w.startedAt) / (w.endsAt - w.startedAt);
  const life = Math.round(3000 - 900 * progress);
  const b = { id: ++w.seq, slot, text: pick.text, bad, alt: pick.alt || '', born: Date.now(), life, hits: new Set(), first: null };
  w.bubbles.set(b.id, b);
  if (bad) {
    const st = w.badStats.get(b.text) || { text: b.text, alt: b.alt, shown: 0, hits: 0 };
    st.shown += 1;
    w.badStats.set(b.text, st);
  }
  io.to('players').emit('whack:spawn', { id: b.id, slot, text: b.text, life });
  io.to('hosts').emit('whack:spawn', { id: b.id, slot, text: b.text, life, bad });
  wTimer(() => {
    if (w.bubbles.delete(b.id)) io.emit('whack:despawn', { id: b.id });
  }, life);
}

function whackHit(pid, id) {
  const w = state.whack;
  if (w.status !== 'running') return null;
  const b = w.bubbles.get(id);
  if (!b || b.hits.has(pid)) return null;
  b.hits.add(pid);
  if (!w.scores.has(pid)) { w.scores.set(pid, 0); w.participants = w.scores.size; }
  let pts;
  let first = false;
  if (b.bad) {
    const t = Math.min(1, (Date.now() - b.born) / b.life);
    pts = 30 + Math.round(70 * (1 - t));
    if (!b.first) { b.first = pid; first = true; pts += 20; }
    w.badStats.get(b.text).hits += 1;
  } else {
    pts = -50;
    w.goodMistakes.set(b.text, (w.goodMistakes.get(b.text) || 0) + 1);
  }
  w.scores.set(pid, w.scores.get(pid) + pts);
  io.to('hosts').emit('whack:fx', { id, slot: b.slot, name: nameOf(pid), bad: b.bad, first, pts });
  sync();
  return { id, pts, bad: b.bad, first };
}

function whackEnd(w) {
  if (w !== state.whack) return;
  whackStop();
  w.status = 'ended';
  sync();
}

// ───────────────────────── 부서 대항 OX ─────────────────────────

function oxGoto(i) {
  const ox = state.ox;
  if (!(i >= 0 && i < content.ox.length)) return;
  clearTimeout(ox.timer);
  ox.index = i;
  ox.stage = 'question';
  ox.answers[i] = new Map();
  ox.revealed.delete(i);
  ox.endsAt = Date.now() + content.settings.oxSeconds * 1000;
  ox.timer = setTimeout(() => {
    if (ox === state.ox && ox.index === i && ox.stage === 'question') { ox.stage = 'locked'; sync(); }
  }, content.settings.oxSeconds * 1000 + 300);
}

function oxReveal() {
  const ox = state.ox;
  if (ox.index < 0) return;
  clearTimeout(ox.timer);
  ox.stage = 'reveal';
  ox.endsAt = 0;
  ox.revealed.add(ox.index);
}

// ───────────────────────── 결과 저장 ─────────────────────────

function exportData() {
  const qs = quizStats();
  return {
    title: content.title,
    startedAt: state.startedAt,
    savedAt: new Date().toISOString(),
    participants: [...state.players.values()].map((p) => ({ name: p.name, dept: p.dept })),
    departments: content.departments.map((d) => ({ dept: d, count: [...state.players.values()].filter((p) => p.dept === d).length })),
    quiz: {
      preCount: qs.pre.count,
      postCount: qs.post.count,
      preAvg: qs.pre.avg,
      postAvg: qs.post.avg,
      matched: qs.matched,
      questions: content.quiz.map((q, i) => ({ question: q.question, answer: q.options[q.answer], pre: qs.pre.per[i], post: qs.post.per[i] })),
    },
    votes: content.scenarios.map((sc, i) => {
      const counts = voteCounts(i);
      return { title: sc.title, situation: sc.situation, best: sc.options[sc.best], options: sc.options.map((o, k) => ({ option: o, count: counts[k] })) };
    }),
    whack: {
      participants: state.whack.participants,
      ranking: whackBoard().map(({ name, dept, score }) => ({ name, dept, score })),
      departments: whackDepts(),
      ...whackReview(),
    },
    ox: {
      ranking: oxBoard(),
      questions: content.ox.map((q, i) => {
        const a = [...state.ox.answers[i].values()];
        return { statement: q.statement, answer: q.answer, responses: a.length, correctRate: a.length ? a.filter((x) => x === q.answer).length / a.length : null };
      }),
    },
    cloud: content.cloudPrompts.map((prompt, i) => ({ prompt, words: cloudWords(i) })),
  };
}

function exportCsv(d) {
  const rows = [];
  const pctS = (x) => (x == null ? '' : `${Math.round(x * 100)}%`);
  const add = (...cols) => rows.push(cols.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  add('병원 CS 플레이 결과', d.title);
  add('시작', d.startedAt);
  add('저장', d.savedAt);
  add('참여 인원', d.participants.length);
  add();
  add('[부서별 참여]');
  d.departments.forEach((x) => add(x.dept, x.count));
  add();
  add('[사전·사후 퀴즈]', '사전', '사후');
  add('제출 인원', d.quiz.preCount, d.quiz.postCount);
  add('평균 정답률', pctS(d.quiz.preAvg), pctS(d.quiz.postAvg));
  add(`두 번 모두 참여(${d.quiz.matched.count}명) 평균`, pctS(d.quiz.matched.pre), pctS(d.quiz.matched.post));
  add('문항', '사전 정답률', '사후 정답률', '정답');
  d.quiz.questions.forEach((q, i) => add(`Q${i + 1}. ${q.question}`, pctS(q.pre), pctS(q.post), q.answer));
  add();
  add('[응대 멘트 투표]', '선택지', '응답 수', '추천 응대');
  d.votes.forEach((v) => v.options.forEach((o) => add(v.title, o.option, o.count, o.option === v.best ? '추천' : '')));
  add();
  add('[금지 멘트 잡기 순위]', '부서', '점수');
  d.whack.ranking.forEach((r, i) => add(`${i + 1}위 ${r.name}`, r.dept, r.score));
  add('금지 멘트', '바꿔 말하기', '평균 캐치율');
  d.whack.bad.forEach((b) => add(b.text, b.alt, pctS(b.catchRate)));
  add();
  add('[부서 대항 OX]', '점수', '인원');
  d.ox.ranking.forEach((r) => add(r.dept, r.score, r.members));
  add('문항', '정답', '응답 수', '정답률');
  d.ox.questions.forEach((q) => add(q.statement, q.answer, q.responses, pctS(q.correctRate)));
  add();
  add('[익명 워드클라우드]', '응답', '횟수', '화면 숨김');
  d.cloud.forEach((c) => c.words.forEach((w) => add(c.prompt, w.text, w.count, w.hidden ? '숨김' : '')));
  return rows.join('\r\n');
}

function saveSnapshot(reason) {
  if (!state.players.size) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, `cs-play-${stamp()}-${reason}.json`);
    fs.writeFileSync(file, JSON.stringify(exportData(), null, 2));
    console.log(`[저장] ${file}`);
  } catch (e) {
    console.warn('[저장 실패]', e.message);
  }
}

// ───────────────────────── 소켓 ─────────────────────────

const PHASES = ['lobby', 'quiz', 'vote', 'whack', 'ox', 'cloud', 'report'];

io.on('connection', (socket) => {
  const auth = socket.handshake.auth || {};

  if (auth.role === 'host') {
    if (auth.key !== HOST_KEY) {
      socket.emit('auth:fail');
      setTimeout(() => socket.disconnect(true), 200);
      return;
    }
    joinUrl = detectJoinUrl(socket.handshake.headers);
    socket.join('hosts');
    socket.emit('host:config', { content, joinUrl });
    socket.emit('host:state', hostView());
    bindHost(socket);
    return;
  }

  // 참가자
  const pid = cleanText(auth.pid, 64);
  if (!pid) { socket.disconnect(true); return; }
  socket.data.pid = pid;
  socket.emit('config', publicContent());

  const attach = (p) => {
    p.sockets.add(socket.id);
    socket.join('players');
    socket.join(`p:${pid}`);
    socket.emit('player:state', playerView(pid));
    sync();
  };

  const existing = state.players.get(pid);
  if (existing) attach(existing);
  else socket.emit('player:need-join');

  socket.on('player:join', (d = {}) => {
    const name = cleanText(d.name, 10);
    const dept = content.departments.includes(d.dept) ? d.dept : null;
    if (!name) return socket.emit('join:error', '닉네임을 입력해 주세요.');
    if (!dept) return socket.emit('join:error', '부서를 선택해 주세요.');
    let p = state.players.get(pid);
    if (p) { p.name = name; p.dept = dept; }
    else {
      p = { pid, name, dept, joinedAt: Date.now(), sockets: new Set() };
      state.players.set(pid, p);
      if (state.whack.status === 'running') { state.whack.scores.set(pid, 0); state.whack.participants = state.whack.scores.size; }
    }
    attach(p);
  });

  const me = () => state.players.get(pid);

  socket.on('quiz:submit', (d = {}) => {
    const q = state.quiz;
    if (!me() || !q.open || d.mode !== q.mode || q.answers[q.mode].has(pid)) return;
    if (!Array.isArray(d.answers) || d.answers.length !== content.quiz.length) return;
    const ans = d.answers.map((a, i) => (Number.isInteger(a) && a >= 0 && a < content.quiz[i].options.length ? a : -1));
    q.answers[q.mode].set(pid, ans);
    sync();
  });

  socket.on('vote:cast', (d = {}) => {
    const v = state.vote;
    if (!me() || d.index !== v.index || v.stage !== 'question') return;
    const n = content.scenarios[v.index]?.options.length || 0;
    if (!(Number.isInteger(d.option) && d.option >= 0 && d.option < n)) return;
    v.votes[v.index].set(pid, d.option);
    sync();
  });

  socket.on('whack:hit', (d = {}) => {
    if (!me()) return;
    const r = whackHit(pid, Number(d.id));
    if (r) socket.emit('whack:hitres', r);
  });

  socket.on('ox:answer', (d = {}) => {
    const ox = state.ox;
    if (!me() || d.index !== ox.index || ox.stage !== 'question' || Date.now() > ox.endsAt + 300) return;
    if (!['O', 'X'].includes(d.choice)) return;
    ox.answers[ox.index].set(pid, d.choice);
    sync();
  });

  socket.on('cloud:submit', (d = {}) => {
    const c = state.cloud;
    if (!me() || d.index !== c.index) return;
    const text = cleanText(d.text, 15);
    if (!text) return;
    const mine = c.entries[c.index].filter((e) => e.pid === pid);
    if (mine.length >= content.settings.cloudMaxPerPerson) return;
    c.entries[c.index].push({ pid, text, at: Date.now() });
    sync();
  });

  socket.on('disconnect', () => {
    const p = state.players.get(pid);
    if (p) { p.sockets.delete(socket.id); sync(); }
  });
});

function bindHost(socket) {
  const on = (ev, fn) => socket.on(ev, (d = {}) => { try { fn(d); sync(); } catch (e) { console.error(ev, e); } });

  on('host:phase', ({ phase }) => {
    if (!PHASES.includes(phase)) return;
    if (state.phase === 'whack' && phase !== 'whack' && state.whack.status === 'running') whackEnd(state.whack);
    state.phase = phase;
    if (phase === 'report') saveSnapshot('report');
  });

  on('quiz:open', ({ mode }) => {
    if (!['pre', 'post'].includes(mode)) return;
    state.quiz.mode = mode;
    state.quiz.open = true;
  });
  on('quiz:close', () => { state.quiz.open = false; });

  on('vote:goto', ({ index }) => {
    if (!(index >= 0 && index < content.scenarios.length)) return;
    state.vote.index = index;
    state.vote.stage = 'question';
  });
  on('vote:stage', ({ stage }) => {
    if (['question', 'result', 'answer'].includes(stage)) state.vote.stage = stage;
  });

  on('whack:start', () => whackStart());
  on('whack:stop', () => whackEnd(state.whack));
  on('whack:reset', () => { whackStop(); state.whack = freshWhack(); });

  on('ox:goto', ({ index }) => oxGoto(index));
  on('ox:reveal', () => oxReveal());
  on('ox:reset', () => { clearTimeout(state.ox.timer); state.ox = freshState().ox; });

  on('cloud:open', ({ index }) => {
    if (index >= 0 && index < content.cloudPrompts.length) state.cloud.index = index;
  });
  on('cloud:hide', ({ text }) => { state.cloud.hidden[state.cloud.index].add(String(text)); });
  on('cloud:unhide', () => { state.cloud.hidden[state.cloud.index].clear(); });

  on('session:reset', () => {
    saveSnapshot('reset');
    whackStop();
    clearTimeout(state.ox.timer);
    state = freshState();
    io.to('players').emit('player:reset');
    for (const s of io.sockets.sockets.values()) {
      if (s.data.pid) { s.leave('players'); s.leave(`p:${s.data.pid}`); }
    }
  });
}

server.listen(PORT, () => {
  const ip = lanIp();
  console.log('──────────────────────────────────────────');
  console.log(` ${content.title} 서버 실행 중`);
  console.log(` 강사 화면 : http://localhost:${PORT}/host?key=${HOST_KEY}`);
  if (ip) console.log(` 같은 와이파이 참가자 : http://${ip}:${PORT}`);
  if (process.env.PUBLIC_URL) console.log(` 공개 주소 : ${process.env.PUBLIC_URL}`);
  console.log(` 진행자 키 : ${HOST_KEY}${process.env.HOST_KEY ? '' : '  (HOST_KEY 환경변수로 고정할 수 있어요)'}`);
  console.log('──────────────────────────────────────────');
});
