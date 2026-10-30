/*
 * socket.io 대신 쓰는 작은 WebSocket 클라이언트.
 *   const socket = io({ auth: { role, key, pid } });
 *   socket.on(ev, fn) / socket.emit(ev, data)
 * 끊기면 자동으로 다시 연결하고, 다시 연결될 때마다 hello 로 자신을 소개한다.
 */
(function () {
  'use strict';
  function io(opts) {
    var auth = (opts && opts.auth) || {};
    var handlers = {};
    var ws = null;
    var open = false;
    var stopped = false;
    var retry = 0;
    var queue = [];

    function fire(ev, d) {
      (handlers[ev] || []).forEach(function (fn) {
        try { fn(d); } catch (e) { console.error(e); }
      });
    }

    function connect() {
      var proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws/main');
      ws.onopen = function () {
        open = true;
        retry = 0;
        ws.send(JSON.stringify({ ev: 'hello', d: auth }));
        fire('connect');
        queue.splice(0).forEach(function (m) { ws.send(m); });
      };
      ws.onmessage = function (e) {
        if (e.data === '__pong') return;
        var m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m && typeof m.ev === 'string') fire(m.ev, m.d);
      };
      ws.onclose = function () {
        var was = open;
        open = false;
        if (was) fire('disconnect');
        if (!stopped) setTimeout(connect, Math.min(5000, 400 * Math.pow(2, retry++)));
      };
      ws.onerror = function () {
        try { ws.close(); } catch (err) { /* 무시 */ }
      };
    }

    setInterval(function () { if (open) ws.send('__ping'); }, 25000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !open && !stopped && ws && ws.readyState === 3) connect();
    });
    connect();

    return {
      on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return this; },
      emit: function (ev, d) {
        var m = JSON.stringify({ ev: ev, d: d || {} });
        if (open) ws.send(m);
        else if (queue.length < 50) queue.push(m);
      },
      disconnect: function () { stopped = true; try { ws.close(); } catch (err) { /* 무시 */ } },
    };
  }
  window.io = io;
})();
