(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const L = 'ABCDEFGH';
  const PHASES = [
    ['lobby', '입장'],
    ['quiz', '사전·사후 퀴즈'],
    ['vote', '멘트 투표'],
    ['whack', '금지 멘트 잡기'],
    ['ox', '부서 대항 OX'],
    ['cloud', '익명 워드클라우드'],
    ['report', '결과 리포트'],
  ];
  const PHASE_LABEL = Object.fromEntries(PHASES);
  const KEY_STORE = 'csplay-host-key';

  const stage = $('#stage');
  const dock = $('#dock');

  let hostKey = new URLSearchParams(location.search).get('key') || '';
  try { hostKey = hostKey || localStorage.getItem(KEY_STORE) || ''; } catch (e) { /* 저장소 없음 */ }

  let socket = null;
  let content = null;
  let v = null;
  let offset = 0;
  let stageKey = '';
  let dockKey = '';
  let dockMin = false;
  let ctrls = [];
  let showReview = false;
  let reportSig = '';
  const bubbles = new Map();
  const now = () => Date.now() + offset;
  const send = (ev, data) => socket && socket.emit(ev, data || {});

  // ───────── 연결 ─────────

  function askKey(msg) {
    stage.innerHTML = `
      <div class="keybox"><form class="card" id="keyform">
        <h2>진행자 키를 입력하세요</h2>
        <p class="muted">서버를 켤 때 표시된 키 또는 HOST_KEY 값입니다.</p>
        <input id="keyinput" inputmode="text" autocomplete="off" autofocus>
        <button>강사 화면 열기</button>
        <p class="err">${esc(msg || '')}</p>
      </form></div>`;
    dock.innerHTML = '';
    $('#keyform').onsubmit = (e) => { e.preventDefault(); hostKey = $('#keyinput').value.trim(); connect(); };
  }

  function connect() {
    if (!hostKey) return askKey();
    if (socket) socket.disconnect();
    socket = io({ auth: { role: 'host', key: hostKey } });
    socket.on('auth:fail', () => {
      try { localStorage.removeItem(KEY_STORE); } catch (e) { /* 무시 */ }
      socket.disconnect();
      askKey('진행자 키가 맞지 않습니다.');
    });
    socket.on('host:config', (c) => {
      try { localStorage.setItem(KEY_STORE, hostKey); } catch (e) { /* 무시 */ }
      if (new URLSearchParams(location.search).has('key')) history.replaceState(null, '', `/host${location.hash}`);
      // PPT 링크용: /host#vote 처럼 열면 그 화면으로 바로 이동
      const jump = location.hash.slice(1);
      if (jump && PHASES.some(([id]) => id === jump)) {
        send('host:phase', { phase: jump });
        history.replaceState(null, '', '/host');
      }
      content = c.content;
      $('#brand').innerHTML = `${content.logo ? `<img class="logo" src="${esc(content.logo)}" alt="" onerror="this.remove()">` : ''}${esc(content.title)}<small>${esc(content.brand || '')}</small>`;
      setJoinUrl(`${location.origin}/`);
      stageKey = dockKey = '';
      render();
    });
    socket.on('host:state', (s) => {
      offset = s.now - Date.now();
      if (v && v.whack.status === 'running' && s.whack.status !== 'running') bubbles.clear();
      v = s;
      render();
    });
    socket.on('whack:spawn', (b) => { bubbles.set(b.id, b); drawBubble(b); });
    socket.on('whack:despawn', ({ id }) => removeBubble(id));
    socket.on('whack:fx', hitFx);
    socket.on('host:exportData', (data) => saveExport(data));
    socket.on('connect', () => $('#conn').classList.remove('off'));
    socket.on('disconnect', () => $('#conn').classList.add('off'));
  }

  let currentJoinUrl = '';
  let qrCache = { url: '', src: '' };
  // 입장 QR은 브라우저에서 직접 만든다 (서버 필요 없음)
  function qrSrc(url) {
    if (qrCache.url === url) return qrCache.src;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }).replace('fill="black"', 'fill="#14213d"');
    qrCache = { url, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
    return qrCache.src;
  }
  function setJoinUrl(url) {
    if (url === currentJoinUrl) return;
    currentJoinUrl = url;
    const mq = $('#miniQr');
    mq.querySelector('img').src = qrSrc(url);
    mq.querySelector('span').textContent = url.replace(/^https?:\/\//, '');
    $('#bigQr img').src = qrSrc(url);
    $('#bigQr .url').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    stageKey = '';
  }

  // ───────── 렌더링 ─────────

  function render() {
    if (!content || !v) return;
    const ph = P[v.phase];
    $('#phaseName').textContent = PHASE_LABEL[v.phase];
    $('#countText').textContent = v.demo ? `${v.online}명 접속 (가상 ${v.demo}명)` : `${v.online}명 접속`;
    $('#miniQr').classList.toggle('hidden', v.phase === 'lobby' || v.phase === 'report');
    const k = `${v.phase}|${ph.key(v)}`;
    if (k !== stageKey) {
      stageKey = k;
      stage.innerHTML = `<div class="fade" style="height:100%">${ph.html(v)}</div>`;
      if (ph.mount) ph.mount(v);
    }
    if (ph.update) ph.update(v);
    renderDock(ph);
    tick();
  }

  function renderDock(ph) {
    ctrls = ph.controls ? ph.controls(v) : [];
    const k = JSON.stringify([v.phase, dockMin, ctrls.map((c) => [c.label, c.primary, c.disabled, c.on])]);
    if (k === dockKey) return;
    dockKey = k;
    dock.classList.toggle('min', dockMin);
    dock.innerHTML = `
      <div class="tabs">${PHASES.map(([id, label], i) => `<button class="tab ${v.phase === id ? 'on' : ''}" data-phase="${id}"><b>${i + 1}</b>${label}</button>`).join('')}</div>
      <div class="ctrls">
        ${ctrls.map((c, i) => `<button class="btn ${c.primary ? 'primary' : ''} ${c.on ? 'primary' : ''}" data-c="${i}" ${c.disabled ? 'disabled' : ''}>${esc(c.label)}</button>`).join('')}
        <span class="sep"></span>
        <button class="btn" data-g="full" title="전체 화면 (F)">전체화면</button>
        <button class="btn warn" data-g="reset">세션 초기화</button>
      </div>
      <button class="btn toggle" data-g="min" title="진행 도구 접기 (H)">${dockMin ? '진행 도구 ▲' : '▼'}</button>`;
  }

  dock.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.phase) send('host:phase', { phase: b.dataset.phase });
    else if (b.dataset.c) ctrls[+b.dataset.c].act();
    else if (b.dataset.g === 'full') toggleFull();
    else if (b.dataset.g === 'min') { dockMin = !dockMin; dockKey = ''; render(); }
    else if (b.dataset.g === 'reset') resetSession();
  });

  function resetSession() {
    const ok = confirm('세션을 초기화할까요?\n\n· 지금까지 결과는 서버에 저장되지만, 먼저 [결과 리포트]에서 CSV를 내려받아 두는 것을 권장합니다.\n· 참가자는 다시 입장해야 합니다.');
    if (ok) { showReview = false; send('session:reset'); }
  }

  // 오른쪽 위 작은 QR → 화면 가운데 큰 QR
  function toggleBigQr() { $('#bigQr').classList.toggle('hidden'); }
  $('#miniQr').addEventListener('click', toggleBigQr);
  $('#bigQr').addEventListener('click', toggleBigQr);

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }

  window.addEventListener('hashchange', () => {
    const jump = location.hash.slice(1);
    if (jump && PHASES.some(([id]) => id === jump)) {
      send('host:phase', { phase: jump });
      history.replaceState(null, '', '/host');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!v || e.target.closest('input, textarea')) return;
    const ph = P[v.phase];
    if (/^[1-7]$/.test(e.key)) send('host:phase', { phase: PHASES[+e.key - 1][0] });
    else if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); ph.primary && ph.primary(v); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); ph.back && ph.back(v); }
    else if (e.key === 'h' || e.key === 'H') { dockMin = !dockMin; dockKey = ''; render(); }
    else if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') toggleBigQr();
    else if (e.key === 'Escape') $('#bigQr').classList.add('hidden');
  });

  // 타이머 (data-ends: 종료 시각, data-dur: 전체 길이)
  function tick() {
    const t = now();
    stage.querySelectorAll('[data-ends]').forEach((el) => {
      const ends = +el.dataset.ends;
      const dur = +el.dataset.dur || 1;
      const rem = Math.max(0, ends - t);
      const kind = el.dataset.kind;
      if (kind === 'bar') el.firstElementChild.style.width = `${(rem / dur) * 100}%`;
      else if (kind === 'ring') {
        const c = el.querySelector('circle.fg');
        const len = 2 * Math.PI * 45;
        c.style.strokeDashoffset = String(len * (1 - rem / dur));
        el.querySelector('.t').textContent = Math.ceil(rem / 1000);
      } else el.textContent = Math.ceil(rem / 1000);
    });
  }
  setInterval(tick, 150);

  const ring = (ends, dur) => `
    <div class="ring" data-ends="${ends}" data-dur="${dur}" data-kind="ring">
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <circle cx="50" cy="50" r="45" fill="none" stroke="#ece7dc" stroke-width="9"/>
        <circle class="fg" cx="50" cy="50" r="45" fill="none" stroke="var(--amber)" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${(2 * Math.PI * 45).toFixed(2)}" style="transition:stroke-dashoffset .15s linear"/>
      </svg><div class="t"></div>
    </div>`;

  // ───────── 단계별 화면 ─────────

  const P = {};

  // 1. 입장
  P.lobby = {
    key: () => currentJoinUrl,
    html: () => `
      <div class="lobby">
        <div>
          ${content.logo ? `<img class="hero-logo" src="${esc(content.logo)}" alt="" onerror="this.remove()">` : ''}
          <p class="eyebrow">${esc(content.brand || '')}</p>
          <h1 class="hero">${esc(content.title)}</h1>
          <p class="lead">휴대폰 카메라로 QR을 찍어 입장하세요.<br>앱 설치 없이 바로 참여할 수 있어요.</p>
          <div class="steps"><span><b>1</b>카메라로 QR 촬영</span><span><b>2</b>닉네임·부서 입력</span><span><b>3</b>강사 화면 보기</span></div>
          <div class="count-big"><strong data-b="total">0</strong><small>명 입장</small></div>
          <div class="dept-chips" data-b="depts"></div>
        </div>
        <div class="qr-card card">
          <img src="${qrSrc(currentJoinUrl)}" alt="입장 QR 코드">
          <div class="url">${esc(currentJoinUrl.replace(/^https?:\/\//, ''))}</div>
        </div>
        <div class="names" data-b="names"></div>
      </div>`,
    update: (v) => {
      $('[data-b=total]', stage).textContent = v.total;
      $('[data-b=depts]', stage).innerHTML = v.deptCounts.filter((d) => d.count).map((d) => `<span>${esc(d.dept)}<b>${d.count}</b></span>`).join('');
      const names = $('[data-b=names]', stage);
      const sig = v.recent.map((p) => p.name).join('|');
      if (names.dataset.sig !== sig) {
        names.dataset.sig = sig;
        names.innerHTML = v.recent.map((p) => `<span>${esc(p.name)}</span>`).join('');
      }
    },
    controls: (v) => [
      v.demo
        ? { label: `가상 참가자 빼기 (${v.demo}명)`, act: () => send('demo:remove') }
        : { label: '혼자 체험: 가상 참가자 12명 넣기', act: () => send('demo:add'), primary: true },
    ],
  };

  // 2. 사전·사후 퀴즈
  P.quiz = {
    key: (v) => `${v.quiz.mode}|${v.quiz.open}`,
    html: (v) => {
      const n = content.quiz.length;
      const q = v.quiz;
      const st = q.stats;
      if (!q.mode) {
        return `<div class="center-col">
          <p class="eyebrow">강의 전 · 후 같은 문제</p>
          <h1 class="big-q" style="font-size:4rem">사전·사후 진단 퀴즈</h1>
          <p class="lead muted" style="font-size:1.5rem;line-height:1.6">같은 ${n}문제를 강의 시작 전과 끝난 뒤에 풀어<br>오늘 교육으로 무엇이 달라졌는지 숫자로 확인합니다.</p>
          <p class="tag amber" style="font-size:1.1rem">정답은 사후 퀴즈가 끝난 뒤에 공개됩니다</p>
        </div>`;
      }
      const label = q.mode === 'pre' ? '사전 진단 퀴즈' : '사후 점검 퀴즈';
      if (q.open) {
        return `<div class="center-col">
          <p class="eyebrow">${label} 진행 중</p>
          <h1 class="big-q">휴대폰에서 ${n}문제를 풀어 주세요</h1>
          <div class="quiz-progress">
            <div class="nums"><span data-b="sub">0</span><small> / <span data-b="tot">0</span>명 제출</small></div>
            <div class="bar"><i data-b="bar"></i></div>
          </div>
          <p class="muted">${q.mode === 'pre' ? '지금 실력 그대로! 틀려도 괜찮아요. 점수는 익명으로 집계됩니다.' : '강의 내용을 떠올리며 풀어 보세요.'}</p>
        </div>`;
      }
      if (q.mode === 'pre') {
        const worst = content.quiz
          .map((qq, i) => ({ i, q: qq.question, r: st.pre.per[i] }))
          .filter((x) => x.r != null)
          .sort((a, b) => a.r - b.r)
          .slice(0, 2);
        return `<div class="center-col">
          <p class="eyebrow">사전 진단 결과</p>
          <div class="kpis">
            <div class="kpi card"><div class="label">제출 인원</div><div class="value stat">${st.pre.count}명</div></div>
            <div class="kpi card"><div class="label">평균 정답률</div><div class="value stat">${pct(st.pre.avg)}</div></div>
          </div>
          ${worst.length ? `<h2 style="margin-top:1rem;font-size:1.8rem">오늘 강의에서 꼭 짚어 볼 문항</h2>
          <div class="focus-list">${worst.map((w) => `<div class="card"><b>Q${w.i + 1}</b>${esc(w.q)}</div>`).join('')}</div>` : ''}
        </div>`;
      }
      const gain = st.pre.avg != null && st.post.avg != null ? Math.round((st.post.avg - st.pre.avg) * 100) : null;
      return `<div class="center-col compare" style="justify-content:flex-start;overflow:auto">
        <p class="eyebrow">사전 → 사후 비교</p>
        <div class="kpis">
          <div class="kpi card"><div class="label">강의 전</div><div class="value stat">${pct(st.pre.avg)}</div><div class="sub">${st.pre.count}명 제출</div></div>
          <div class="kpi card up"><div class="label">강의 후</div><div class="value stat">${pct(st.post.avg)}</div><div class="sub">${st.post.count}명 제출</div></div>
          <div class="kpi card up"><div class="label">향상</div><div class="value stat">${gain == null ? '–' : `${gain > 0 ? '+' : ''}${gain}%p`}</div>
            <div class="sub">두 번 모두 참여 ${st.matched.count}명 기준 ${pct(st.matched.pre)} → ${pct(st.matched.post)}</div></div>
        </div>
        <div class="qrows">${content.quiz.map((qq, i) => `
          <div class="qrow card">
            <div><div class="q">Q${i + 1}. ${esc(qq.question)}</div><div class="a">정답: ${esc(qq.options[qq.answer])}</div></div>
            <div class="bars">
              <div><span class="muted">전</span><span class="bar gray"><i style="width:${(st.pre.per[i] || 0) * 100}%"></i></span><b class="stat">${pct(st.pre.per[i])}</b></div>
              <div><span class="muted">후</span><span class="bar"><i style="width:${(st.post.per[i] || 0) * 100}%"></i></span><b class="stat">${pct(st.post.per[i])}</b></div>
            </div>
          </div>`).join('')}</div>
      </div>`;
    },
    update: (v) => {
      if (!v.quiz.open) return;
      const sub = v.quiz.stats[v.quiz.mode].count;
      $('[data-b=sub]', stage).textContent = sub;
      $('[data-b=tot]', stage).textContent = v.total;
      $('[data-b=bar]', stage).style.width = `${v.total ? (sub / v.total) * 100 : 0}%`;
    },
    controls: (v) => [
      { label: '사전 퀴즈 시작', act: () => send('quiz:open', { mode: 'pre' }), disabled: v.quiz.open, on: v.quiz.mode === 'pre' && v.quiz.open },
      { label: '사후 퀴즈 시작', act: () => send('quiz:open', { mode: 'post' }), disabled: v.quiz.open, on: v.quiz.mode === 'post' && v.quiz.open },
      { label: '제출 마감 · 결과 보기', act: () => send('quiz:close'), primary: v.quiz.open, disabled: !v.quiz.open },
    ],
    primary: (v) => { if (v.quiz.open) send('quiz:close'); },
  };

  // 3. 응대 멘트 투표
  P.vote = {
    key: (v) => `${v.vote.index}|${v.vote.stage}`,
    html: (v) => {
      const i = v.vote.index;
      const s = content.scenarios[i];
      if (!s) return '<div class="center-col"><h2>투표 상황이 없습니다</h2></div>';
      const ans = v.vote.stage === 'answer';
      return `<div class="vote ${v.vote.stage}">
        <div class="title-row"><span class="tag">${esc(s.tag)}</span><span class="muted">상황 ${i + 1} / ${content.scenarios.length} · ${esc(s.title)}</span></div>
        <p class="situation">${esc(s.situation)}</p>
        ${s.quote ? `<p class="quote">${esc(s.quote)}</p>` : ''}
        <div class="opts">${s.options.map((o, k) => `
          <div class="opt card ${k === s.best ? 'best' : ''}" data-k="${k}">
            <span class="fill"></span>
            <span class="letter">${L[k]}</span>
            <span class="otext">${ans && k === s.best ? '<span class="tag">추천 응대</span> ' : ''}${esc(o)}</span>
            <span class="opct stat"></span>
          </div>`).join('')}</div>
        ${ans ? `<div class="point card"><b>강사 포인트</b>${esc(s.point)}</div>` : ''}
        <div class="vote-foot"><span>${v.vote.stage === 'question' ? '휴대폰에서 가장 좋은 응대를 골라 주세요' : '여러분의 선택'}</span><span><b data-b="vt">0</b>명 응답</span></div>
      </div>`;
    },
    update: (v) => {
      $('[data-b=vt]', stage).textContent = v.vote.total;
      if (v.vote.stage === 'question') return;
      const tot = v.vote.total || 1;
      stage.querySelectorAll('.opt').forEach((el) => {
        const c = v.vote.counts[+el.dataset.k] || 0;
        el.querySelector('.fill').style.width = `${(c / tot) * 100}%`;
        el.querySelector('.opct').textContent = `${Math.round((c / tot) * 100)}%`;
      });
    },
    controls: (v) => {
      const i = v.vote.index;
      const n = content.scenarios.length;
      const st = v.vote.stage;
      return [
        { label: '◀ 이전 상황', act: () => send('vote:goto', { index: i - 1 }), disabled: i <= 0 },
        { label: '결과 공개', act: () => send('vote:stage', { stage: 'result' }), primary: st === 'question', on: st === 'result' },
        { label: '강사 포인트', act: () => send('vote:stage', { stage: 'answer' }), primary: st === 'result', on: st === 'answer' },
        { label: '다음 상황 ▶', act: () => send('vote:goto', { index: i + 1 }), primary: st === 'answer', disabled: i >= n - 1 },
      ];
    },
    primary: (v) => {
      const st = v.vote.stage;
      if (st === 'question') send('vote:stage', { stage: 'result' });
      else if (st === 'result') send('vote:stage', { stage: 'answer' });
      else if (v.vote.index < content.scenarios.length - 1) send('vote:goto', { index: v.vote.index + 1 });
    },
    back: (v) => { if (v.vote.index > 0) send('vote:goto', { index: v.vote.index - 1 }); },
  };

  // 4. 금지 멘트 잡기
  // 두더지 그림 (직접 그린 SVG)
  const MOLE_SVG = `<svg class="mole" viewBox="0 0 120 112" aria-hidden="true">
    <ellipse cx="24" cy="38" rx="9" ry="8" fill="#6e4429"/><ellipse cx="96" cy="38" rx="9" ry="8" fill="#6e4429"/>
    <path d="M8 112 V62 a52 52 0 0 1 104 0 V112 Z" fill="#8a5a3c"/>
    <path d="M30 112 V80 a30 30 0 0 1 60 0 V112 Z" fill="#d9ab84"/>
    <g class="eyes-open"><circle cx="42" cy="52" r="7.5" fill="#1d1d1f"/><circle cx="78" cy="52" r="7.5" fill="#1d1d1f"/>
      <circle cx="44.5" cy="49.5" r="2.4" fill="#fff"/><circle cx="80.5" cy="49.5" r="2.4" fill="#fff"/></g>
    <g class="eyes-x" stroke="#1d1d1f" stroke-width="4" stroke-linecap="round"><path d="M35 45 l14 14 M49 45 l-14 14"/><path d="M71 45 l14 14 M85 45 l-14 14"/></g>
    <circle cx="30" cy="66" r="6" fill="#f2a0a0" opacity=".7"/><circle cx="90" cy="66" r="6" fill="#f2a0a0" opacity=".7"/>
    <ellipse cx="60" cy="68" rx="15" ry="11" fill="#f0c9a8"/><ellipse cx="60" cy="63" rx="7" ry="5" fill="#d9566a"/>
    <rect x="54" y="74" width="5.5" height="7" rx="1.5" fill="#fff"/><rect x="60.5" y="74" width="5.5" height="7" rx="1.5" fill="#fff"/>
  </svg>`;
  const HOLE_HTML = '<div class="mound"></div><div class="pit"></div><div class="clip"></div><div class="rim"></div>';

  function drawBubble(b) {
    const hole = stage.querySelector(`.hole[data-slot="${b.slot}"]`);
    if (!hole || document.getElementById(`b${b.id}`)) return;
    const el = document.createElement('div');
    el.className = 'mole-group';
    el.id = `b${b.id}`;
    el.innerHTML = `<div class="sign"></div>${MOLE_SVG}`;
    el.querySelector('.sign').textContent = b.text;
    hole.querySelector('.clip').appendChild(el);
    void el.offsetWidth;
    el.classList.add('up');
  }
  function removeBubble(id) {
    bubbles.delete(id);
    const el = document.getElementById(`b${id}`);
    if (!el) return;
    el.id = '';
    setTimeout(() => el.classList.remove('up'), el.classList.contains('bonked') ? 350 : 0);
    setTimeout(() => el.remove(), 700);
  }
  function hitFx(fx) {
    const el = document.getElementById(`b${fx.id}`);
    if (!el) return;
    const hole = el.closest('.hole');
    const sign = el.querySelector('.sign');
    const add = (cls, text, ms) => {
      const f = document.createElement('div');
      f.className = cls;
      f.textContent = text;
      hole.appendChild(f);
      setTimeout(() => f.remove(), ms);
    };
    if (fx.bad && fx.first) {
      el.classList.add('bonked');
      sign.classList.add('caught');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${fx.name} 캐치!`;
      sign.appendChild(who);
      add('hammer', '🔨', 450);
      add('stars', '💫', 900);
    } else if (!fx.bad) {
      sign.classList.remove('wrong');
      void sign.offsetWidth;
      sign.classList.add('wrong');
      add('fx', `앗! ${fx.name} -50`, 900);
    }
  }

  const lbRows = (rows, fmt) => rows.map((r, i) => `<div class="row"><span class="r">${i + 1}</span><span>${fmt(r)}</span><span class="s">${r.score ?? r.avg}</span></div>`).join('');

  P.whack = {
    key: (v) => `${v.whack.status}|${v.whack.status === 'ended' && showReview}`,
    html: (v) => {
      const w = v.whack;
      if (w.status === 'ready') {
        const bad = content.whack.bad.slice(0, 3);
        const good = content.whack.good.slice(0, 3);
        return `<div class="center-col">
          <p class="eyebrow">${content.settings.whackSeconds}초 스피드 게임</p>
          <h1 class="big-q" style="font-size:4rem">금지 멘트 잡기</h1>
          <div class="rules">
            <div class="card"><h3>이런 말이 튀어나오면 <span style="color:var(--coral)">터치!</span></h3>
              ${bad.map((b) => `<span class="ex bad">${esc(b.text)}</span>`).join('')}
              <p class="muted" style="margin-top:.8rem">빨리 잡을수록 높은 점수 · 가장 먼저 잡으면 보너스 +20</p></div>
            <div class="card"><h3>이런 말은 <span style="color:var(--teal)">그냥 두세요</span></h3>
              ${good.map((g) => `<span class="ex good">${esc(g)}</span>`).join('')}
              <p class="muted" style="margin-top:.8rem">좋은 멘트를 누르면 -50점!</p></div>
          </div>
          <p class="lead muted" style="font-size:1.3rem">휴대폰 화면에도 같은 말풍선이 나타납니다. 준비되셨나요?</p>
        </div>`;
      }
      if (w.status === 'running') {
        return `<div class="whack">
          <div class="board">${[...Array(9).keys()].map((i) => `<div class="hole" data-slot="${i}">${HOLE_HTML}</div>`).join('')}</div>
          <div class="side">
            <div class="timer-big" data-ends="${w.endsAt}"></div>
            <div class="timer-bar" data-ends="${w.endsAt}" data-dur="${content.settings.whackSeconds * 1000}" data-kind="bar"><i></i></div>
            <div class="lb card"><h3>실시간 순위</h3><div data-b="lb"></div></div>
            <div class="lb card"><h3>부서 평균</h3><div data-b="dlb"></div></div>
          </div>
        </div>`;
      }
      if (showReview && w.review) {
        const list = [...w.review.bad].sort((a, b) => a.catchRate - b.catchRate);
        return `<div class="center-col" style="justify-content:flex-start">
          <p class="eyebrow">게임 속 금지 멘트, 이렇게 바꿔 말해요</p>
          <div class="review">${list.map((b) => `
            <div class="card"><div class="no">${esc(b.text)}</div><div class="yes">${esc(b.alt)}</div>
            <div class="meta">평균 캐치율 ${pct(b.catchRate)}</div></div>`).join('') || '<p class="muted">나온 금지 멘트가 없습니다.</p>'}</div>
        </div>`;
      }
      const top = w.board.slice(0, 3);
      const order = [1, 0, 2].filter((i) => top[i]);
      const medal = ['🥇', '🥈', '🥉'];
      const confused = w.review?.confused || [];
      return `<div class="center-col">
        <p class="eyebrow">게임 종료 · ${w.participants}명 참여</p>
        <h1 class="big-q" style="font-size:3.4rem">명예의 전당</h1>
        <div class="podium">${order.map((i) => `
          <div class="p card p${i + 1}"><div class="medal">${medal[i]}</div><div class="n">${esc(top[i].name)}</div>
          <div class="muted">${esc(top[i].dept)}</div><div class="sc stat">${top[i].score}점</div></div>`).join('') || '<p class="muted">참여 기록이 없습니다.</p>'}</div>
        ${w.depts.length ? `<div class="dept-chips" style="justify-content:center">${w.depts.map((d, i) => `<span>${i === 0 ? '👑 ' : ''}${esc(d.dept)}<b>평균 ${d.avg}점</b></span>`).join('')}</div>` : ''}
        ${confused.length ? `<p class="lead" style="font-size:1.3rem">많이 헷갈린 <b style="color:var(--teal-deep)">좋은 멘트</b>: ${confused.map((c) => `“${esc(c.text)}”`).join(', ')}</p>` : ''}
      </div>`;
    },
    mount: (v) => { if (v.whack.status === 'running') for (const b of bubbles.values()) drawBubble(b); },
    update: (v) => {
      if (v.whack.status !== 'running') return;
      $('[data-b=lb]', stage).innerHTML = lbRows(v.whack.board, (r) => `${esc(r.name)}<span class="d">${esc(r.dept)}</span>`) || '<p class="muted">첫 캐치를 기다리는 중…</p>';
      $('[data-b=dlb]', stage).innerHTML = lbRows(v.whack.depts, (r) => `${esc(r.dept)}<span class="d">${r.n}명</span>`);
    },
    controls: (v) => {
      const st = v.whack.status;
      if (st === 'ready') return [{ label: '게임 시작 ▶', act: () => send('whack:start'), primary: true }];
      if (st === 'running') return [{ label: '게임 중지', act: () => send('whack:stop') }];
      return [
        { label: showReview ? '순위 보기' : '바꿔 말하기 보기', act: toggleReview, primary: true },
        { label: '다시 하기', act: () => { showReview = false; send('whack:reset'); } },
      ];
    },
    primary: (v) => {
      if (v.whack.status === 'ready') send('whack:start');
      else if (v.whack.status === 'ended') toggleReview();
    },
  };
  function toggleReview() { showReview = !showReview; render(); }

  // 5. 부서 대항 OX
  P.ox = {
    key: (v) => `${v.ox.index}|${v.ox.stage}`,
    html: (v) => {
      const o = v.ox;
      if (o.index < 0) {
        return `<div class="center-col">
          <p class="eyebrow">부서 대항전</p>
          <h1 class="big-q" style="font-size:4rem">부서 대항 OX 퀴즈</h1>
          <p class="lead muted" style="font-size:1.5rem;line-height:1.6">문제마다 <b>부서별 정답률</b>이 점수로 쌓입니다.<br>인원이 적은 부서도 공평하게 겨룰 수 있어요!</p>
          <div class="dept-chips" style="justify-content:center">${v.deptCounts.filter((d) => d.count).map((d) => `<span>${esc(d.dept)}<b>${d.count}명</b></span>`).join('')}</div>
        </div>`;
      }
      const q = content.ox[o.index];
      const rev = o.stage === 'reveal';
      const last = o.index === content.ox.length - 1;
      return `<div class="ox ${o.stage}">
        <div class="main">
          <div class="title-row"><span class="tag">Q${o.index + 1} / ${content.ox.length}</span>${o.stage === 'locked' ? '<span class="tag coral">응답 마감</span>' : ''}</div>
          <p class="statement">${esc(q.statement)}</p>
          <div class="ox-marks">
            <div class="ox-mark o card"><span class="m">O</span><span class="n stat" data-b="o"></span></div>
            <div class="ox-mark x card"><span class="m">X</span><span class="n stat" data-b="x"></span></div>
          </div>
          ${rev ? `<div class="explain card"><b>정답은 ${q.answer}!</b> ${esc(q.explain || '')}</div>` : ''}
          <div style="display:flex;align-items:center;gap:1.2rem">
            ${o.stage === 'question' ? ring(o.endsAt, content.settings.oxSeconds * 1000) : ''}
            <p class="lead" style="font-size:1.3rem"><b data-b="ans">0</b>명 응답</p>
          </div>
        </div>
        <div class="dept-board card"><h3>${rev && last ? '🏆 최종 부서 순위' : '부서 순위 (누적)'}</h3><div data-b="board"></div></div>
      </div>`;
    },
    update: (v) => {
      const o = v.ox;
      if (o.index < 0) return;
      $('[data-b=ans]', stage).textContent = o.answered;
      const rev = o.stage === 'reveal';
      $('[data-b=o]', stage).textContent = rev ? `${o.counts.O}명` : '';
      $('[data-b=x]', stage).textContent = rev ? `${o.counts.X}명` : '';
      if (rev) {
        const ans = content.ox[o.index].answer;
        stage.querySelector('.ox-mark.o').classList.add(ans === 'O' ? 'win' : 'lose');
        stage.querySelector('.ox-mark.x').classList.add(ans === 'X' ? 'win' : 'lose');
      }
      const max = Math.max(1, ...o.board.map((r) => r.score));
      $('[data-b=board]', stage).innerHTML = o.board.map((r) => `
        <div class="dept-row"><div class="top"><span>${esc(r.dept)}<small>${r.members}명</small></span><span class="stat">${r.score}점</span></div>
        <div class="bar"><i style="width:${(r.score / max) * 100}%"></i></div></div>`).join('')
        || '<p class="muted">정답을 공개하면 점수가 쌓입니다.</p>';
    },
    controls: (v) => {
      const o = v.ox;
      const n = content.ox.length;
      const canNext = (o.index < 0 || o.stage === 'reveal') && o.index < n - 1;
      return [
        { label: o.index < 0 ? '첫 문제 시작 ▶' : '다음 문제 ▶', act: () => send('ox:goto', { index: o.index + 1 }), primary: canNext, disabled: !canNext },
        { label: '정답 공개', act: () => send('ox:reveal'), primary: o.stage === 'question' || o.stage === 'locked', disabled: !(o.stage === 'question' || o.stage === 'locked') },
        { label: '처음부터', act: () => { if (confirm('OX 점수를 초기화할까요?')) send('ox:reset'); }, disabled: o.index < 0 },
      ];
    },
    primary: (v) => {
      const o = v.ox;
      if (o.stage === 'question' || o.stage === 'locked') send('ox:reveal');
      else if (o.index < content.ox.length - 1) send('ox:goto', { index: o.index + 1 });
    },
  };

  // 6. 익명 워드클라우드
  const CLOUD_COLORS = ['#14213d', '#0e8c7f', '#e4572e', '#b86e00', '#0a6b61', '#5b4bb7', '#c2185b'];
  P.cloud = {
    key: (v) => `${v.cloud.index}`,
    html: (v) => `
      <div class="cloud-wrap">
        <p class="eyebrow">익명 응답 · 이름은 표시되지 않습니다</p>
        <p class="prompt">${esc(content.cloudPrompts[v.cloud.index])}</p>
        <div class="cloud" data-b="cloud"></div>
        <div class="cloud-foot"><span><b data-b="people">0</b>명 · <b data-b="entries">0</b>개 응답</span><span>진행자: 단어를 클릭하면 화면에서 숨깁니다</span></div>
      </div>`,
    update: (v) => {
      $('[data-b=people]', stage).textContent = v.cloud.people;
      $('[data-b=entries]', stage).textContent = v.cloud.entries;
      const box = $('[data-b=cloud]', stage);
      const words = v.cloud.words.filter((w) => !w.hidden);
      const sig = words.map((w) => `${w.text}:${w.count}`).join('|');
      if (box.dataset.sig === sig) return;
      const seen = new Set((box.dataset.seen || '').split('\u0001'));
      box.dataset.sig = sig;
      box.dataset.seen = words.map((w) => w.text).join('\u0001');
      if (!words.length) { box.innerHTML = '<p class="cloud-empty">휴대폰에서 답을 보내면 여기에 나타납니다</p>'; return; }
      const max = words[0].count;
      const arranged = [];
      words.slice(0, 60).forEach((w, i) => (i % 2 ? arranged.push(w) : arranged.unshift(w)));
      box.innerHTML = arranged.map((w) => {
        const size = 1.3 + 3.6 * Math.sqrt(w.count / max) * (words.length < 4 ? 0.8 : 1);
        const color = CLOUD_COLORS[[...w.text].reduce((s, c) => s + c.charCodeAt(0), 0) % CLOUD_COLORS.length];
        const isNew = !seen.has(w.text);
        return `<span class="w" style="font-size:${size.toFixed(2)}rem;color:${color};${isNew ? '' : 'animation:none'}" data-t="${esc(w.text)}">${esc(w.text)}${w.count > 1 ? `<sup>${w.count}</sup>` : ''}</span>`;
      }).join('');
    },
    controls: (v) => {
      const hidden = v.cloud.words.filter((w) => w.hidden).length;
      return [
        ...content.cloudPrompts.map((p, i) => ({ label: `질문 ${i + 1}`, act: () => send('cloud:open', { index: i }), on: v.cloud.index === i })),
        { label: `숨긴 단어 다시 보기 (${hidden})`, act: () => send('cloud:unhide'), disabled: !hidden },
      ];
    },
    primary: (v) => { if (v.cloud.index < content.cloudPrompts.length - 1) send('cloud:open', { index: v.cloud.index + 1 }); },
    back: (v) => { if (v.cloud.index > 0) send('cloud:open', { index: v.cloud.index - 1 }); },
  };
  stage.addEventListener('click', (e) => {
    const w = e.target.closest('.cloud .w');
    if (w) send('cloud:hide', { text: w.dataset.t });
  });

  // 7. 결과 리포트
  // 결과 파일은 서버에서 받아 브라우저에서 바로 저장한다
  let wantExport = null;
  function download(kind) {
    wantExport = kind;
    send('host:export');
  }
  function saveExport(data) {
    if (!wantExport) return;
    const kind = wantExport;
    wantExport = null;
    const type = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
    const url = URL.createObjectURL(new Blob([data[kind]], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  P.report = {
    key: () => 'r',
    html: () => '<div class="report" data-b="report"></div>',
    update: (v) => {
      const sig = JSON.stringify([v.report, v.quiz.stats, v.ox.board, v.deptCounts]);
      if (sig === reportSig && $('[data-b=report]', stage).childElementCount) return;
      reportSig = sig;
      const st = v.quiz.stats;
      const r = v.report;
      const gain = st.pre.avg != null && st.post.avg != null ? Math.round((st.post.avg - st.pre.avg) * 100) : null;
      const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
      const medal = ['🥇', '🥈', '🥉'];
      $('[data-b=report]', stage).innerHTML = `
        <div class="card span12" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:1.2rem">${content.logo ? `<img class="report-logo" src="${esc(content.logo)}" alt="" onerror="this.remove()">` : ''}<div><p class="eyebrow">${esc(content.brand || '')} · ${date}</p><h2 style="font-size:2rem;margin-top:.2rem">${esc(content.title)} 교육 결과</h2></div></div>
          <div class="chips">${v.deptCounts.filter((d) => d.count).map((d) => `<span>${esc(d.dept)}<b>${d.count}</b></span>`).join('')}</div>
        </div>
        <div class="card span12"><div class="kpis" style="justify-content:space-around">
          <div class="kpi"><div class="label">참여 인원</div><div class="value stat">${v.total}명</div></div>
          <div class="kpi"><div class="label">사전 정답률</div><div class="value stat">${pct(st.pre.avg)}</div><div class="sub">${st.pre.count}명 제출</div></div>
          <div class="kpi up"><div class="label">사후 정답률</div><div class="value stat">${pct(st.post.avg)}</div><div class="sub">${st.post.count}명 제출</div></div>
          <div class="kpi up"><div class="label">향상</div><div class="value stat">${gain == null ? '–' : `${gain > 0 ? '+' : ''}${gain}%p`}</div><div class="sub">동일인 ${st.matched.count}명: ${pct(st.matched.pre)} → ${pct(st.matched.post)}</div></div>
        </div></div>
        <div class="card span8"><h3>문항별 정답률 (강의 전 → 후)</h3><div class="mini-rows">
          ${content.quiz.map((q, i) => `
            <div class="r"><span>Q${i + 1}. ${esc(q.question)}</span>
              <span style="display:grid;gap:3px"><span class="bar gray"><i style="width:${(st.pre.per[i] || 0) * 100}%"></i></span><span class="bar"><i style="width:${(st.post.per[i] || 0) * 100}%"></i></span></span>
              <span class="v">${pct(st.pre.per[i])}<br>${pct(st.post.per[i])}</span></div>`).join('')}
        </div></div>
        <div class="card span4"><h3>부서 대항 OX 최종 순위</h3>
          ${v.ox.board.length ? v.ox.board.map((d, i) => `<div class="dept-row" style="margin-bottom:.7rem"><div class="top"><span>${i < 3 ? medal[i] : ''} ${esc(d.dept)}<small>${d.members}명</small></span><span class="stat">${d.score}점</span></div></div>`).join('') : '<p class="muted">진행 기록 없음</p>'}
          <h3 style="margin-top:1.2rem">금지 멘트 잡기 TOP 3</h3>
          ${r.whackTop.length ? r.whackTop.map((p, i) => `<div class="dept-row" style="margin-bottom:.5rem"><div class="top"><span>${medal[i]} ${esc(p.name)}<small>${esc(p.dept)}</small></span><span class="stat">${p.score}점</span></div></div>`).join('') : '<p class="muted">진행 기록 없음</p>'}
        </div>
        <div class="card span12"><h3>응대 멘트 투표 — 추천 응대를 고른 비율</h3><div class="mini-rows">
          ${r.votes.map((x, i) => `<div class="r"><span>상황 ${i + 1}. ${esc(x.title)} <span class="muted">(${x.total}명)</span></span><span class="bar"><i style="width:${(x.bestRate || 0) * 100}%"></i></span><span class="v">${pct(x.bestRate)}</span></div>`).join('')}
        </div></div>
        ${r.cloud.map((c) => `<div class="card span6"><h3>${esc(c.prompt)}</h3><div class="chips">${c.words.map((w) => `<span>${esc(w.text)}<b>${w.count}</b></span>`).join('') || '<span class="muted">응답 없음</span>'}</div></div>`).join('')}
      `;
    },
    controls: () => [
      { label: 'CSV 다운로드 (엑셀)', act: () => download('csv'), primary: true },
      { label: 'JSON 다운로드', act: () => download('json') },
      { label: '인쇄 · PDF 저장', act: () => window.print() },
    ],
  };

  connect();
})();
