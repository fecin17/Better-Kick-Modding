/**
 * KCE Page Bridge - běží v MAIN world na document_start
 * 1. Zachytává auth headery z fetch volání Kicku
 * 2. Zachytává message ID z WebSocket (Pusher) zpráv
 * 3. Provádí authenticated fetch na žádost content scriptu
 */
(function () {
  // Debug log helper – tichý v produkci; zapni přes `localStorage.kceDebug = '1'` + reload
  const KCE_DEBUG = (() => {
    try { return localStorage.getItem("kceDebug") === "1"; } catch { return false; }
  })();
  const kceLog = KCE_DEBUG ? console.log.bind(console) : () => {};

  const capturedHeaders = {};
  const messageStore = new Map();   // username -> [{id, time, content}]

  // TTL pro WebSocket message store: dlouhé streamy by jinak držely tisíce userů × 200 zpráv.
  const MSG_TTL_MS = 30 * 60 * 1000;     // zprávy starší 30 min vyhodit
  const MSG_MAX_USERS = 1000;
  function evictMessageStore() {
    const now = Date.now();
    for (const [user, list] of messageStore) {
      const fresh = list.filter((m) => now - m.time <= MSG_TTL_MS);
      if (fresh.length) messageStore.set(user, fresh);
      else messageStore.delete(user);
    }
    if (messageStore.size > MSG_MAX_USERS) {
      const sorted = [...messageStore.entries()].sort(
        (a, b) => (a[1].at(-1)?.time || 0) - (b[1].at(-1)?.time || 0)
      );
      for (const [u] of sorted.slice(0, messageStore.size - MSG_MAX_USERS)) messageStore.delete(u);
    }
  }
  setInterval(evictMessageStore, 60000);

  const OrigWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(OrigWebSocket, {
    construct(target, args) {
      const ws = new target(...args);
      ws.addEventListener("message", (event) => {
        try {
          const parsed = JSON.parse(event.data);
          let inner = parsed.data;
          if (typeof inner === "string") inner = JSON.parse(inner);
          if (!inner || !inner.id || !(inner.sender || inner.user || inner.chatMessage)) return;

          const msg = inner.chatMessage || inner;
          const usernameRaw = msg.sender?.username || msg.sender?.slug || msg.user?.username || "";
          if (!usernameRaw) return;
          const username = usernameRaw.toLowerCase();
          const content = (msg.content || "").trim();
          const messageId = String(msg.id);

          // 1) Ulož do store pro budoucí lookup při smazání zprávy
          if (!messageStore.has(username)) messageStore.set(username, []);
          const list = messageStore.get(username);
          list.push({ id: messageId, time: Date.now(), content: content.slice(0, 100) });
          if (list.length > 200) list.splice(0, list.length - 200);

          // 2) Vystřel event pro Moderation Assist – detekce zpráv přímo z Pusher streamu
          //    je 100% spolehlivá (žádný DOM parsing, žádná race condition s renderem).
          if (content) {
            document.dispatchEvent(new CustomEvent("kce-new-chat-message", {
              detail: { username: usernameRaw, content, messageId, time: Date.now() }
            }));
          }
        } catch (_) {}
      });
      return ws;
    }
  });

  const origFetch = window.fetch;
  window.fetch = new Proxy(origFetch, {
    apply(target, thisArg, args) {
      const [input, init] = args;
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
      return Reflect.apply(target, thisArg, args);
    }
  });

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
    // Fallback "poslední zpráva uživatele" použijeme jen pokud volající content NEPOSLAL.
    // Když content přijde a nesedne, vracíme null – jinak by se smazala náhodná zpráva.
    if (!match && !content && list.length) match = list[list.length - 1];
    kceLog("[KCE-Bridge] lookup:", slug, "stored:", list.length, "match:", match?.id || "none");
    document.dispatchEvent(new CustomEvent("kce-lookup-result", {
      detail: { id, messageId: match?.id || null, storedCount: list.length }
    }));
  });
})();
