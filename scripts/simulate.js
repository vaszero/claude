'use strict';
/*
 * 리허설용 가상 참가자
 *   node scripts/simulate.js [인원수] [서버주소]
 *   예) node scripts/simulate.js 25 http://localhost:3000
 * 강사 화면을 직접 넘기면서 가상 참가자들이 퀴즈·투표·게임에 자동으로 응답합니다.
 */
const { io } = require('socket.io-client');

const N = Number(process.argv[2]) || 20;
const URL = process.argv[3] || 'http://localhost:3000';
const NAMES = ['김간호', '접수천사', '이치료', '박원무', '최방사', '정실장', '한수납', '윤코디', '강주임', '조선생',
  '오간호', '서치료', '신원무', '권팀장', '황검사', '안코디', '송간호', '류치료', '홍접수', '전주임'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const CLOUD = [
  ['반말하는 환자', '대기 항의', '진료비 항의', '반복 질문', '전화 폭주', '대기 항의', '보호자 항의'],
  ['친절', '바쁨', '가족같은', '친절', '성장 중', '따뜻함', '바쁨'],
  ['고맙습니다', '덕분에 나았어요', '친절하네요', '고맙습니다', '수고하셨어요'],
  ['쿠션 언어', '대기 시간 안내', '먼저 인사하기', '공감 먼저', '쿠션 언어', '성함+님'],
];

let content = null;

for (let n = 0; n < N; n += 1) {
  const pid = `sim-${n}-${Math.random().toString(36).slice(2, 8)}`;
  const skill = 0.45 + Math.random() * 0.4; // 정답 확률
  const s = io(URL, { auth: { role: 'player', pid }, transports: ['websocket'] });
  const done = new Set();

  s.on('config', (c) => { content = c; });
  s.on('player:need-join', () => {
    setTimeout(() => {
      const name = `${NAMES[n % NAMES.length]}${n >= NAMES.length ? n : ''}`;
      s.emit('player:join', { name, dept: pick(content.departments.slice(0, 4)) });
    }, 200 + Math.random() * 2500);
  });
  s.on('player:reset', () => done.clear());

  s.on('player:state', (v) => {
    const once = (key, delay, fn) => {
      if (done.has(key)) return;
      done.add(key);
      setTimeout(fn, delay);
    };
    if (v.phase === 'quiz' && v.quiz.open && !v.quiz.submitted) {
      once(`quiz-${v.quiz.mode}`, 1500 + Math.random() * 6000, () => {
        const boost = v.quiz.mode === 'post' ? 0.3 : 0;
        const answers = content.quiz.map((q, i) => (Math.random() < skill + boost ? HINT[i] : Math.floor(Math.random() * q.options.length)));
        s.emit('quiz:submit', { mode: v.quiz.mode, answers });
      });
    }
    if (v.phase === 'vote' && v.vote.stage === 'question') {
      once(`vote-${v.vote.index}`, 800 + Math.random() * 5000, () => {
        const best = VOTE_HINT[v.vote.index];
        const opt = Math.random() < 0.55 ? best : Math.floor(Math.random() * content.scenarios[v.vote.index].options.length);
        s.emit('vote:cast', { index: v.vote.index, option: opt });
      });
    }
    if (v.phase === 'ox' && v.ox.stage === 'question') {
      once(`ox-${v.ox.index}`, 1000 + Math.random() * 7000, () => {
        const right = OX_HINT[v.ox.index];
        s.emit('ox:answer', { index: v.ox.index, choice: Math.random() < skill + 0.15 ? right : (right === 'O' ? 'X' : 'O') });
      });
    }
    if (v.phase === 'cloud') {
      const list = CLOUD[v.cloud.index] || ['좋아요'];
      once(`cloud-${v.cloud.index}`, 1000 + Math.random() * 8000, () => {
        s.emit('cloud:submit', { index: v.cloud.index, text: pick(list) });
        if (Math.random() < 0.4) setTimeout(() => s.emit('cloud:submit', { index: v.cloud.index, text: pick(list) }), 2000);
      });
    }
  });

  s.on('whack:spawn', (b) => {
    const isBad = BAD.has(b.text);
    const willHit = isBad ? Math.random() < 0.35 : Math.random() < 0.04;
    if (willHit) setTimeout(() => s.emit('whack:hit', { id: b.id }), 300 + Math.random() * (b.life - 400));
  });
}

// 시뮬레이션 전용: 콘텐츠 파일에서 정답 힌트를 읽어 그럴듯한 응답 분포를 만든다
const raw = require(process.env.CONTENT_FILE || '../content/hospital-cs.json');
const HINT = raw.quiz.map((q) => q.answer - 1);
const VOTE_HINT = raw.scenarios.map((s) => s.best - 1);
const OX_HINT = raw.ox.map((q) => q.answer);
const BAD = new Set(raw.whack.bad.map((b) => b.text));

console.log(`가상 참가자 ${N}명이 ${URL} 에 접속합니다. 종료: Ctrl+C`);
