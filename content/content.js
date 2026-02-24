/**
 * Kick Chat Enhancer - Content Script
 * Vylepšuje vzhled chatu na Kick.com podle Twitch inspirace
 * Verze 1.1: Podpora Shadow DOM a rozšířené selektory
 */

(function () {
  "use strict";

  const STORAGE_KEY = "kickChatEnhancerSettings";

  const defaultSettings = {
    messageSpacing: true,
    visualSeparation: true,
    improveReplyStyling: true,
    emoteSize: true,
    usernameHighlight: true,
    pauseChatOnHover: true,
    modDragHandle: true,
    chatFontSize: 13,
    messageSpacingPx: 5,
  };

  let cachedCss = null;
  let modDragIntervalId = null;

  async function getCssText() {
    if (cachedCss) return cachedCss;
    const url = chrome.runtime.getURL("styles/chat-enhancements.css");
    const res = await fetch(url);
    cachedCss = await res.text();
    return cachedCss;
  }

  function injectCssIntoRoot(root) {
    const target = root === document || root === document.documentElement ? document.head : root;
    if (!target || !target.appendChild) return;
    getCssText().then((css) => {
      let style = target.querySelector?.("style[data-kce-injected]");
      if (!style) {
        style = document.createElement("style");
        style.setAttribute("data-kce-injected", "1");
        style.textContent = css;
        target.appendChild(style);
      }
    });
  }

  function injectIntoAllShadowRoots() {
    injectCssIntoRoot(document);
    try {
      document.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) injectCssIntoRoot(el.shadowRoot);
      });
    } catch (_) {}
  }

  async function getSettings() {
    try {
      const result = await chrome.storage.sync.get(STORAGE_KEY);
      return { ...defaultSettings, ...result[STORAGE_KEY] };
    } catch {
      return defaultSettings;
    }
  }

  function addEnhancementClass(element, className) {
    if (element && !element.classList.contains(`kce-${className}`)) {
      element.classList.add(`kce-${className}`);
    }
  }

  function applyEnhancements(settings) {
    const html = document.documentElement;
    html.dataset.kceMessageSpacing = settings.messageSpacing ? "1" : "0";
    html.dataset.kceVisualSeparation = settings.visualSeparation ? "1" : "0";
    html.dataset.kceReplyStyling = settings.improveReplyStyling ? "1" : "0";
    html.dataset.kceEmoteSize = settings.emoteSize ? "1" : "0";
    html.dataset.kceUsernameHighlight = settings.usernameHighlight ? "1" : "0";
    html.dataset.kcePauseChatOnHover = settings.pauseChatOnHover ? "1" : "0";
    html.dataset.kceModDrag = settings.modDragHandle ? "1" : "0";
    const fontSize = settings.chatFontSize || 13;
    html.style.setProperty("--kce-font-size", fontSize + "px");
    const msgSpacing = settings.messageSpacingPx ?? 5;
    html.style.setProperty("--kce-msg-spacing", msgSpacing + "px");
    if (!settings.modDragHandle) {
      querySelectorAllDeep(document.body, ".kce-mod-handle").forEach((h) => h.remove());
    }
  }

  /** Vrátí všechny elementy odpovídající selektoru v root i uvnitř všech Shadow DOM. */
  function querySelectorAllDeep(root, selector) {
    const out = [];
    const collect = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
      try {
        const list = node.querySelectorAll?.(selector) ?? [];
        list.forEach((el) => out.push(el));
        const all = node.querySelectorAll?.("*") ?? [];
        all.forEach((child) => {
          if (child.shadowRoot) collect(child.shadowRoot);
        });
      } catch (_) {}
    };
    collect(root);
    return out;
  }

  /**
   * Spolehlivě najde kořenový element chatroom.
   * Primárně kotví přes input "Send a message" – ten existuje POUZE v chatu,
   * nikdy ve Stream Videos / Clips / Following sekci.
   */
  function findChatroomEl() {
    // 1. Kotva přes "Send a message" input – nejspolehlivější
    const inputs = document.querySelectorAll("input[placeholder], textarea[placeholder]");
    for (const input of inputs) {
      const ph = (input.getAttribute("placeholder") || "").toLowerCase();
      if (!ph.includes("message") && !ph.includes("send") && !ph.includes("chat")) continue;
      let p = input.parentElement;
      for (let i = 0; i < 15 && p && p !== document.body; i++, p = p.parentElement) {
        if (p.offsetHeight > 200) return p;
      }
    }
    // 2. ID-based selectors
    const byId = document.getElementById("chatroom") ||
                 querySelectorDeep(document.body, "#chatroom") ||
                 document.querySelector("[id*='chatroom']");
    if (byId && byId.offsetHeight > 100) return byId;
    // 3. Class-based selectors (méně spolehlivé – jako poslední možnost)
    const byCls = document.querySelector("[class*='chatroom-container']") ||
                  querySelectorDeep(document.body, "[class*='chatroom']") ||
                  document.querySelector("[class*='chatroom']");
    if (byCls && byCls.offsetHeight > 100) return byCls;
    return null;
  }

  function tagChatMessages(root = null) {
    const doc = document;
    const base = root ?? doc;

    // Při volání z dokumentu vždy omezíme na chatroom element
    // – zabrání tagování Stream Videos, Clips, Following listu apod.
    const chatroomEl = base === doc ? findChatroomEl() : (base instanceof ShadowRoot ? base : base);
    const effectiveBase = chatroomEl ?? base;

    // 1. data-chat-entry
    querySelectorAllDeep(effectiveBase, "[data-chat-entry]").forEach((el) => {
      addEnhancementClass(el, "message");
      ensureModHandle(el);
    });

    // 2. Třídy chat-entry, chatEntry, message-row
    querySelectorAllDeep(effectiveBase, "[class*='chat-entry'], [class*='chatEntry'], [class*='message-row']").forEach((el) => {
      addEnhancementClass(el, "message");
      ensureModHandle(el);
    });

    // Pokud jsme na stránce bez chatu (kanál/klipy/videa), dál nepokračovat
    if (base === doc && !chatroomEl) return;

    // 3. Fallback: divy v scroll kontejneru chatu
    const chatScrollRoot = chatroomEl ?? (base === doc ? document.body : base);
    const chatScroll = querySelectorDeep(chatScrollRoot, "[class*='chat'][class*='scroll']")
      || querySelectorDeep(chatScrollRoot, "[class*='chatroom'][class*='scroll']");
    if (chatScroll) {
      const candidates = chatScroll.querySelectorAll?.(":scope > div > div, :scope > div") ?? [];
      candidates.forEach((el) => {
        const text = el.textContent || "";
        const hasColon = text.includes(":");
        const hasEmote = el.querySelector("img[data-emote-id], img.gc-emote-c, img[class*='emote']");
        if (hasColon || hasEmote) {
          addEnhancementClass(el, "message");
          ensureModHandle(el);
        }
      });
    }

    // Sekce 4a/4b/5 prohledáváme VÝHRADNĚ uvnitř chatroom kontejneru
    const searchRootForIndex = chatroomEl ?? (base !== doc ? base : null);
    if (!searchRootForIndex) return;

    const seen = new Set();
    const skipText = /Send a message|Slow mode activated|^Chat$/i;

    function addIfMessageRow(el) {
      if (seen.has(el)) return;
      const text = (el.textContent || "").trim();
      if (skipText.test(text) || text.length < 3) return;
      if (el.querySelector?.("input, textarea, [contenteditable=true]")) return;
      const hasLink = el.querySelector?.("a[href]");
      const hasColon = text.includes(":");
      const hasEmote = el.querySelector?.("img");
      const looksLikeMessage = (hasLink && hasColon) || (hasColon && text.length > 8) || (hasEmote && hasColon);
      const reasonableSize = el.childNodes.length >= 1 && el.childNodes.length <= 100;
      if (looksLikeMessage && reasonableSize) {
        seen.add(el);
        addEnhancementClass(el, "message");
        ensureModHandle(el);
      }
    }

    // 4a. div[data-index] (Kick virtuální seznam)
    querySelectorAllDeep(searchRootForIndex, "div[data-index]").forEach(addIfMessageRow);

    // 4b. div.group uvnitř řádku – rodič je řádek zprávy
    querySelectorAllDeep(searchRootForIndex, "[class*='group']").forEach((el) => {
      const text = (el.textContent || "").trim();
      if (!text.includes(":") || text.length < 4) return;
      if (el.querySelector?.("input, textarea")) return;
      const parent = el.parentElement;
      if (!parent || seen.has(parent)) return;
      if (parent.querySelector?.("a[href]") || el.querySelector?.("a[href]")) {
        const reasonable = parent.childNodes.length >= 1 && parent.childNodes.length <= 100;
        if (reasonable) {
          seen.add(parent);
          addEnhancementClass(parent, "message");
          ensureModHandle(parent);
        }
      }
    });

    // 5. Třídy message/line/entry/row – prohledáváme POUZE searchRootForIndex (chatroom)
    querySelectorAllDeep(searchRootForIndex, "[class*='message'], [class*='Message'], [class*='line'], [class*='Line'], [class*='entry'], [class*='Entry'], [class*='row'], [class*='Row']").forEach((el) => {
      if (seen.has(el)) return;
      const hasLink = el.querySelector?.("a[href]");
      const hasColon = (el.textContent || "").includes(":");
      const hasEmote = el.querySelector?.("img");
      if ((hasLink && hasColon) || hasEmote) {
        const reasonable = el.childNodes.length >= 1 && el.childNodes.length <= 80;
        if (reasonable) {
          seen.add(el);
          addEnhancementClass(el, "message");
          ensureModHandle(el);
        }
      }
    });

  }

  function ensureModHandle(entryEl) {
    if (document.documentElement.dataset.kceModDrag !== "1") return;
    if (entryEl.querySelector(".kce-mod-handle")) return;
    const root = entryEl.getRootNode();
    if (root instanceof ShadowRoot) injectCssIntoRoot(root);
    const handle = document.createElement("div");
    handle.className = "kce-mod-handle";
    handle.setAttribute("data-kce-internal", "1");
    handle.textContent = "\u22EE";
    requestAnimationFrame(() => {
      if (!entryEl.querySelector(".kce-mod-handle")) {
        entryEl.appendChild(handle);
      }
    });
  }

  function findEntry(startEl) {
    let el = startEl;
    while (el && el !== document.body) {
      if (el.classList?.contains("kce-message") || el.dataset?.index !== undefined || el.dataset?.chatEntry !== undefined) return el;
      el = el.parentElement;
    }
    return null;
  }

  function extractFrameworkData(el) {
    const nodes = [];
    const walk = (n, d) => {
      if (d > 6 || !n) return;
      for (const c of n.children || []) walk(c, d + 1);
      nodes.push(n);
    };
    walk(el, 0);
    let p = el.parentElement;
    for (let i = 0; i < 5 && p && p !== document.body; i++, p = p.parentElement) nodes.push(p);

    for (const node of nodes) {
      let keys;
      try { keys = Object.keys(node); } catch (_) { continue; }

      const reactKey = keys.find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      if (reactKey) {
        let fiber = node[reactKey];
        for (let i = 0; i < 30 && fiber; i++, fiber = fiber.return) {
          const mp = fiber.memoizedProps;
          if (!mp || typeof mp !== "object") continue;
          let mid = mp.messageId || mp.message_id || mp.chatMessageId || mp.msgId || null;
          const nested = mp.message || mp.chatMessage || mp.msg || mp.data || mp.item || null;
          if (!mid && nested && typeof nested === "object") mid = nested.id || nested.messageId || null;
          if (!mid && mp.id) { const s = String(mp.id); if (/^[0-9a-f]{8}-/.test(s) || s.length > 10) mid = s; }
          if (mid) {
            const src = nested || mp;
            return { messageId: String(mid), username: src.sender?.username || src.user?.username || src.username || null };
          }
        }
      }

      const vue = node.__vue__ || node.__vueParentComponent || node.__vue_app__;
      if (vue) {
        const search = (obj, depth) => {
          if (!obj || depth > 3 || typeof obj !== "object") return null;
          if (obj.messageId || obj.message_id) return { messageId: String(obj.messageId || obj.message_id), username: obj.sender?.username || obj.user?.username || obj.username || null };
          if (obj.message?.id) return { messageId: String(obj.message.id), username: obj.message.sender?.username || obj.message.user?.username || null };
          for (const k of Object.keys(obj)) {
            if (k.startsWith("_") || k === "$" || k === "el") continue;
            const r = search(obj[k], depth + 1);
            if (r) return r;
          }
          return null;
        };
        const ctx = vue.ctx || vue.$data || vue._data || vue.setupState || vue;
        const r = search(ctx, 0);
        if (r) return r;
        if (vue.proxy) { const r2 = search(vue.proxy, 0); if (r2) return r2; }
        if (vue.props) { const r3 = search(vue.props, 0); if (r3) return r3; }
      }
    }
    return null;
  }

  function getMessageData(entryEl) {
    const channelMatch = window.location.pathname.match(/^\/([^/]+)/);
    const channel = channelMatch ? channelMatch[1] : null;

    let messageId = entryEl.dataset?.messageId || entryEl.dataset?.id || null;
    if (!messageId && entryEl.id) {
      const cleaned = entryEl.id.replace(/^[^0-9a-f-]+/i, "");
      if (cleaned.length > 8) messageId = cleaned;
    }
    if (!messageId && entryEl.dataset?.chatEntry) {
      const ce = String(entryEl.dataset.chatEntry);
      if (ce.length > 4) messageId = ce;
    }
    if (!messageId) {
      const fromChild = entryEl.querySelector?.("[data-message-id], [data-id]");
      if (fromChild) messageId = fromChild.dataset?.messageId || fromChild.dataset?.id || null;
    }

    let username = null;
    const fw = extractFrameworkData(entryEl);
    if (fw) {
      if (!messageId && fw.messageId) messageId = fw.messageId;
      if (fw.username) username = fw.username;
    }

    if (!username) {
      const usernameEl = entryEl.querySelector(
        'a[class*="username"], a[class*="chat-entry-username"], a[data-chat-entry-user],' +
        'span[class*="username"], button[class*="username"],' +
        'a[class*="user-name"], span[class*="user-name"]'
      );
      if (usernameEl) {
        const href = usernameEl.getAttribute?.("href");
        if (href) { const m = href.match(/\/([^/]+)\/?$/); if (m) username = m[1]; }
        if (!username) username = (usernameEl.textContent || "").trim().replace(/:$/, "");
      }
    }
    if (!username) {
      const links = entryEl.querySelectorAll("a[href]");
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        if (href.startsWith("http") && !href.includes("kick.com")) continue;
        const m = href.match(/\/([A-Za-z][\w]{1,24})\/?$/);
        if (m) { username = m[1]; break; }
      }
    }
    if (!username) {
      const styled = entryEl.querySelectorAll("span[style*='color'], span[class], a[class], button[class]");
      for (const el of styled) {
        if (el.children.length > 2) continue;
        const t = (el.textContent || "").trim().replace(/:$/, "");
        if (t.length >= 2 && t.length <= 25 && /^[A-Za-z]/.test(t) && /^[\w]+$/.test(t)) {
          username = t;
          break;
        }
      }
    }

    // --- DIAGNOSTIC (temporary) ---
    if (!messageId || !username) {
      const fwKeys = new Set();
      const scanFw = (n, d) => {
        if (d > 4) return;
        try { Object.keys(n).filter(k => k.startsWith("__")).forEach(k => fwKeys.add(k.slice(0, 35))); } catch (_) {}
        for (const c of n.children || []) scanFw(c, d + 1);
      };
      scanFw(entryEl, 0);
      const allData = {};
      const scanData = (n, d) => {
        if (d > 4) return;
        if (n.dataset) for (const [k, v] of Object.entries(n.dataset)) { if (k !== "kceInternal") allData[k] = v; }
        for (const c of n.children || []) scanData(c, d + 1);
      };
      scanData(entryEl, 0);
      console.log("[KCE] DIAG entry tag:", entryEl.tagName, "classes:", entryEl.className?.slice(0, 100));
      console.log("[KCE] DIAG framework keys:", [...fwKeys]);
      console.log("[KCE] DIAG data-* attrs:", allData);
      console.log("[KCE] DIAG innerHTML (500):", entryEl.innerHTML?.slice(0, 500));
      console.log("[KCE] DIAG links:", [...entryEl.querySelectorAll("a")].map(a => ({ href: a.getAttribute("href"), text: a.textContent?.trim()?.slice(0, 30) })));
    }

    console.log("[KCE] Message data:", { channel, messageId, username, fwFound: !!fw });
    return { channel, messageId, username, messageText: (entryEl.textContent || "").trim().slice(0, 200) };
  }

  function formatDuration(s) {
    if (s < 60) return Math.round(s) + "s";
    if (s < 3600) return Math.round(s / 60) + " min";
    if (s < 86400) return Math.round(s / 3600) + " h";
    return Math.round(s / 86400) + " d";
  }

  function getXsrfToken() {
    const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function buildApiHeaders(withContentType) {
    const h = { "Accept": "application/json, text/plain, */*" };
    const xsrf = getXsrfToken();
    if (xsrf) h["X-XSRF-TOKEN"] = xsrf;
    if (withContentType) h["Content-Type"] = "application/json";
    return h;
  }

  function lookupMessageId(username, content) {
    return new Promise((resolve) => {
      const id = "kce_lu_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      const handler = (e) => {
        if (e.detail?.id === id) {
          document.removeEventListener("kce-lookup-result", handler);
          resolve(e.detail);
        }
      };
      document.addEventListener("kce-lookup-result", handler);
      document.dispatchEvent(new CustomEvent("kce-lookup-message", {
        detail: { id, username, content }
      }));
      setTimeout(() => {
        document.removeEventListener("kce-lookup-result", handler);
        resolve({ messageId: null, storedCount: 0 });
      }, 2000);
    });
  }

  function pageContextFetch(url, options) {
    return new Promise((resolve) => {
      const id = "kce_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      const handler = (e) => {
        if (e.detail?.id === id) {
          document.removeEventListener("kce-fetch-response", handler);
          resolve(e.detail);
        }
      };
      document.addEventListener("kce-fetch-response", handler);
      document.dispatchEvent(new CustomEvent("kce-fetch-request", {
        detail: { id, url, options }
      }));
      setTimeout(() => {
        document.removeEventListener("kce-fetch-response", handler);
        resolve({ ok: false, status: 0, text: "bridge timeout - reload page" });
      }, 15000);
    });
  }

  function showModToast(message, success) {
    const existing = document.querySelector(".kce-mod-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "kce-mod-toast";
    toast.textContent = message;
    toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100000;" +
      "padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;color:#fff;" +
      "box-shadow:0 4px 12px rgba(0,0,0,0.4);pointer-events:none;opacity:0;transition:opacity 0.3s;" +
      "background:" + (success ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)") + ";";
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }

  function showBanConfirmation(username, onConfirm) {
    const existing = document.querySelector(".kce-ban-confirm");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.className = "kce-ban-confirm";
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:100001;" +
      "background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;";
    const box = document.createElement("div");
    box.style.cssText = "background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;" +
      "padding:24px 32px;text-align:center;color:#fff;font-size:14px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.5);";
    const safeUser = (username || "?").replace(/[<>&"]/g, "");
    box.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:12px;color:#ef4444;">\u26A0 Permanent Ban</div>' +
      '<div style="margin-bottom:20px;">Opravdu chce\u0161 zabanovat <strong style="color:#f87171;">' + safeUser + '</strong> natrvalo?</div>' +
      '<div style="display:flex;gap:12px;justify-content:center;">' +
      '<button class="kce-ban-yes" style="padding:8px 24px;border-radius:6px;border:none;background:#ef4444;color:#fff;font-weight:600;cursor:pointer;font-size:13px;">Zabanovat</button>' +
      '<button class="kce-ban-no" style="padding:8px 24px;border-radius:6px;border:none;background:rgba(255,255,255,0.1);color:#ccc;font-weight:600;cursor:pointer;font-size:13px;">Zru\u0161it</button>' +
      '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    box.querySelector(".kce-ban-no").addEventListener("click", close);
    box.querySelector(".kce-ban-yes").addEventListener("click", () => {
      close();
      onConfirm().then((ok) => {
        showModToast(ok ? "U\u017eivatel " + safeUser + " zabanov\u00e1n" : "Chyba p\u0159i banov\u00e1n\u00ed " + safeUser, ok);
      });
    });
  }

  function getSwipeAction(pct) {
    if (pct < 0.05) return null;
    if (pct < 0.25) return { action: "delete", label: "Smazat", color: "#dc2626" };
    if (pct < 0.75) {
      const t = (pct - 0.25) / 0.5;
      const minS = 30;
      const maxS = 1209600;
      const raw = minS * Math.pow(maxS / minS, t);
      const secs = Math.round(raw);
      const r = Math.round(40 + t * 160);
      const g = Math.round(160 - t * 120);
      return { action: "timeout", label: "Timeout " + formatDuration(secs), durationSeconds: secs, color: "rgb(" + r + "," + g + ",30)" };
    }
    return { action: "ban", label: "PERMANENT BAN", color: "#7f1d1d" };
  }

  function setupModDragHandle(settings) {
    if (modDragIntervalId) {
      clearInterval(modDragIntervalId);
      modDragIntervalId = null;
    }
    if (!settings.modDragHandle) return;
    modDragIntervalId = setInterval(() => {
      if (document.documentElement.dataset.kceModDrag !== "1") {
        clearInterval(modDragIntervalId);
        modDragIntervalId = null;
        return;
      }
      tagChatMessages();
    }, 1500);

    let drag = null;

    const onMove = (e) => {
      if (!drag) return;
      const dx = Math.max(0, e.clientX - drag.startX);
      const pct = Math.min(dx / drag.entryWidth, 1);
      drag.entry.style.setProperty("transform", "translateY(" + drag.origTY + "px) translateX(" + dx + "px)", "important");
      drag.bg.style.width = dx + "px";
      const info = getSwipeAction(pct);
      if (info) {
        drag.bg.style.background = info.color;
        drag.bg.textContent = info.label;
      } else {
        drag.bg.style.background = "transparent";
        drag.bg.textContent = "";
      }
      drag.lastPct = pct;
    };

    const onUp = () => {
      if (!drag) return;
      const pct = drag.lastPct || 0;
      const info = getSwipeAction(pct);
      const entry = drag.entry;
      const bg = drag.bg;
      const scrollCt = drag.scrollCt;
      const data = getMessageData(entry);
      entry.style.setProperty("transform", "translateY(" + drag.origTY + "px)", "important");
      entry.style.transition = "transform 0.2s ease";
      bg.style.transition = "width 0.2s ease, opacity 0.2s ease";
      bg.style.width = "0";
      bg.style.opacity = "0";
      setTimeout(() => {
        entry.style.transition = "";
        entry.style.removeProperty("z-index");
        if (bg.parentNode) bg.remove();
        if (scrollCt) scrollCt.style.removeProperty("overflow-x");
      }, 300);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      drag = null;
      if (info) executeModAction(info, data);
    };

    document.addEventListener("mousedown", (e) => {
      if (document.documentElement.dataset.kceModDrag !== "1") return;
      const path = e.composedPath?.() ?? (e.target ? [e.target] : []);
      const handle = path.find((el) => el?.classList?.contains?.("kce-mod-handle"));
      if (!handle) return;
      const entry = findEntry(handle);
      if (!entry) return;
      e.preventDefault();
      e.stopPropagation();
      const cs = getComputedStyle(entry);
      const matrix = cs.transform;
      let origTY = 0;
      if (matrix && matrix !== "none") {
        const match = matrix.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
        if (match) origTY = parseFloat(match[1]) || 0;
      }
      const bg = document.createElement("div");
      bg.className = "kce-swipe-bg";
      const entryH = entry.offsetHeight;
      bg.style.cssText = "position:absolute;left:0;top:0;width:0;height:" + entryH + "px;" +
        "display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;overflow:hidden;white-space:nowrap;" +
        "text-shadow:0 1px 4px rgba(0,0,0,0.7);border-radius:0 4px 4px 0;pointer-events:none;" +
        "transform:translateY(" + origTY + "px);z-index:1;transition:background 0.1s;";
      const vParent = entry.parentElement;
      if (vParent) vParent.appendChild(bg);
      const scrollCt = vParent?.parentElement;
      if (scrollCt) scrollCt.style.setProperty("overflow-x", "clip", "important");

      entry.style.setProperty("z-index", "10", "important");
      drag = { entry, startX: e.clientX, entryWidth: entry.offsetWidth, origTY, bg, scrollCt, lastPct: 0 };
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }, true);
  }

  async function runModerationApi(payload) {
    const { action, channel, messageId, username, durationSeconds } = payload;
    if (!channel) return { ok: false, error: "chybí channel" };
    const base = "https://kick.com";
    const xsrf = getXsrfToken();
    const slug = username ? username.toLowerCase() : null;
    console.log("[KCE] API:", action, "ch:", channel, "user:", slug, "xsrf:", xsrf ? "yes" : "NO!");

    async function tryFetch(url, opts) {
      const fetchOpts = { credentials: "include", ...opts };
      const r = await pageContextFetch(url, fetchOpts);
      console.log("[KCE]", r.ok ? "OK" : "FAIL", r.status, url.replace(base, ""), r.ok ? "" : r.text?.slice(0, 150));
      return r;
    }

    try {
      if (action === "delete") {
        const crRes = await pageContextFetch(base + "/api/v2/channels/" + encodeURIComponent(channel) + "/chatroom", {
          credentials: "include", headers: buildApiHeaders(false),
        });
        if (!crRes.ok) return { ok: false, error: "chatroom fetch " + crRes.status };
        let crData;
        try { crData = JSON.parse(crRes.text); } catch (_) { return { ok: false, error: "chatroom parse error" }; }
        const chatroomId = crData?.id ?? crData?.chatroom?.id;
        if (!chatroomId) return { ok: false, error: "chatroom ID nenalezeno" };

        let targetId = messageId;
        if (!targetId && slug) {
          const msgText = payload.messageText || "";
          console.log("[KCE] Delete: lookup přes WebSocket store pro:", slug);
          const lookup = await lookupMessageId(slug, msgText);
          console.log("[KCE] Delete: lookup result:", lookup);
          if (lookup.messageId) targetId = lookup.messageId;
        }
        if (!targetId) return { ok: false, error: "Zpráva nenalezena (uživatel: " + slug + "). Zpráva musí přijít přes chat než ji lze smazat." };
        const r = await tryFetch(base + "/api/v2/chatrooms/" + chatroomId + "/messages/" + encodeURIComponent(targetId), {
          method: "DELETE", headers: buildApiHeaders(false),
        });
        return { ok: r.ok, error: r.ok ? "" : r.status + " " + (r.text || "").slice(0, 80) };
      }

      if (action === "ban") {
        if (!slug) return { ok: false, error: "chybí username" };
        const r = await tryFetch(base + "/api/v2/channels/" + encodeURIComponent(channel) + "/bans", {
          method: "POST", headers: buildApiHeaders(true),
          body: JSON.stringify({ banned_username: slug, permanent: true }),
        });
        return { ok: r.ok, error: r.ok ? "" : r.status + " " + r.text.slice(0, 80) };
      }

      if (action === "timeout") {
        if (!slug || !durationSeconds) return { ok: false, error: "chybí username/duration" };
        const durMin = Math.max(1, Math.ceil(durationSeconds / 60));

        const r1 = await tryFetch(base + "/api/v2/channels/" + encodeURIComponent(channel) + "/bans", {
          method: "POST", headers: buildApiHeaders(true),
          body: JSON.stringify({ banned_username: slug, duration: durMin }),
        });
        if (r1.ok) return { ok: true, error: "" };

        const r2 = await tryFetch(base + "/api/v1/channels/" + encodeURIComponent(channel) + "/mute-user", {
          method: "POST", headers: buildApiHeaders(true),
          body: JSON.stringify({ username: slug, duration: durationSeconds }),
        });
        if (r2.ok) return { ok: true, error: "" };

        return { ok: false, error: "v2:" + r1.status + " " + r1.text.slice(0, 60) + " | v1:" + r2.status + " " + r2.text.slice(0, 60) };
      }
    } catch (err) {
      console.warn("[KCE] Moderation error:", err);
      return { ok: false, error: String(err).slice(0, 100) };
    }
    return { ok: false, error: "neznámá akce" };
  }

  function executeModAction(info, data) {
    if (!data.channel) { showModToast("Nepodařilo se zjistit kanál", false); return; }
    if (!data.username && !data.messageId) {
      showModToast("Nepodařilo se zjistit uživatele ani ID zprávy", false);
      return;
    }
    const payload = {
      action: info.action,
      channel: data.channel,
      messageId: data.messageId,
      username: data.username,
      durationSeconds: info.durationSeconds || null,
      messageText: data.messageText || "",
    };
    if (info.action === "ban") {
      showBanConfirmation(data.username, async () => {
        const res = await runModerationApi(payload);
        return res.ok;
      });
    } else {
      runModerationApi(payload).then((res) => {
        let msg;
        if (info.action === "delete") {
          msg = res.ok ? "Zpráva smazána" : "Chyba: " + (res.error || "smazání selhalo");
        } else {
          msg = res.ok ? "Timeout " + formatDuration(info.durationSeconds) + " – " + data.username : "Chyba: " + (res.error || "timeout selhal");
        }
        showModToast(msg, res.ok);
      });
    }
  }

  function observeChat() {
    let tagPending = false;
    const scheduleTag = () => {
      if (tagPending) return;
      tagPending = true;
      requestAnimationFrame(() => {
        tagPending = false;
        tagChatMessages();
      });
    };

    const isOwnMutation = (node) =>
      node?.classList?.contains?.("kce-mod-handle") ||
      node?.classList?.contains?.("kce-pause-banner") ||
      node?.classList?.contains?.("kce-swipe-bg");

    const isEmoteExtensionNode = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      // Pouze IMG elementy z CDN 7TV/BTTV/FFZ nebo elementy s 7TV třídou přímo na sobě
      // NEPOUÍVÁME node.closest – bylo příliš agresivní: pokud 7TV obalí celý chat
      // do [data-seventv] kontejneru, každá nová zpráva by vypadala jako emote node
      // a mutation observer by nikdy nezavolal scheduleTag → handle by se načítaly
      // jen ze 5s intervalu místo okamžitě.
      if (node.tagName === "IMG") {
        const src = node.src || "";
        if (/cdn\.7tv\.app|7tv\.|betterttv|frankerfacez/i.test(src)) return true;
      }
      const cls = typeof node.className === "string" ? node.className : "";
      if (/seventv|7tv|bttv|ffz/i.test(cls)) return true;
      return false;
    };

    const observer = new MutationObserver((mutations) => {
      let dominated = true;
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "class" &&
            mutation.target?.className?.includes?.("kce-")) continue;

        const added = mutation.addedNodes;
        if (added) {
          for (let i = 0; i < added.length; i++) {
            const node = added[i];
            if (node?.nodeType !== Node.ELEMENT_NODE) continue;
            if (isOwnMutation(node) || isEmoteExtensionNode(node)) continue;
            dominated = false;
            if (node.dataset?.chatEntry) addEnhancementClass(node, "message");
            if (node.querySelectorAll) {
              node.querySelectorAll("[data-chat-entry]").forEach((el) => addEnhancementClass(el, "message"));
            }
            if (node.shadowRoot) injectCssIntoRoot(node.shadowRoot);
          }
        }
      }
      if (!dominated) scheduleTag();
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: false });

    const delays = [100, 500, 1000, 2000, 5000, 10000];
    delays.forEach((ms) => setTimeout(tagChatMessages, ms));
  }

  function querySelectorDeep(root, selector) {
    const el = root.querySelector(selector);
    if (el) return el;
    try {
      for (const node of root.querySelectorAll("*")) {
        if (node.shadowRoot) {
          const found = querySelectorDeep(node.shadowRoot, selector);
          if (found) return found;
        }
      }
    } catch (_) {}
    return null;
  }

  function findElementsByText(root, text) {
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const t = (node.textContent || "").trim();
        if (t.includes(text)) out.push(node);
        try {
          if (node.shadowRoot) {
            for (const c of node.shadowRoot.childNodes || []) walk(c);
          }
          for (const c of node.children || node.childNodes || []) walk(c);
        } catch (_) {}
      }
    };
    walk(root);
    return out;
  }

  function getAllScrollParents(el) {
    const list = [];
    let current = el;
    while (current) {
      const parent = current.parentElement;
      let next = parent;
      if (!parent && current.getRootNode?.()?.constructor?.name === "ShadowRoot") {
        next = current.getRootNode().host;
      }
      if (!next) break;
      current = next;
      const style = getComputedStyle(current);
      const oy = style.overflowY;
      const ox = style.overflowX;
      if (oy === "auto" || oy === "scroll" || oy === "overlay" || ox === "auto" || ox === "scroll" || ox === "overlay") {
        list.push(current);
      }
    }
    return list;
  }

  function findAllScrollContainers(root) {
    const found = [];
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        try {
          const style = getComputedStyle(node);
          const oy = style.overflowY;
          if ((oy === "auto" || oy === "scroll" || oy === "overlay") && node.scrollHeight > node.clientHeight) {
            found.push(node);
          }
        } catch (_) {}
      }
      if (node.shadowRoot) {
        for (const c of node.shadowRoot.childNodes || []) visit(c);
      }
      for (const c of node.children || node.childNodes || []) visit(c);
    };
    visit(root);
    return found;
  }

  function findScrollableInChatroom(root) {
    const found = [];
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE && node.scrollHeight > node.clientHeight) {
        found.push(node);
      }
      if (node.shadowRoot) for (const c of node.shadowRoot.childNodes || []) visit(c);
      for (const c of node.children || node.childNodes || []) visit(c);
    };
    visit(root);
    return found;
  }

  function getPrimaryScrollContainer(chatEntry) {
    const scrollParents = chatEntry ? getAllScrollParents(chatEntry) : [];
    const firstScrollable = scrollParents.find((el) => el.scrollHeight > el.clientHeight);
    if (firstScrollable) return firstScrollable;
    const chatroom = querySelectorDeep(document.body, "[class*='chatroom']") || document.querySelector("[class*='chatroom']");
    if (chatroom) {
      const withOverflow = findAllScrollContainers(chatroom);
      if (withOverflow.length) return withOverflow[0];
    }
    const selectorFallback = querySelectorDeep(document.body, "[class*='chat'][class*='scroll']") || document.querySelector("[class*='chat'][class*='scroll'], [class*='chatroom'] [class*='scroll']");
    if (selectorFallback && selectorFallback.scrollHeight > selectorFallback.clientHeight) return selectorFallback;
    if (chatroom) {
      const scrollable = findScrollableInChatroom(chatroom).filter((el) => el.clientHeight > 150);
      if (scrollable.length) return scrollable[0];
    }
    const allScroll = findAllScrollContainers(document.body);
    return allScroll.find((el) => (el.className || "").includes("chat")) || allScroll[0];
  }

  function setupPauseOnHover(settings) {
    if (!settings.pauseChatOnHover) return;

    const pauseSetupDone = new WeakSet();

    const run = () => {
      // findChatroomEl() je zakotvena v "Send a message" inputu – nikdy nevrátí
      // Stream Videos, Clips ani Following sekci jako chatroom
      const chatroom = findChatroomEl();
      if (!chatroom) return;

      const chatEntry = querySelectorDeep(chatroom, "[data-chat-entry]") || chatroom.querySelector("[data-chat-entry]");
      // Scroll parenty omezíme výhradně na kontejnery UVNITŘ chatroom
      const scrollParents = chatEntry
        ? getAllScrollParents(chatEntry).filter((el) => chatroom.contains(el) && el.scrollHeight > el.clientHeight)
        : [];
      const chatroomScroll = findAllScrollContainers(chatroom);
      const byId = document.getElementById("chatroom-messages") || querySelectorDeep(chatroom, "#chatroom-messages");
      const primaryScroll = scrollParents[0] || chatroomScroll[0] || (() => {
        const sc = getPrimaryScrollContainer(chatEntry);
        return (sc && chatroom.contains(sc)) ? sc : null;
      })();
      let allScrollContainers = scrollParents.length ? scrollParents : (chatroomScroll.length ? chatroomScroll : (primaryScroll ? [primaryScroll] : []));
      if (byId && byId.scrollHeight > byId.clientHeight && !allScrollContainers.includes(byId)) {
        allScrollContainers = [byId, ...allScrollContainers];
      }
      // Finální ochrana: pouze kontejnery uvnitř chatroom
      allScrollContainers = allScrollContainers.filter((sc) => chatroom.contains(sc) || sc === chatroom);
      if (!allScrollContainers.length) return;
      if (pauseSetupDone.has(allScrollContainers[0])) return;
      pauseSetupDone.add(allScrollContainers[0]);

      let paused = false;
      const pinnedMap = new Map();
      const restores = [];
      let scrollIntoViewRestore = null;
      const hiddenKickNotifications = new Set();
      let kickBannerHideInterval = null;
      const KICK_PAUSE_TEXT = "Chat paused for scrolling";
      const KICK_PAUSE_TEXT_ALT = "paused for scrolling";

      const primaryScrollContainer = allScrollContainers[0];

      // Banner je v document.body jako position:fixed – NEZASAHUJE do scrollHeight scroll
      // kontejneru. Předchozí approach (position:sticky uvnitř kontejneru) způsoboval
      // skok o ~35px při každém show/hide, protože display:none→block měnilo scrollHeight.
      const existingBanner = document.querySelector(".kce-pause-banner");
      if (existingBanner) existingBanner.remove();
      const banner = document.createElement("div");
      banner.className = "kce-pause-banner";
      banner.textContent = "Chat pozastaven";
      banner.style.cssText =
        "display:none;position:fixed;z-index:2147483647;pointer-events:none;" +
        "padding:6px 12px;font-size:12px;color:#d0d0d8;background:rgba(20,22,25,0.93);" +
        "border-bottom:1px solid rgba(255,255,255,0.10);text-align:center;" +
        "box-shadow:0 2px 8px rgba(0,0,0,0.35);transition:opacity 0.15s;";
      document.body.appendChild(banner);

      const showBanner = () => {
        const rect = primaryScrollContainer.getBoundingClientRect();
        banner.style.top = rect.top + "px";
        banner.style.left = rect.left + "px";
        banner.style.width = rect.width + "px";
        banner.style.display = "block";
      };
      const hideBanner = () => { banner.style.display = "none"; };

      function applyScrollTopLock(el) {
        let proto = el;
        let desc;
        while (proto) {
          desc = Object.getOwnPropertyDescriptor(proto, "scrollTop");
          if (desc) break;
          proto = Object.getPrototypeOf(proto);
        }
        if (!desc?.set) return;
        const originalDesc = desc;
        const pinned = () => pinnedMap.get(el) ?? 0;
        try {
          Object.defineProperty(el, "scrollTop", {
            get: desc.get,
            set(v) {
              desc.set.call(this, pinned());
            },
            configurable: true,
            enumerable: desc.enumerable,
          });
        } catch (_) { return; }
        restores.push(() => {
          try { Object.defineProperty(el, "scrollTop", originalDesc); } catch (_) {}
        });
      }

      function applyScrollMethodsLock(el) {
        const origScrollTo = Element.prototype.scrollTo;
        const origScrollBy = Element.prototype.scrollBy;
        const origScroll = Element.prototype.scroll;
        const forcePinned = () => origScrollTo.call(el, { top: pinnedMap.get(el) ?? 0, left: 0, behavior: "auto" });
        el.scrollTo = function (...args) {
          if (paused) return forcePinned();
          return origScrollTo.apply(this, args);
        };
        el.scroll = function (...args) {
          if (paused) return forcePinned();
          return (origScroll || origScrollTo).apply(this, args);
        };
        el.scrollBy = function (...args) {
          if (paused) return forcePinned();
          return origScrollBy.apply(this, args);
        };
        restores.push(() => {
          el.scrollTo = origScrollTo;
          el.scroll = origScroll;
          el.scrollBy = origScrollBy;
        });
      }

      function applyAllLocks() {
        allScrollContainers.forEach((el) => {
          applyScrollTopLock(el);      // blokuje JS el.scrollTop = X (Kick auto-scroll)
          applyScrollMethodsLock(el);  // blokuje scrollTo/scrollBy/scroll metody
          // overflow-y:hidden NENASTAVUJEME – zablokoval by i manuální scroll kolečkem.
          // Nativní browser scroll (wheel) prochází přes interní engine, obchází JS setter,
          // proto funguje i s aktivním applyScrollTopLock.
        });
      }

      function removeAllLocks() {
        restores.forEach((fn) => { try { fn(); } catch (_) {} });
        restores.length = 0;
        if (scrollIntoViewRestore) scrollIntoViewRestore();
        scrollIntoViewRestore = null;
      }

      // Rozlišujeme uživatelský scroll (wheel) od programatického (Kick auto-scroll).
      // Nativní wheel scroll obchází JS setter – prochází přímo přes browser engine.
      // Kickův programatický scroll jde přes setter (blokován) nebo scrollTo/scrollBy (blokováno).
      // Jako záloha enforceScroll: pokud setter selhal a Kick přece jen posunul scrollTop,
      // enforceScroll to opraví do jednoho snímku – ale POUZE pro pohyb DOLŮ (nové zprávy).
      // Pohyb NAHORU (uživatel čte starší zprávy) se AKCEPTUJE a pinnedMap se aktualizuje.
      let userScrollActive = false;
      let userScrollTimer = null;
      allScrollContainers.forEach((el) => {
        el.addEventListener("wheel", () => {
          // Wheel event = uživatel manuálně scrolluje
          userScrollActive = true;
          clearTimeout(userScrollTimer);
          userScrollTimer = setTimeout(() => { userScrollActive = false; }, 400);
        }, { passive: true });
        el.addEventListener("scroll", () => {
          if (!paused) return;
          if (userScrollActive) {
            // Uživatel scrolluje kolečkem → akceptuj novou pozici jako nový pin
            pinnedMap.set(el, el.scrollTop);
          }
          // Programatický scroll (Kick auto-scroll) → pinnedMap se NEzmění,
          // enforceScroll to do jednoho snímku opraví zpět na pin
        }, { passive: true });
      });

      let rafId = null;
      const enforceScroll = () => {
        if (!paused) return;
        try {
          allScrollContainers.forEach((el) => {
            if (!el.isConnected) return;
            const pin = pinnedMap.get(el);
            if (pin === undefined) return;
            const current = el.scrollTop;
            // Oprav jakoukoliv odchylku od pinu, pokud uživatel právě nescrolluje
            // (wheel event označuje aktivní uživatelský scroll a pin se průběžně aktualizuje)
            if (current !== pin && !userScrollActive) {
              el.scrollTop = pin;
            }
          });
        } catch (_) {}
        rafId = requestAnimationFrame(enforceScroll);
      };

      function hideKickPauseBanner() {
        findKickPauseBannerElements().forEach((el) => {
          const parent = el.parentElement;
          const useParent = parent?.nodeType === Node.ELEMENT_NODE &&
            parent !== document.body &&
            parent !== document.documentElement &&
            parent.offsetHeight > 0 &&
            parent.offsetHeight < 120 &&
            parent.offsetWidth < 600;
          const toHide = useParent ? parent : el;
          if (!toHide.isConnected || hiddenKickNotifications.has(toHide)) return;
          toHide.dataset.kceOriginalDisplay = toHide.style.display || "";
          toHide.style.setProperty("display", "none", "important");
          hiddenKickNotifications.add(toHide);
        });
      }

      function unhideKickPauseBanner() {
        hiddenKickNotifications.forEach((el) => {
          if (el.isConnected) {
            el.style.removeProperty("display");
            delete el.dataset.kceOriginalDisplay;
          }
        });
        hiddenKickNotifications.clear();
      }

      function findKickPauseBannerElements() {
        const found = [
          ...findElementsByText(document.body, KICK_PAUSE_TEXT),
          ...findElementsByText(document.body, KICK_PAUSE_TEXT_ALT),
        ];
        return found.filter((el) => !found.some((other) => other !== el && el.contains(other)));
      }

      function tryResumeKickChat() {
        try {
          allScrollContainers.forEach((sc) => {
            sc.scrollTop = sc.scrollHeight;
          });
          requestAnimationFrame(() => {
            allScrollContainers.forEach((sc) => {
              sc.dispatchEvent(new Event("scroll", { bubbles: true }));
            });
          });
          const kickBannerElements = findKickPauseBannerElements();
          for (const el of kickBannerElements) {
            if (!el.isConnected) continue;
            const clickTarget = el.closest?.("button, a, [role='button']") || el.parentElement || el;
            try {
              clickTarget.click();
              const opts = { bubbles: true, cancelable: true, view: window };
              clickTarget.dispatchEvent(new MouseEvent("mousedown", opts));
              clickTarget.dispatchEvent(new MouseEvent("mouseup", opts));
              clickTarget.dispatchEvent(new MouseEvent("click", opts));
              break;
            } catch (_) {}
          }
          if (kickBannerElements.length > 0) return;
          const resumeTexts = ["Jump to live", "Go to live", "Resume", "View new messages", "New messages"];
          for (const text of resumeTexts) {
            const btns = findElementsByText(document.body, text);
            const clickable = btns.find((el) => el.closest?.("button, a, [role='button']"));
            if (clickable) {
              const btn = clickable.closest("button, a, [role='button']") || clickable;
              if (btn.click) btn.click();
              break;
            }
          }
        } catch (_) {}
      }

      const handleMouseLeave = (e) => {
        if (e.relatedTarget && allScrollContainers.some((sc) => sc.contains(e.relatedTarget))) return;
        paused = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (kickBannerHideInterval) {
          clearInterval(kickBannerHideInterval);
          kickBannerHideInterval = null;
        }
        removeAllLocks();
        unhideKickPauseBanner();
        hideBanner();
        tryResumeKickChat();
      };

      function applyScrollIntoViewLock() {
        if (scrollIntoViewRestore) return;
        const orig = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (...args) {
          if (paused && allScrollContainers.some((sc) => sc.contains(this))) return;
          return orig.apply(this, args);
        };
        scrollIntoViewRestore = () => {
          Element.prototype.scrollIntoView = orig;
          scrollIntoViewRestore = null;
        };
      }

      const handleMouseEnter = () => {
        if (document.documentElement.dataset.kcePauseChatOnHover !== "1") return;
        paused = true;
        // pinnedMap PŘED zámky – setter musí mít správnou hodnotu od první chvíle
        allScrollContainers.forEach((sc) => {
          const maxScroll = sc.scrollHeight - sc.clientHeight;
          pinnedMap.set(sc, (maxScroll - sc.scrollTop < 80) ? maxScroll : sc.scrollTop);
        });
        applyScrollIntoViewLock();
        applyAllLocks();
        // Okamžitě zruš případné probíhající smooth-scroll animace Kicku
        // (setter sám o sobě nestačí – animace mohla proběhnout ještě jeden snímek)
        allScrollContainers.forEach((sc) => {
          const pin = pinnedMap.get(sc);
          if (pin !== undefined) {
            try {
              let proto = sc, d;
              while (proto) { d = Object.getOwnPropertyDescriptor(proto, "scrollTop"); if (d?.set) break; proto = Object.getPrototypeOf(proto); }
              if (d?.set) d.set.call(sc, pin);
            } catch (_) {}
          }
        });
        showBanner();
        hideKickPauseBanner();
        if (!kickBannerHideInterval) {
          kickBannerHideInterval = setInterval(hideKickPauseBanner, 400);
        }
        rafId = requestAnimationFrame(enforceScroll);
      };

      allScrollContainers.forEach((sc) => {
        sc.addEventListener("mouseenter", handleMouseEnter);
        sc.addEventListener("mouseleave", handleMouseLeave);
      });
    };

    run();
    [500, 1500, 3500, 7000, 12000, 20000].forEach((ms) => setTimeout(run, ms));
    setInterval(run, 8000);
  }

  /**
   * Scrollne chat dolů na nejnovější zprávy.
   * Resize event se NEZASÍLÁ opakovaně – způsoboval re-render virtualizéru Kicku,
   * který mazal 7TV emoty injektované do zpráv. Jeden resize se posílá jen při init.
   */
  function nudgeVirtualizerAndScroll() {
    setTimeout(() => {
      const chatEntry = querySelectorDeep(document.body, "[data-chat-entry]") || document.querySelector("[data-chat-entry]");
      const sc = chatEntry ? getPrimaryScrollContainer(chatEntry) : null;
      if (sc) {
        sc.scrollTop = sc.scrollHeight;
        requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; });
      }
    }, 150);
  }

  /** Diagnostika – jednou vypíše do konzole strukturu jedné zprávy chatu */
  let diagDone = false;
  function logChatDiagnostic() {
    if (diagDone) return;
    const entry = document.querySelector("div[data-index]") || document.querySelector("[data-chat-entry]");
    if (!entry) return;
    diagDone = true;
    const info = { tag: entry.tagName, classes: entry.className, attrs: {} };
    for (const a of entry.attributes) info.attrs[a.name] = a.value;
    const cs = getComputedStyle(entry);
    info.computed = {
      height: cs.height, minHeight: cs.minHeight, maxHeight: cs.maxHeight,
      paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
      marginTop: cs.marginTop, marginBottom: cs.marginBottom,
      lineHeight: cs.lineHeight, display: cs.display,
      position: cs.position, top: cs.top, transform: cs.transform,
    };
    info.offsetHeight = entry.offsetHeight;
    info.clientHeight = entry.clientHeight;
    info.inlineStyle = entry.style.cssText;
    const parent = entry.parentElement;
    if (parent) {
      const pcs = getComputedStyle(parent);
      info.parent = {
        tag: parent.tagName, classes: parent.className,
        display: pcs.display, gap: pcs.gap, rowGap: pcs.rowGap,
        position: pcs.position, height: pcs.height,
        inlineStyle: parent.style.cssText,
      };
    }
    const child = entry.firstElementChild;
    if (child) {
      const ccs = getComputedStyle(child);
      info.firstChild = {
        tag: child.tagName, classes: child.className,
        paddingTop: ccs.paddingTop, paddingBottom: ccs.paddingBottom,
        marginTop: ccs.marginTop, marginBottom: ccs.marginBottom,
        height: ccs.height, display: ccs.display,
        inlineStyle: child.style.cssText,
      };
    }
    console.log("[KCE] Chat message diagnostic:", JSON.stringify(info, null, 2));
  }

  const CHAT_WIDTH_KEY = "kickChatEnhancerChatWidth";

  function findChatPanel() {
    const selectors = [
      "aside[class*='chat']",
      "div[class*='chat-sidebar']",
      "div[class*='chatroom-container']",
      "#chatroom",
      "[id*='chatroom']",
      "aside",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetHeight > 200) return el;
    }
    const chatroom = document.querySelector("[class*='chatroom']");
    if (chatroom) {
      let panel = chatroom;
      while (panel.parentElement && panel.parentElement !== document.body) {
        const sibling = panel.parentElement.querySelector("video, [class*='video'], [class*='player'], [class*='stream']");
        if (sibling && sibling !== panel) return panel;
        panel = panel.parentElement;
      }
      return chatroom.closest("aside") || chatroom.parentElement || chatroom;
    }
    return null;
  }

  async function setupChatResize() {
    const existing = document.querySelector(".kce-chat-resize-handle");
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    const trySetup = async () => {
      const chatPanel = findChatPanel();
      if (!chatPanel) return false;

      const parent = chatPanel.parentElement;
      if (!parent) return false;

      const result = await chrome.storage.sync.get(CHAT_WIDTH_KEY);
      const savedWidth = result[CHAT_WIDTH_KEY];
      if (savedWidth) {
        chatPanel.style.width = savedWidth + "px";
        chatPanel.style.minWidth = savedWidth + "px";
        chatPanel.style.maxWidth = savedWidth + "px";
        chatPanel.style.flexShrink = "0";
      }

      const handle = document.createElement("div");
      handle.className = "kce-chat-resize-handle";
      chatPanel.insertAdjacentElement("beforebegin", handle);

      let dragging = false;
      let startX = 0;
      let startWidth = 0;
      let saveTimeout = null;

      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startWidth = chatPanel.offsetWidth;
        handle.classList.add("kce-active");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      });

      window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const delta = startX - e.clientX;
        const newWidth = Math.max(280, Math.min(startWidth + delta, window.innerWidth * 0.6));
        chatPanel.style.width = newWidth + "px";
        chatPanel.style.minWidth = newWidth + "px";
        chatPanel.style.maxWidth = newWidth + "px";
        chatPanel.style.flexShrink = "0";
      });

      window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove("kce-active");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        const finalWidth = chatPanel.offsetWidth;
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          chrome.storage.sync.set({ [CHAT_WIDTH_KEY]: finalWidth });
        }, 300);
      });

      console.log("[KCE] Chat resize handle připojen (sibling):", chatPanel.tagName, chatPanel.className?.slice(0, 60));
      return true;
    };

    if (await trySetup()) return;
    const delays = [500, 1500, 3000, 6000, 10000];
    for (const ms of delays) {
      await new Promise((r) => setTimeout(r, ms));
      if (await trySetup()) return;
    }
  }

  async function init() {
    injectIntoAllShadowRoots();
    const settings = await getSettings();
    applyEnhancements(settings);
    tagChatMessages();
    observeChat();
    setupPauseOnHover(settings);
    setupModDragHandle(settings);
    setupChatResize();
    setInterval(() => {
      const h = document.querySelector(".kce-chat-resize-handle");
      if (!h || !h.isConnected) setupChatResize();
    }, 8000);
    // Jeden resize event pro virtualizer (CSS změnilo výšky řádků) – jen jednou
    setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
    // Scroll na nejnovější zprávy v různých časech (bez resize – nezničíme 7TV emoty)
    [300, 800, 1500, 3000, 6000].forEach((ms) => setTimeout(() => {
      nudgeVirtualizerAndScroll();
      logChatDiagnostic();
    }, ms));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      applyEnhancements(changes[STORAGE_KEY].newValue || defaultSettings);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 100));
  } else {
    setTimeout(init, 100);
  }
})();
