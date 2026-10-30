(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = 'ABCDEFGH';
  const app = $('#app');

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, val) { try { localStorage.setItem(k, val); } catch (e) { /* 저장 불가 */ } },
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  let pid = store.get('csplay-pid');
  if (!pid) { pid = uuid(); store.set('csplay-pid', pid); }

  let content = null;
  let v = null;
  let needJoin = false;
  let offset = 0;
  let viewKey = '';
  let myScore = 0;
  const quizLocal = { mode: null, i: 0, answers: [] };
  const pbubbles = new Map();
  const now = () => Date.now() + offset;

  const socket = io({ auth: { role: 'player', pid } });
  const send = (ev, data) => socket.emit(ev, data || {});

  socket.on('connect', () => $('#pconn').classList.remove('off'));
  socket.on('disconnect', () => $('#pconn').classList.add('off'));
  socket.on('config', (c) => {
    content = c;
    $('#ptitle').textContent = c.title;
    if (c.logo && !$('.plogo')) {
      const img = document.createElement('img');
      img.className = 'plogo';
      img.src = c.logo;
      img.alt = '';
      img.onerror = () => img.remove();
      $('.pbar').prepend(img);
    }
    document.title = c.title;
    if (needJoin) showJoin();
  });
  socket.on('player:need-join', () => { needJoin = true; v = null; if (content) showJoin(); });
  socket.on('join:error', (m) => { const e = $('.err', app); if (e) e.textContent = m; });
  socket.on('player:reset', () => {
    needJoin = true; v = null; viewKey = '';
    quizLocal.mode = null;
    $('#me').textContent = '';
    showJoin();
    toast('새 교육이 시작되었습니다. 다시 입장해 주세요.');
  });
  socket.on('player:state', (s) => {
    needJoin = false;
    offset = s.now - Date.now();
    v = s;
    $('#me').textContent = `${s.me.name} · ${s.me.dept}`;
    myScore = s.whack.score;
    syncBubbles(s);
    render();
  });
  socket.on('whack:spawn', (b) => { pbubbles.set(b.id, { ...b, hit: false }); drawBubble(pbubbles.get(b.id)); });
  socket.on('whack:despawn', ({ id }) => {
    pbubbles.delete(id);
    const el = document.getElementById(`pb${id}`);
    if (el) setTimeout(() => el.remove(), el.classList.contains('hit') ? 350 : 0);
  });
  socket.on('whack:hitres', (r) => {
    myScore += r.pts;
    const sc = $('[data-b=score]', app);
    if (sc) sc.textContent = myScore;
    const el = document.getElementById(`pb${r.id}`);
    if (!el) return;
    el.classList.add(r.bad ? 'badok' : 'good');
    const fx = document.createElement('div');
    fx.className = `pfx ${r.pts > 0 ? 'plus' : 'minus'}`;
    fx.textContent = r.pts > 0 ? `+${r.pts}${r.first ? ' 첫 캐치!' : ''}` : `${r.pts} 좋은 멘트예요!`;
    el.parentNode.appendChild(fx);
    setTimeout(() => fx.remove(), 800);
    if (!r.bad && navigator.vibrate) navigator.vibrate([40, 40, 40]);
  });

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  // ───────── 입장 ─────────

  function showJoin() {
    if (!content) return;
    viewKey = 'join';
    let dept = store.get('csplay-dept');
    if (!content.departments.includes(dept)) dept = null;
    app.innerHTML = `
      <div style="padding-top:.6rem">
        <p class="big">반갑습니다! 👋</p>
        <p class="sub" style="margin-top:.3rem">닉네임과 부서를 입력하고 입장해 주세요.</p>
        <label class="label" for="nm">닉네임 <span class="muted" style="font-weight:500">(10자 이내)</span></label>
        <input class="input" id="nm" maxlength="10" placeholder="예: 김간호, 접수천사" autocomplete="off" enterkeyhint="done" value="${esc(store.get('csplay-name') || '')}">
        <span class="label">부서</span>
        <div class="grid2">${content.departments.map((d) => `<button class="choice center-text ${d === dept ? 'sel' : ''}" data-d="${esc(d)}">${esc(d)}</button>`).join('')}</div>
        <button class="primary" id="go">입장하기</button>
        <p class="err"></p>
        <p class="sub" style="font-size:.85rem;text-align:center">닉네임은 게임 순위에만 표시됩니다.<br>퀴즈 점수와 투표·의견은 이름 없이 집계됩니다.</p>
      </div>`;
    app.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      app.querySelectorAll('[data-d]').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      dept = b.dataset.d;
    }));
    const go = () => {
      const name = $('#nm').value.trim();
      if (!name) return ($('.err', app).textContent = '닉네임을 입력해 주세요.');
      if (!dept) return ($('.err', app).textContent = '부서를 선택해 주세요.');
      store.set('csplay-name', name);
      store.set('csplay-dept', dept);
      send('player:join', { name, dept });
    };
    $('#go').addEventListener('click', go);
    $('#nm').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#nm').blur(); });
  }

  // ───────── 렌더링 ─────────

  function render() {
    if (!v || !content) return;
    const ph = P[v.phase];
    const k = `${v.phase}|${ph.key(v)}`;
    if (k !== viewKey) {
      viewKey = k;
      app.innerHTML = ph.html(v);
      if (ph.mount) ph.mount(v);
      window.scrollTo(0, 0);
    }
    if (ph.update) ph.update(v);
    tick();
  }

  function tick() {
    const t = now();
    app.querySelectorAll('[data-ends]').forEach((el) => {
      el.textContent = `${Math.max(0, Math.ceil((+el.dataset.ends - t) / 1000))}초`;
    });
  }
  setInterval(tick, 250);

  const wait = (emoji, title, sub) => `<div class="center"><div class="emoji">${emoji}</div><p class="big">${title}</p>${sub ? `<p class="sub">${sub}</p>` : ''}</div>`;

  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !v) return;
    const ph = P[v.phase];
    if (ph.act) ph.act(b.dataset.act, b, v);
  });

  const P = {};

  P.lobby = {
    key: () => '',
    html: (v) => wait('🙌', `${esc(v.me.name)}님, 입장 완료!`, `${esc(v.me.dept)} 소속으로 참여합니다.<br>이제 강사님 화면을 봐 주세요.`),
  };

  // 사전·사후 퀴즈 — 한 문제씩 풀고 마지막에 제출
  P.quiz = {
    key: (v) => `${v.quiz.mode}|${v.quiz.open}|${v.quiz.submitted}|${v.quiz.postScore}`,
    html: (v) => {
      const q = v.quiz;
      if (!q.mode) return wait('📝', '퀴즈 준비 중', '강사님이 곧 퀴즈를 시작합니다.');
      if (q.submitted) {
        if (q.mode === 'pre') return wait('✅', '제출 완료!', '결과는 강의가 끝난 뒤<br>사후 퀴즈와 함께 공개됩니다.');
        const up = q.preScore != null && q.postScore > q.preScore;
        return `<div class="center">
          <div class="emoji">${up ? '🎉' : '✅'}</div>
          <p class="big">제출 완료!</p>
          <div class="score-pair">
            ${q.preScore != null ? `<div><div class="sub">강의 전</div><div class="n">${q.preScore}<small>/${q.total}</small></div></div><div class="arrow">→</div>` : ''}
            <div><div class="sub">강의 후</div><div class="n" style="color:var(--teal)">${q.postScore}<small>/${q.total}</small></div></div>
          </div>
          <p class="sub">${up ? '오늘 교육으로 실력이 늘었어요!' : '정답과 해설은 강사 화면에서 함께 확인해요.'}</p>
        </div>`;
      }
      if (!q.open) return wait('⏰', '제출이 마감되었습니다', '강사님 화면을 봐 주세요.');
      if (quizLocal.mode !== q.mode) {
        quizLocal.mode = q.mode;
        quizLocal.i = 0;
        quizLocal.answers = content.quiz.map(() => -1);
      }
      return '<div data-b="quiz"></div>';
    },
    mount: () => drawQuiz(),
    act: (act, b) => {
      const n = content.quiz.length;
      if (act === 'pick') {
        quizLocal.answers[quizLocal.i] = +b.dataset.k;
        drawQuiz();
        if (quizLocal.i < n - 1) setTimeout(() => { quizLocal.i += 1; drawQuiz(); }, 280);
      } else if (act === 'prev' && quizLocal.i > 0) { quizLocal.i -= 1; drawQuiz(); }
      else if (act === 'next' && quizLocal.i < n - 1) { quizLocal.i += 1; drawQuiz(); }
      else if (act === 'submit') {
        const miss = quizLocal.answers.findIndex((a) => a < 0);
        if (miss >= 0) { quizLocal.i = miss; drawQuiz(); toast(`${miss + 1}번 문제를 아직 풀지 않았어요.`); return; }
        send('quiz:submit', { mode: quizLocal.mode, answers: quizLocal.answers });
        b.disabled = true;
      }
    },
  };

  function drawQuiz() {
    const box = $('[data-b=quiz]', app);
    if (!box) return;
    const n = content.quiz.length;
    const i = quizLocal.i;
    const q = content.quiz[i];
    const last = i === n - 1;
    const done = quizLocal.answers.every((a) => a >= 0);
    box.innerHTML = `
      <div class="q-head"><span class="tag">${quizLocal.mode === 'pre' ? '사전 진단' : '사후 점검'} · ${i + 1}/${n}</span>
        <span class="steps-dots">${quizLocal.answers.map((a, k) => `<i class="${k === i ? 'cur' : a >= 0 ? 'on' : ''}"></i>`).join('')}</span></div>
      <p class="q-text">${esc(q.question)}</p>
      <div class="list">${q.options.map((o, k) => `<button class="choice ${quizLocal.answers[i] === k ? 'sel' : ''}" data-act="pick" data-k="${k}"><span class="l">${k + 1}</span><span>${esc(o)}</span></button>`).join('')}</div>
      <div class="nav">
        <button data-act="prev" ${i === 0 ? 'disabled' : ''}>이전</button>
        ${last || done ? `<button class="go" data-act="submit">제출하기</button>` : `<button data-act="next">다음</button>`}
      </div>`;
  }

  // 응대 멘트 투표
  P.vote = {
    key: (v) => `${v.vote.index}|${v.vote.stage}`,
    html: (v) => {
      const s = content.scenarios[v.vote.index];
      if (!s) return wait('🗳️', '투표 준비 중', '');
      const st = v.vote.stage;
      return `
        <div class="q-head"><span class="tag">상황 ${v.vote.index + 1} · ${esc(s.tag)}</span></div>
        <div class="scene card"><p class="s">${esc(s.situation)}</p>${s.quote ? `<p class="qt">“${esc(s.quote)}”</p>` : ''}</div>
        <p style="font-weight:700;margin-bottom:.6rem">${st === 'question' ? '가장 좋은 응대를 골라 주세요' : '강사님 화면에서 결과를 확인하세요'}</p>
        <div class="list">${s.options.map((o, k) => `<button class="choice" data-act="cast" data-k="${k}" ${st === 'question' ? '' : 'disabled'}><span class="l">${L[k]}</span><span>${esc(o)}</span></button>`).join('')}</div>
        <div data-b="vres"></div>`;
    },
    update: (v) => {
      const vt = v.vote;
      app.querySelectorAll('[data-act=cast]').forEach((b) => {
        const k = +b.dataset.k;
        b.classList.toggle('sel', vt.mine === k);
        b.classList.toggle('best', vt.best === k);
        b.classList.toggle('dim', vt.stage === 'answer' && vt.best !== k);
      });
      const res = $('[data-b=vres]', app);
      if (vt.stage === 'answer') {
        res.innerHTML = vt.mine == null ? ''
          : vt.mine === vt.best
            ? '<div class="result-box card">👍 추천 응대와 같은 선택이에요!</div>'
            : `<div class="result-box card">추천 응대는 <b>${L[vt.best]}</b>입니다. 강사님의 설명을 들어 보세요.</div>`;
      } else if (vt.stage === 'question') {
        res.innerHTML = vt.mine != null ? '<p class="sub" style="text-align:center;margin-top:1rem">선택 완료! 공개 전까지 바꿀 수 있어요.</p>' : '';
      } else res.innerHTML = '';
    },
    act: (act, b, v) => {
      if (act === 'cast' && v.vote.stage === 'question') {
        v.vote.mine = +b.dataset.k;
        P.vote.update(v);
        send('vote:cast', { index: v.vote.index, option: +b.dataset.k });
      }
    },
  };

  // 금지 멘트 잡기
  function syncBubbles(s) {
    if (s.whack.status !== 'running') { pbubbles.clear(); return; }
    const ids = new Set(s.whack.bubbles.map((b) => b.id));
    for (const id of pbubbles.keys()) if (!ids.has(id)) pbubbles.delete(id);
    for (const b of s.whack.bubbles) {
      const cur = pbubbles.get(b.id);
      if (!cur) pbubbles.set(b.id, { ...b });
      else if (b.hit) cur.hit = true;
    }
  }

  function drawBubble(b) {
    const cell = app.querySelector(`.cell[data-slot="${b.slot}"]`);
    if (!cell || document.getElementById(`pb${b.id}`)) return;
    cell.querySelectorAll('.pb').forEach((x) => x.remove());
    const el = document.createElement('button');
    el.className = `pb${b.hit ? ' hit' : ''}`;
    el.id = `pb${b.id}`;
    el.dataset.id = b.id;
    el.textContent = b.text;
    cell.appendChild(el);
  }

  P.whack = {
    key: (v) => v.whack.status,
    html: (v) => {
      const w = v.whack;
      if (w.status === 'ready') {
        return wait('🎯', '금지 멘트 잡기', '말풍선에 <b style="color:var(--coral)">금지 멘트</b>가 나오면 빠르게 터치!<br>좋은 멘트를 누르면 <b>-50점</b>이에요.<br><br>강사님이 곧 시작합니다.');
      }
      if (w.status === 'running') {
        return `
          <div class="whack-top"><span><span class="score" data-b="score">${myScore}</span> 점</span><span class="ptimer" data-ends="${w.endsAt}"></span></div>
          <div class="pgrid">${[...Array(9).keys()].map((i) => `<div class="cell" data-slot="${i}"></div>`).join('')}</div>
          <p class="sub" style="text-align:center;margin-top:.7rem">금지 멘트만 터치!</p>`;
      }
      return `<div class="center">
        <div class="emoji">🏁</div>
        <p class="sub">내 점수</p>
        <p class="big" style="font-size:2.6rem;color:var(--teal)">${w.score}점</p>
        ${w.rank ? `<p class="big">${w.of}명 중 ${w.rank}위</p>` : ''}
        <p class="sub">강사님 화면에서 금지 멘트를<br>어떻게 바꿔 말하는지 확인해 보세요.</p>
      </div>`;
    },
    mount: () => { for (const b of pbubbles.values()) drawBubble(b); },
    update: (v) => {
      if (v.whack.status !== 'running') return;
      const sc = $('[data-b=score]', app);
      if (sc) sc.textContent = myScore;
      for (const b of pbubbles.values()) drawBubble(b);
    },
  };

  app.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pb');
    if (!el || el.classList.contains('hit')) return;
    e.preventDefault();
    el.classList.add('hit');
    const b = pbubbles.get(+el.dataset.id);
    if (b) b.hit = true;
    send('whack:hit', { id: +el.dataset.id });
  });

  // 부서 대항 OX
  P.ox = {
    key: (v) => `${v.ox.index}|${v.ox.stage}`,
    html: (v) => {
      const o = v.ox;
      if (o.index < 0) return wait('⭕❌', '부서 대항 OX 퀴즈', `우리 부서(${esc(v.me.dept)})의 정답률이 점수가 됩니다.<br>곧 시작해요!`);
      const q = content.ox[o.index];
      if (o.stage === 'reveal') {
        const right = o.mine === o.answer;
        return `<div class="center" style="justify-content:flex-start;padding-top:1.4rem">
          <div class="emoji">${o.mine == null ? '🙂' : right ? '🎉' : '😅'}</div>
          <p class="big">${o.mine == null ? '응답하지 않았어요' : right ? '정답입니다!' : '아쉬워요!'}</p>
          <p class="sub">${esc(q.statement)}</p>
          <p class="big" style="font-size:2.4rem;color:${o.answer === 'O' ? 'var(--teal)' : 'var(--coral)'}">정답 ${o.answer}</p>
          ${o.explain ? `<div class="result-box card" style="text-align:left">${esc(o.explain)}</div>` : ''}
          <p class="sub">부서 점수는 강사님 화면에서!</p>
        </div>`;
      }
      const locked = o.stage === 'locked';
      return `
        <div class="q-head"><span class="tag">OX · Q${o.index + 1}/${content.ox.length}</span>${locked ? '<span class="tag coral">응답 마감</span>' : `<span class="ptimer" data-ends="${o.endsAt}"></span>`}</div>
        <p class="q-text" style="font-size:1.5rem">${esc(q.statement)}</p>
        <div class="ox-btns">
          <button class="ox-btn o" data-act="ox" data-c="O" ${locked ? 'disabled' : ''}>O</button>
          <button class="ox-btn x" data-act="ox" data-c="X" ${locked ? 'disabled' : ''}>X</button>
        </div>
        <p class="sub" style="text-align:center;margin-top:.8rem">${locked ? '정답 공개를 기다려 주세요' : '마감 전까지 바꿀 수 있어요'}</p>`;
    },
    update: (v) => {
      app.querySelectorAll('[data-act=ox]').forEach((b) => b.classList.toggle('sel', v.ox.mine === b.dataset.c));
    },
    act: (act, b, v) => {
      if (act !== 'ox' || v.ox.stage !== 'question') return;
      v.ox.mine = b.dataset.c;
      P.ox.update(v);
      send('ox:answer', { index: v.ox.index, choice: b.dataset.c });
    },
  };

  // 익명 워드클라우드
  P.cloud = {
    key: (v) => `${v.cloud.index}`,
    html: (v) => `
      <div class="q-head"><span class="tag">익명 의견</span><span class="muted" style="font-size:.85rem">이름은 표시되지 않아요</span></div>
      <p class="q-text">${esc(content.cloudPrompts[v.cloud.index])}</p>
      <form data-b="cform" style="display:flex;gap:.5rem">
        <input class="input" data-b="ctext" maxlength="15" placeholder="짧게 한 단어나 한 줄로" autocomplete="off" enterkeyhint="send">
        <button class="primary" style="width:auto;margin:0;padding:0 1.2rem">보내기</button>
      </form>
      <p class="sub" data-b="cleft" style="margin-top:.6rem"></p>
      <div class="mine" data-b="mine"></div>`,
    mount: (v) => {
      $('[data-b=cform]', app).addEventListener('submit', (e) => {
        e.preventDefault();
        const inp = $('[data-b=ctext]', app);
        const text = inp.value.trim();
        if (!text) return;
        send('cloud:submit', { index: v.cloud.index, text });
        inp.value = '';
        toast('보냈어요! 강사님 화면을 확인하세요.');
      });
    },
    update: (v) => {
      const max = content.settings.cloudMaxPerPerson;
      const mine = v.cloud.mine;
      const left = max - mine.length;
      $('[data-b=mine]', app).innerHTML = mine.map((t) => `<span>${esc(t)}</span>`).join('');
      $('[data-b=cleft]', app).textContent = left > 0 ? `${left}개 더 보낼 수 있어요.` : '모두 보냈어요. 감사합니다!';
      const form = $('[data-b=cform]', app);
      form.querySelectorAll('input, button').forEach((x) => { x.disabled = left <= 0; });
    },
  };

  P.report = {
    key: (v) => `${v.quiz.postScore}|${v.whack.score}`,
    html: (v) => {
      const q = v.quiz;
      return `<div class="center">
        <div class="emoji">🙏</div>
        <p class="big">오늘 함께해 주셔서<br>감사합니다!</p>
        ${q.postScore != null ? `<div class="score-pair">
          ${q.preScore != null ? `<div><div class="sub">강의 전</div><div class="n">${q.preScore}<small>/${q.total}</small></div></div><div class="arrow">→</div>` : ''}
          <div><div class="sub">강의 후</div><div class="n" style="color:var(--teal)">${q.postScore}<small>/${q.total}</small></div></div></div>` : ''}
        ${v.whack.score ? `<p class="sub">금지 멘트 잡기 ${v.whack.score}점</p>` : ''}
        <p class="sub">오늘 배운 응대 한 가지,<br>내일 첫 환자에게 꼭 써 보세요.</p>
      </div>`;
    },
  };
})();
