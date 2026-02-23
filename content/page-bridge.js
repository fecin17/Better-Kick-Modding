/**
 * KCE Page Bridge - běží v MAIN world (kontext stránky)
 * Zachytává auth headery z Kick API volání a používá je pro moderaci.
 */
(function () {
  const capturedHeaders = {};
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
      console.log("[KCE-Bridge] fetch", url.replace("https://kick.com", ""), "auth:", !!reqHeaders["Authorization"], "headers:", Object.keys(reqHeaders));
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

  document.addEventListener("kce-get-auth-status", () => {
    document.dispatchEvent(new CustomEvent("kce-auth-status", {
      detail: { headers: Object.keys(capturedHeaders), hasAuth: !!capturedHeaders["authorization"] }
    }));
  });
})();
