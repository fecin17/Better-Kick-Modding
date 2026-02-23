/**
 * KCE Page Bridge - běží v MAIN world na document_start
 * 1. Zachytává auth headery z fetch volání Kicku
 * 2. Zachytává message ID z WebSocket (Pusher) zpráv
 * 3. Provádí authenticated fetch na žádost content scriptu
 */
(function () {
  const capturedHeaders = {};
  const messageStore = new Map();

  const OrigWebSocket = window.WebSocket;
  window.WebSocket = function (...args) {
    const ws = new OrigWebSocket(...args);
    ws.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data);
        let inner = parsed.data;
        if (typeof inner === "string") inner = JSON.parse(inner);
        if (inner && inner.id && (inner.sender || inner.user || inner.chatMessage)) {
          const msg = inner.chatMessage || inner;
          const username = (msg.sender?.username || msg.sender?.slug || msg.user?.username || "").toLowerCase();
          if (username) {
            if (!messageStore.has(username)) messageStore.set(username, []);
            const list = messageStore.get(username);
            list.push({ id: String(msg.id), time: Date.now(), content: (msg.content || "").slice(0, 100) });
            if (list.length > 200) list.splice(0, list.length - 200);
          }
        }
      } catch (_) {}
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;
  window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
  window.WebSocket.OPEN = OrigWebSocket.OPEN;
  window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
  window.WebSocket.CLOSED = OrigWebSocket.CLOSED;

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url.includes("/api/") && init?.headers) {
      try {
        const h = init.headers;
        if (h instanceof Headers) {
          h.forEach((v, k) => { capturedHeaders[k.toLowerCase()] = v; });
        } else if (typeof h === "object" && !Array.isArray(h)) {
          for (const [k, v] of Object.entries(h)) { capturedHeaders[k.toLowerCase()] = v; }
        }
      } catch (_) {}
    }
    return origFetch.apply(this, arguments);
  };

  document.addEventListener("kce-fetch-request", async (e) => {
    const { id, url, options } = e.detail || {};
    if (!id || !url) return;
    try {
      const reqHeaders = { ...(options?.headers || {}) };
      if (capturedHeaders["authorization"] && !reqHeaders["Authorization"] && !reqHeaders["authorization"]) {
        reqHeaders["Authorization"] = capturedHeaders["authorization"];
      }
      if (capturedHeaders["x-xsrf-token"] && !reqHeaders["X-XSRF-TOKEN"] && !reqHeaders["x-xsrf-token"]) {
        reqHeaders["X-XSRF-TOKEN"] = capturedHeaders["x-xsrf-token"];
      }
      for (const k of Object.keys(capturedHeaders)) {
        const lower = k.toLowerCase();
        if (lower === "authorization" || lower === "x-xsrf-token") continue;
        if (lower.startsWith("x-") || lower === "accept") {
          if (!reqHeaders[k]) reqHeaders[k] = capturedHeaders[k];
        }
      }
      const opts = { ...options, headers: reqHeaders, credentials: "include" };
      const r = await origFetch(url, opts);
      const text = await r.text();
      document.dispatchEvent(new CustomEvent("kce-fetch-response", {
        detail: { id, ok: r.ok, status: r.status, text }
      }));
    } catch (err) {
      document.dispatchEvent(new CustomEvent("kce-fetch-response", {
        detail: { id, ok: false, status: 0, text: String(err) }
      }));
    }
  });

  document.addEventListener("kce-lookup-message", (e) => {
    const { id, username, content } = e.detail || {};
    if (!id) return;
    const slug = (username || "").toLowerCase();
    const list = messageStore.get(slug) || [];
    let match = null;
    if (content && list.length) {
      const clean = content.replace(/\s+/g, " ").trim().slice(0, 80);
      match = [...list].reverse().find(m => clean.includes(m.content.slice(0, 30)) || m.content.includes(clean.slice(0, 30)));
    }
    if (!match && list.length) match = list[list.length - 1];
    console.log("[KCE-Bridge] lookup:", slug, "stored:", list.length, "match:", match?.id || "none");
    document.dispatchEvent(new CustomEvent("kce-lookup-result", {
      detail: { id, messageId: match?.id || null, storedCount: list.length }
    }));
  });
})();
