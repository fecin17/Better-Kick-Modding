/**
 * Kick Chat Enhancer - Content Script
 * Vylepšuje vzhled chatu na Kick.com podle Twitch inspirace
 * Verze 1.1: Podpora Shadow DOM a rozšířené selektory
 */

(function () {
  "use strict";

  const STORAGE_KEY = "kickChatEnhancerSettings";

  // Debug log helper – v produkci tichý; zapni v konzoli přes `localStorage.kceDebug = '1'` a reload
  const KCE_DEBUG = (() => {
    try { return localStorage.getItem("kceDebug") === "1"; } catch { return false; }
  })();
  const kceLog = KCE_DEBUG ? console.log.bind(console) : () => {};

  const defaultSettings = {
    messageSpacing: true,
    visualSeparation: true,
    improveReplyStyling: true,
    emoteSize: true,
    usernameHighlight: true,
    pauseChatOnHover: true,
    modDragHandle: true,
    chatFontSize: 13,
    messageSpacingPx: 2,
    mentionHighlight: true,
    mentionNotifications: false,
    mentionAliases: "",
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

  /** Označí odkazy na URL (http/https) ve zprávě třídou pro zvýraznění v CSS. */
  function tagLinkHighlights(entryEl) {
    if (!entryEl || !entryEl.querySelectorAll) return;
    entryEl.querySelectorAll('a[href^="http"]').forEach((a) => {
      if (!a.classList.contains("kce-link-highlight")) a.classList.add("kce-link-highlight");
    });
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
    html.dataset.kceMentionHighlight = settings.mentionHighlight ? "1" : "0";
    const fontSize = settings.chatFontSize || 13;
    html.style.setProperty("--kce-font-size", fontSize + "px");
    const msgSpacing = settings.messageSpacingPx ?? 2;
    html.style.setProperty("--kce-msg-spacing", msgSpacing + "px");
    // Mention nastavení do globálních flagů (mention regex se sestavuje samostatně)
    kceMentionsEnabled = !!settings.mentionHighlight;
    kceMentionNotifications = !!settings.mentionNotifications;
    kceMentionAliases = (settings.mentionAliases || "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    rebuildMentionRegex();
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
  // Substringy v placeholderu chat inputu – pokrýváme EN i CZ lokalizaci Kicku.
  // ("zpráv" pokrývá "Odeslat zprávu", "Napsat zprávu"; "odesl" je dodatečná pojistka.)
  const CHAT_INPUT_PLACEHOLDER_HINTS = ["message", "send", "chat", "zpráv", "odesl", "napsat"];

  function findChatroomEl() {
    // 1. Kotva přes "Send a message" input – nejspolehlivější
    const inputs = document.querySelectorAll("input[placeholder], textarea[placeholder]");
    for (const input of inputs) {
      const ph = (input.getAttribute("placeholder") || "").toLowerCase();
      if (!CHAT_INPUT_PLACEHOLDER_HINTS.some((hint) => ph.includes(hint))) continue;
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

    // 1. data-chat-entry + .chat-entry – primární selektor pro řádek zprávy.
    // Kick používá v různých verzích buď `data-chat-entry` atribut, nebo `.chat-entry` třídu;
    // občas oba současně ve vnořené struktuře (např. `.chat-entry > [data-chat-entry]`).
    // Deduplikujeme – ponecháme pouze nejvyšší (outer) element, aby se padding ani mod-handle
    // nepřidaly dvakrát na rodiče i potomka.
    const primaryAll = querySelectorAllDeep(effectiveBase, "[data-chat-entry], .chat-entry");
    const primaryOutermost = primaryAll.filter(
      (el) => !primaryAll.some((other) => other !== el && other.contains(el))
    );
    // Inner duplikáty z dřívějších běhů: odstraň .kce-message + .kce-mod-handle u elementů,
    // které jsou uvnitř outermost zprávy (= byly označené předchozí verzí kódu).
    primaryAll.forEach((el) => {
      if (primaryOutermost.includes(el)) return;
      el.classList.remove("kce-message");
      el.querySelectorAll(":scope > .kce-mod-handle").forEach((h) => h.remove());
    });
    primaryOutermost.forEach((el) => {
      addEnhancementClass(el, "message");
      ensureModHandle(el);
      tagLinkHighlights(el);
    });

    // 2. Variantní třídy (chatEntry camelCase, message-row) – stejná dedup logika
    const variantAll = querySelectorAllDeep(effectiveBase, "[class*='chatEntry'], [class*='message-row']");
    const variantOutermost = variantAll.filter(
      (el) => !variantAll.some((other) => other !== el && other.contains(el)) &&
              !primaryOutermost.some((p) => p.contains(el))
    );
    variantOutermost.forEach((el) => {
      addEnhancementClass(el, "message");
      ensureModHandle(el);
      tagLinkHighlights(el);
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
          tagLinkHighlights(el);
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
        tagLinkHighlights(el);
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
          tagLinkHighlights(parent);
        }
      }
    });

    // 5. Široký fallback – jen pokud sekce 1-4 nenašly NIC.
    // Tento selektor projde tisíce uzlů, takže ho používáme až jako poslední záchranu
    // (např. když Kick nasadí úplně novou DOM strukturu bez data-chat-entry/.chat-entry).
    const alreadyTagged = querySelectorAllDeep(searchRootForIndex, ".kce-message").length;
    if (alreadyTagged === 0 && seen.size === 0) {
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
            tagLinkHighlights(el);
          }
        }
      });
    }
  }

  function ensureModHandle(entryEl) {
    if (document.documentElement.dataset.kceModDrag !== "1") return;
    // Mod handle se zobrazuje JEN moderátorům aktuálního kanálu.
    // Dokud check není hotový, neukazujeme handle (po dokončení tagChatMessages doběhne).
    if (kceModCheckPending || !kceUserIsModerator) return;
    if (entryEl.querySelector(".kce-mod-handle")) return;
    // Pojistka: nevkládat handle pokud je entry uvnitř jiné označené zprávy (vnořený duplikát)
    if (entryEl.parentElement?.closest?.(".kce-message")) return;
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

  // WeakMap cache – framework state se v rámci jedné zprávy nemění,
  // ale getMessageData se může volat opakovaně (drag handle re-tag, retry akce).
  const _frameworkCache = new WeakMap();
  function extractFrameworkData(el) {
    if (_frameworkCache.has(el)) return _frameworkCache.get(el);
    const result = _extractFrameworkDataImpl(el);
    if (result) _frameworkCache.set(el, result);
    return result;
  }
  function _extractFrameworkDataImpl(el) {
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

    if (KCE_DEBUG && (!messageId || !username)) {
      // Diagnostika, pokud se nepodařilo vytáhnout message ID / username.
      // V DevTools si pak můžeš zprávu inspectovat manuálně přes selektor.
      kceLog("[KCE] DIAG missing data:", {
        tag: entryEl.tagName,
        classes: entryEl.className?.slice(0, 100),
        innerHTML: entryEl.innerHTML?.slice(0, 200),
      });
    }
    kceLog("[KCE] Message data:", { channel, messageId, username, fwFound: !!fw });
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
    toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9000;" +
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
    overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9300;" +
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
    // Mod handle: MutationObserver v observeChat() volá tagChatMessages() při každé změně
    // chatu, takže nepotřebujeme samostatný 1500ms interval. Zachováváme jen safety-net
    // tag každých 10s pro případ, že by Kick re-renderoval bez MutationObserver triggeru.
    modDragIntervalId = setInterval(() => {
      if (document.documentElement.dataset.kceModDrag !== "1") {
        clearInterval(modDragIntervalId);
        modDragIntervalId = null;
        return;
      }
      tagChatMessages();
    }, 10000);

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
    kceLog("[KCE] API:", action, "ch:", channel, "user:", slug, "xsrf:", xsrf ? "yes" : "NO!");

    async function tryFetch(url, opts) {
      const fetchOpts = { credentials: "include", ...opts };
      const r = await pageContextFetch(url, fetchOpts);
      kceLog("[KCE]", r.ok ? "OK" : "FAIL", r.status, url.replace(base, ""), r.ok ? "" : r.text?.slice(0, 150));
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
          kceLog("[KCE] Delete: lookup přes WebSocket store pro:", slug);
          const lookup = await lookupMessageId(slug, msgText);
          kceLog("[KCE] Delete: lookup result:", lookup);
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
    if (kceModCheckPending) {
      showModToast("Čekám na ověření moderátorského statusu…", false);
      return;
    }
    if (!kceUserIsModerator) {
      showModToast("Tato akce je dostupná jen moderátorům kanálu", false);
      return;
    }
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

  // =====================================================
  //  MODERATION ASSIST  v2
  // =====================================================

  const MA_KEY = "kickChatEnhancerModAssist";
  const MA_DEFAULT_SETTINGS = {
    enabled: true,
    checkModOnly: false,   // výchozí: funguje všude; uživatel může zapnout "jen na svých kanálech"
    disabledUntil: null,
    triggerConsecutive: 3,
    triggerWindow: 4,
    windowSeconds: 60,
    similarityThreshold: 0.65,
    autoCloseSecs: 15,
  };

  let maSettings = { ...MA_DEFAULT_SETTINGS };
  // BEZPEČNOSTNÍ FLAG: všechny moderátorské akce (drag swipe, MA tlačítka) jsou
  // dostupné jen pokud potvrdíme, že uživatel je opravdu mod aktuálního kanálu.
  // Dokud API neodpoví, jsme v "pending" stavu a akce blokujeme.
  let kceUserIsModerator = false;
  let kceModCheckPending = true;
  let maIsMod = false;   // legacy alias – stále používaný uvnitř MA pro zpětnou kompatibilitu
  const maModCache = new Map();
  const NON_CHANNEL_PATHS = new Set(["", "browse", "following", "categories", "subscriptions", "category", "search"]);

  // Info o slow modu aktuálního kanálu – plněno z stejného API volání jako mod check.
  // Sloužíme dvě věci: skrýt Kickovu nativní info-bublinu při hoveru a doplnit interval
  // do existujícího "Slow mode activated" banneru jako "(Xs)".
  let kceSlowModeInfo = { enabled: false, interval: 0 };

  // Mention highlight – username přihlášeného uživatele + případné aliasy
  let kceCurrentUsername = null;
  let kceMentionRegex = null;
  let kceMentionAliases = [];

  async function detectCurrentUsername() {
    if (kceCurrentUsername) return;
    // 1. Zkusíme Kick API endpoint /api/v1/user
    try {
      const r = await pageContextFetch("https://kick.com/api/v1/user", {
        credentials: "include", headers: buildApiHeaders(false)
      });
      if (r.ok) {
        const data = JSON.parse(r.text);
        const u = data?.username || data?.user?.username || data?.slug || data?.user?.slug;
        if (u && typeof u === "string") {
          kceCurrentUsername = u.toLowerCase();
          rebuildMentionRegex();
          kceLog("[KCE] detected username from API:", kceCurrentUsername);
          return;
        }
      }
    } catch (_) {}
    // 2. Fallback – z DOMu (avatar profilové menu, vrch stránky)
    try {
      const avatarLink = document.querySelector(
        "header a[href^='/'][class*='avatar'], header a[href^='/'] img[alt*='avatar'], a[data-test='avatar-link']"
      );
      if (avatarLink) {
        const href = avatarLink.getAttribute("href") || avatarLink.closest("a")?.getAttribute("href");
        const match = href && href.match(/^\/([A-Za-z][\w]{1,24})\/?/);
        if (match) {
          kceCurrentUsername = match[1].toLowerCase();
          rebuildMentionRegex();
          kceLog("[KCE] detected username from DOM:", kceCurrentUsername);
        }
      }
    } catch (_) {}
  }

  function rebuildMentionRegex() {
    const names = [kceCurrentUsername, ...kceMentionAliases].filter(Boolean);
    if (!names.length) { kceMentionRegex = null; return; }
    const escaped = names.map((n) => n.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
    // @nick s nebo bez `@`, word boundary kolem, case-insensitive
    kceMentionRegex = new RegExp(`(?:^|[\\s@])@?(${escaped.join("|")})(?=[\\s.,!?:;)\\]'"]|$)`, "i");
  }

  function isMentionInText(text) {
    if (!kceMentionRegex || !text) return false;
    return kceMentionRegex.test(text);
  }

  // Settings flag pro mention featuru – nastaven v applyEnhancements
  let kceMentionsEnabled = true;
  let kceMentionNotifications = false;

  function handleMentionInMessage(fromUsername, content) {
    if (!kceMentionsEnabled || !kceMentionRegex || !isMentionInText(content)) return;
    // Zpráva ode mě samotného nepočítá jako mention sebe sama
    if (fromUsername && fromUsername.toLowerCase() === kceCurrentUsername) return;

    kceLog("[KCE] mention from", fromUsername, "→", content.slice(0, 80));

    // Najdi v DOMu zprávu odpovídající content (WebSocket je rychlejší než DOM render)
    const findAndTag = (attempt = 0) => {
      const entries = querySelectorAllDeep(document.body, "[data-chat-entry], .chat-entry, .kce-message");
      const needle = content.toLowerCase().slice(0, 40);
      // Procházíme od konce – nejnovější zpráva má největší šanci být to ta
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry.dataset.kceMentionMatched) continue;
        const entryText = (entry.textContent || "").toLowerCase();
        if (entryText.includes(needle)) {
          entry.dataset.kceMentionMatched = "1";
          entry.classList.add("kce-mention");
          entry.classList.add("kce-mention-blink");
          setTimeout(() => entry.classList.remove("kce-mention-blink"), 1500);
          return true;
        }
      }
      // DOM ještě možná nezrenderoval – zkus znovu po krátkém čase
      if (attempt < 5) setTimeout(() => findAndTag(attempt + 1), 200);
      return false;
    };
    findAndTag();

    // Desktop notifikace – jen pokud tab/okno není aktivní (jinak by to bylo otravné)
    if (kceMentionNotifications && document.visibilityState !== "visible") {
      showMentionNotification(fromUsername, content);
    }
  }

  function showMentionNotification(from, text) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try {
      const n = new Notification(`${from} tě zmínil v chatu`, {
        body: text.slice(0, 140),
        icon: chrome.runtime.getURL("icons/icon48.png"),
        tag: "kce-mention",
        silent: false,
      });
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(() => n.close(), 8000);
    } catch (_) {}
  }

  async function requestNotificationPermission() {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const result = await Notification.requestPermission();
      return result === "granted";
    } catch (_) {
      return false;
    }
  }

  function extractSlowModeInfo(data) {
    // Slow mode info bývá pod různými klíči podle verze API – prohledáme nejčastější.
    const candidates = [
      data?.chatroom?.slow_mode,
      data?.chatroom?.slowmode,
      data?.slow_mode,
      data?.slowmode,
    ];
    for (const sm of candidates) {
      if (!sm || typeof sm !== "object") continue;
      const enabled = !!(sm.enabled ?? sm.is_enabled ?? sm.active);
      const interval = Number(sm.message_interval ?? sm.interval ?? sm.seconds ?? sm.duration ?? 0);
      if (enabled || interval) return { enabled, interval };
    }
    // Některé API formáty vrací jen boolean + samostatný interval field
    if (data?.chatroom?.slow_mode_enabled !== undefined) {
      return {
        enabled: !!data.chatroom.slow_mode_enabled,
        interval: Number(data.chatroom.slow_mode_interval || data.chatroom.message_interval || 0),
      };
    }
    return { enabled: false, interval: 0 };
  }
  const maUserHistory = new Map();        // username -> [{text, normalized, ts}]
  const maAlertCooldown = new Map();      // username -> ts posledního alertu
  const maUserLastTimeout = new Map();    // username -> sekundy posledního TO
  const maProcessedEntries = new WeakSet();

  // TTL pro user-historii – starší zprávy než 10 min nemá smysl držet (mimo windowSeconds + buffer)
  const MA_USER_HISTORY_TTL_MS = 10 * 60 * 1000;
  const MA_COOLDOWN_TTL_MS = 5 * 60 * 1000;
  const MA_MAX_TRACKED_USERS = 500;

  function maEvictStale() {
    const now = Date.now();
    // 1) vyfiltruj staré entries v každé user historii; smaž celý záznam, pokud zbylo 0
    for (const [user, list] of maUserHistory) {
      const fresh = list.filter((m) => now - m.ts <= MA_USER_HISTORY_TTL_MS);
      if (fresh.length) maUserHistory.set(user, fresh);
      else maUserHistory.delete(user);
    }
    // 2) cooldowny starší 5 min nepotřebujeme
    for (const [user, ts] of maAlertCooldown) {
      if (now - ts > MA_COOLDOWN_TTL_MS) maAlertCooldown.delete(user);
    }
    // 3) hard cap na velikost map – LRU-light (smaže nejstarší podle TS poslední zprávy)
    if (maUserHistory.size > MA_MAX_TRACKED_USERS) {
      const sorted = [...maUserHistory.entries()].sort(
        (a, b) => (a[1].at(-1)?.ts || 0) - (b[1].at(-1)?.ts || 0)
      );
      const toDrop = sorted.slice(0, maUserHistory.size - MA_MAX_TRACKED_USERS);
      for (const [user] of toDrop) {
        maUserHistory.delete(user);
        maAlertCooldown.delete(user);
        maUserLastTimeout.delete(user);
      }
    }
  }

  async function maSaveSettings(updates) {
    maSettings = { ...maSettings, ...updates };
    try { await chrome.storage.sync.set({ [MA_KEY]: maSettings }); } catch (_) {}
  }

  function maIsEnabled() {
    if (!maSettings.enabled) return false;
    // Mod akce jsou bezpodmínečně vázané na ověřený moderátorský status
    if (!kceUserIsModerator) return false;
    const du = maSettings.disabledUntil;
    if (du === null || du === undefined) return true;
    if (du === -1) return false;
    if (Date.now() < du) return false;
    // Časový vypnutí vypršel – obnovíme aktivní stav
    maSaveSettings({ disabledUntil: null });
    return true;
  }

  /**
   * Univerzální kontrola, jestli je uživatel moderátor aktuálního kanálu.
   * Nastavuje kceUserIsModerator + maIsMod (legacy alias).
   * Default: pokud API nevrátí žádný indikátor moderátorství → FALSE (bezpečně).
   */
  async function checkModeratorStatus() {
    kceModCheckPending = true;
    const channelMatch = window.location.pathname.match(/^\/([^/]+)/);
    const channel = channelMatch ? channelMatch[1].toLowerCase() : null;
    if (!channel || NON_CHANNEL_PATHS.has(channel)) {
      kceUserIsModerator = false;
      maIsMod = false;
      kceModCheckPending = false;
      removeAllModHandles();
      return;
    }
    if (maModCache.has(channel)) {
      kceUserIsModerator = maModCache.get(channel);
      maIsMod = kceUserIsModerator;
      kceModCheckPending = false;
      if (!kceUserIsModerator) removeAllModHandles();
      return;
    }

    let isMod = false;
    try {
      const r = await pageContextFetch(
        "https://kick.com/api/v2/channels/" + encodeURIComponent(channel),
        { credentials: "include", headers: buildApiHeaders(false) }
      );
      if (r.ok) {
        const data = JSON.parse(r.text);
        // Hledáme jakýkoli indikátor moderátorství / vyšší role.
        if (data?.is_moderator === true) isMod = true;
        else if (data?.chatroom?.is_moderator === true) isMod = true;
        else if (typeof data?.user_role === "string" && /moderator|owner|admin|broadcaster/i.test(data.user_role)) isMod = true;
        else if (Array.isArray(data?.roles) && data.roles.some((rr) => /moderator|owner|broadcaster/i.test(String(rr)))) isMod = true;
        else if (data?.user?.is_moderator === true) isMod = true;

        // Stejnou response využijeme pro extrakci slow mode info
        kceSlowModeInfo = extractSlowModeInfo(data);
        kceLog("[KCE] slow mode:", kceSlowModeInfo);
      }
    } catch (_) {}

    kceUserIsModerator = isMod;
    maIsMod = isMod;
    maModCache.set(channel, isMod);
    kceModCheckPending = false;
    kceLog("[KCE] mod check →", channel, "isMod:", isMod);
    if (!isMod) removeAllModHandles();
  }

  // Zpětná kompatibilita s původním názvem (volá se z maInit)
  const maCheckModStatus = checkModeratorStatus;

  function removeAllModHandles() {
    try {
      querySelectorAllDeep(document.body, ".kce-mod-handle").forEach((h) => h.remove());
    } catch (_) {}
  }

  // =====================================================
  //  SLOW MODE: skrýt Kickovu hover bublinu, doplnit interval do banneru
  // =====================================================

  // Regex pro text bubliny – pokrýváme EN i CZ formulace
  const SLOWMODE_TOOLTIP_RE = /(slow\s*mode|pomal[ýy]\s*re[žz]im|chat\s*delay|send.{0,20}message.{0,20}every|wait.{0,30}second|sekund.{0,30}mezi|napsat.{0,30}zpr[áa]v[uy])/i;
  const SLOWMODE_BANNER_RE = /^(slow\s*mode\s*activated|slow\s*mode|pomal[ýy]\s*re[žz]im(\s*aktivn[íi])?)$/i;

  function suppressSlowModeTooltips(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    // Common popover/tooltip selectors – Kick používá různé library wrappery
    const candidates = root.matches?.("[role='tooltip'], [class*='tooltip'], [class*='Tooltip'], [class*='popover'], [class*='Popover'], [class*='popper']")
      ? [root]
      : [];
    try {
      root.querySelectorAll?.(
        "[role='tooltip'], [class*='tooltip'], [class*='Tooltip'], [class*='popover'], [class*='Popover'], [class*='popper']"
      ).forEach((el) => candidates.push(el));
    } catch (_) {}
    for (const el of candidates) {
      if (el.dataset.kceSlowmodeHidden) continue;
      if (el.closest?.(".kce-ma-popup, .kce-ma-welcome, .kce-pause-banner")) continue;
      const text = (el.textContent || "").trim();
      if (text.length < 4 || text.length > 200) continue;
      if (SLOWMODE_TOOLTIP_RE.test(text)) {
        el.style.setProperty("display", "none", "important");
        el.dataset.kceSlowmodeHidden = "1";
        kceLog("[KCE] suppressed slowmode tooltip:", text.slice(0, 80));
      }
    }
  }

  function annotateSlowModeBanner(root) {
    if (!root) root = document.body;
    if (!kceSlowModeInfo.enabled || !kceSlowModeInfo.interval) return;
    const annotation = ` (${kceSlowModeInfo.interval}s)`;
    // Najdeme leafový element s textem matchujícím banner regex
    const walk = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.closest?.(".kce-ma-popup, .kce-ma-welcome, .kce-pause-banner")) return;
      if (node.dataset?.kceSlowmodeAnnotated) return;
      if (node.children.length === 0) {
        const text = (node.textContent || "").trim();
        if (SLOWMODE_BANNER_RE.test(text)) {
          node.textContent = text + annotation;
          node.dataset.kceSlowmodeAnnotated = "1";
          return;
        }
      }
      try {
        for (const c of node.children) walk(c);
        if (node.shadowRoot) for (const c of node.shadowRoot.children || []) walk(c);
      } catch (_) {}
    };
    walk(root);
  }

  function maNormalize(text) {
    return text
      .toLowerCase()
      .replace(/[\u{1F000}-\u{1FAFF}]/gu, " ")
      .replace(/:[a-zA-Z0-9_+\-]+:/g, " ")
      .replace(/[^a-z0-9\u00C0-\u024F\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function maSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1.0;
    const tokA = a.split(/\s+/).filter((t) => t.length > 1);
    const tokB = b.split(/\s+/).filter((t) => t.length > 1);
    if (!tokA.length || !tokB.length) {
      return Math.min(a.length, b.length) / Math.max(a.length, b.length) || 0;
    }
    const setA = new Set(tokA);
    const setB = new Set(tokB);
    let common = 0;
    for (const t of setA) if (setB.has(t)) common++;
    return common / Math.max(setA.size, setB.size);
  }

  function maExtractFromEntry(entryEl) {
    if (!entryEl) return { username: null, messageText: "" };
    let username = null;

    // 1. Username element s třídou – hledáme DEEP (7TV shadow DOM)
    const usernameEl = querySelectorDeep(entryEl,
      'a[class*="username"], a[class*="chat-entry-username"], a[data-chat-entry-user],' +
      'span[class*="username"], button[class*="username"]'
    );
    if (usernameEl) {
      const href = usernameEl.getAttribute?.("href");
      if (href) { const m = href.match(/\/([^/]+)\/?$/); if (m) username = m[1]; }
      if (!username) username = (usernameEl.textContent || "").trim().replace(/:$/, "") || null;
    }

    // 2. Libovolný profilový odkaz – deep search (prochází shadow DOM)
    if (!username) {
      const links = querySelectorAllDeep(entryEl, "a[href]");
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        if (href.startsWith("http") && !href.includes("kick.com")) continue;
        const m = href.match(/\/([A-Za-z][\w]{1,24})\/?$/);
        if (m) { username = m[1]; break; }
      }
    }

    // Sbírej čistý text rekurzivně (včetně shadow DOM), přeskočí injektované elementy
    let fullText = "";
    const SKIP_CLASSES = ["kce-mod-handle", "kce-swipe-bg", "kce-ma-popup", "kce-ma-welcome"];
    const collectText = (node) => {
      if (node.nodeType === Node.TEXT_NODE) { fullText += node.textContent; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (SKIP_CLASSES.some((c) => node.classList?.contains(c))) return;
      for (const child of node.childNodes) collectText(child);
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.childNodes) collectText(child);
      }
    };
    collectText(entryEl);
    fullText = fullText.trim();
    if (!fullText) fullText = (entryEl.textContent || "").trim();

    // Odstraň timestamp prefix: "07:37", "07:37 PM", "7:37AM" apod.
    fullText = fullText.replace(/^\d{1,2}:\d{2}\s*(?:AM|PM)?\s*/i, "").trim();

    // 3. Colon-based fallback – zkusíme každou ":" a hledáme validní username před ní
    if (!username && fullText.includes(":")) {
      let searchFrom = 0;
      while (searchFrom < fullText.length) {
        const colonIdx = fullText.indexOf(":", searchFrom);
        if (colonIdx === -1) break;
        const rawBefore = fullText.slice(0, colonIdx).trim();
        // Vezmi poslední "slovo" (po posledním whitespace/non-word)
        const candidate = rawBefore.replace(/^[\s\S]*[\s\W]/, "").replace(/^[^\w]+/, "").replace(/[^\w]+$/, "");
        if (/^[A-Za-z][\w]{1,24}$/.test(candidate)) { username = candidate; break; }
        searchFrom = colonIdx + 1;
      }
    }

    let messageText = fullText;
    if (username) {
      const idx = fullText.indexOf(username);
      if (idx >= 0) messageText = fullText.slice(idx + username.length).replace(/^[:\s]+/, "").trim();
    }
    return { username, messageText };
  }

  // Primární detekce zpráv pro Moderation Assist běží přes WebSocket bridge
  // (kce-new-chat-message event). maPeriodicScan zůstává jako záchrana 1× za 30s.
  function maPeriodicScan() {
    // Záložní scan – už primárně nepotřebný, ale necháváme kdyby bridge selhal.
    // 1× za 30s prohledáme DOM a zkontrolujeme nezpracované zprávy.
    if (!maIsEnabled()) return;
    const root = findChatroomEl() || document.body;
    const entries = querySelectorAllDeep(root, "[data-chat-entry], .chat-entry, .kce-message");
    for (const entry of entries) {
      if (maProcessedEntries.has(entry)) continue;
      const text = (entry.textContent || "").trim();
      if (text.length < 4 || !text.includes(":")) continue;
      maProcessedEntries.add(entry);
      const { username, messageText } = maExtractFromEntry(entry);
      if (username && messageText) maCheckMessage(username, messageText);
    }
  }

  function maCheckMessage(username, messageText) {
    if (!username || !messageText || messageText.length < 3) return;
    const cooldown = maAlertCooldown.get(username);
    if (cooldown && Date.now() - cooldown < 30000) return;
    const normalized = maNormalize(messageText);
    if (!normalized || normalized.length < 2) return;
    let history = maUserHistory.get(username) || [];
    history.push({ text: messageText, normalized, ts: Date.now() });
    if (history.length > 20) history = history.slice(-20);
    maUserHistory.set(username, history);
    if (history.length < (maSettings.triggerConsecutive ?? 3)) return;
    const thresh = maSettings.similarityThreshold ?? 0.65;
    const consec = history.slice(-(maSettings.triggerConsecutive ?? 3));
    const refNorm = consec[0].normalized;
    const allConsecSimilar = consec.every((m) => maSimilarity(refNorm, m.normalized) >= thresh);
    const windowMs = (maSettings.windowSeconds ?? 60) * 1000;
    const now = Date.now();
    const inWindow = history.filter((m) => now - m.ts <= windowMs);
    let windowMatchCount = 0;
    if (inWindow.length >= 2) {
      const lastNorm = inWindow[inWindow.length - 1].normalized;
      for (const m of inWindow) {
        if (maSimilarity(lastNorm, m.normalized) >= thresh) windowMatchCount++;
      }
    }
    if (allConsecSimilar) {
      maAlertCooldown.set(username, now);
      showMaPopup(username, consec.map((m) => m.text), `${consec.length}\xD7 stejn\xE1 zpr\xE1va za sebou`);
    } else if (windowMatchCount >= (maSettings.triggerWindow ?? 4)) {
      maAlertCooldown.set(username, now);
      const lastNorm = inWindow[inWindow.length - 1].normalized;
      const matchMsgs = inWindow
        .filter((m) => maSimilarity(lastNorm, m.normalized) >= thresh)
        .map((m) => m.text)
        .slice(-3);
      showMaPopup(username, matchMsgs, `${windowMatchCount}\xD7 podobn\xE1 zpr\xE1va za ${maSettings.windowSeconds}s`);
    }
  }

  // ── Welcome pill (Dynamic Island) ────────────────────
  let maWelcomeTimerId = null;
  function showMaWelcome() {
    // Welcome pill ukazujeme jen moderátorům – jinak nic dělat nemůže.
    if (kceModCheckPending || !kceUserIsModerator) return;
    const existing = document.querySelector(".kce-ma-welcome");
    if (existing) existing.remove();
    if (maWelcomeTimerId) { clearTimeout(maWelcomeTimerId); maWelcomeTimerId = null; }
    const pill = document.createElement("div");
    pill.className = "kce-ma-welcome";
    pill.innerHTML =
      `<span class="kce-ma-w-dot"></span>` +
      `<span class="kce-ma-w-text">Moderation Assist aktivn\xED</span>`;
    document.body.appendChild(pill);
    maWelcomeTimerId = setTimeout(() => {
      pill.classList.add("kce-ma-welcome-out");
      setTimeout(() => { if (pill.isConnected) pill.remove(); }, 500);
    }, 4000);
  }

  // ── Alert popup (Dynamic Island) ─────────────────────
  const MA_TIMEOUT_STEPS = [30, 60, 120, 300, 600, 1800, 3600, 7200, 14400, 86400, 604800];

  function maGetNextTimeoutIdx(username) {
    const last = maUserLastTimeout.get(username) || 0;
    const idx = MA_TIMEOUT_STEPS.findIndex((s) => s > last);
    return idx >= 0 ? idx : MA_TIMEOUT_STEPS.length - 1;
  }

  let maPopupTimerId = null;

  function showMaPopup(username, messages, triggerReason) {
    // Mod Assist popup ukazujeme JEN moderátorům – jinak by tlačítka neuspěla na API.
    if (kceModCheckPending || !kceUserIsModerator) {
      kceLog("[KCE-MA] popup skipped – not moderator on this channel");
      return;
    }
    const existing = document.querySelector(".kce-ma-popup");
    if (existing) {
      existing.remove();
      if (maPopupTimerId) { clearTimeout(maPopupTimerId); maPopupTimerId = null; }
    }
    const autoClose = maSettings.autoCloseSecs ?? 15;
    let timeoutIdx = maGetNextTimeoutIdx(username);
    const safeUser = (username || "?").replace(/[<>&"]/g, "");
    const previewHtml = messages.slice(-3).map((m) => {
      const safe = (m || "").replace(/[<>&"]/g, "").slice(0, 80);
      return `<div class="kce-ma-msg-preview">${safe}</div>`;
    }).join("");

    const popup = document.createElement("div");
    popup.className = "kce-ma-popup";
    popup.innerHTML =
      `<div class="kce-ma-top-bar">` +
        `<span class="kce-ma-pill-icon">\u26A0</span>` +
        `<span class="kce-ma-pill-label">Moderation Assist</span>` +
        `<button class="kce-ma-close">\xD7</button>` +
      `</div>` +
      `<div class="kce-ma-content">` +
        `<div class="kce-ma-user-row">` +
          `<span class="kce-ma-avatar">${safeUser.slice(0, 1).toUpperCase()}</span>` +
          `<div>` +
            `<div class="kce-ma-username">${safeUser}</div>` +
            `<div class="kce-ma-reason">${triggerReason}</div>` +
          `</div>` +
        `</div>` +
        `<div class="kce-ma-previews">${previewHtml}</div>` +
        `<div class="kce-ma-actions">` +
          `<button class="kce-ma-btn kce-ma-ignore">Nechat b\xFDt</button>` +
          `<div class="kce-ma-timeout-group">` +
            `<button class="kce-ma-tostep kce-ma-to-dec">\u2039</button>` +
            `<button class="kce-ma-btn kce-ma-to-act">Timeout ${formatDuration(MA_TIMEOUT_STEPS[timeoutIdx])}</button>` +
            `<button class="kce-ma-tostep kce-ma-to-inc">\u203A</button>` +
          `</div>` +
          `<button class="kce-ma-btn kce-ma-ban">Ban</button>` +
        `</div>` +
        `<div class="kce-ma-footer">` +
          `<span class="kce-ma-dis-label">Vypnout assist:</span>` +
          `<button class="kce-ma-dis-btn" data-ms="300000">5 min</button>` +
          `<button class="kce-ma-dis-btn" data-ms="3600000">1 h</button>` +
          `<button class="kce-ma-dis-btn" data-ms="86400000">1 den</button>` +
          `<button class="kce-ma-dis-btn" data-ms="604800000">7 dn\xED</button>` +
          `<button class="kce-ma-dis-btn" data-ms="-1">Nav\u017Edy</button>` +
        `</div>` +
      `</div>` +
      `<div class="kce-ma-progress-wrap">` +
        `<div class="kce-ma-progress-bar"></div>` +
      `</div>`;

    document.body.appendChild(popup);

    // JS-driven progress bar (CSS animation-duration je přebita !important – používáme RAF)
    const progressBar = popup.querySelector(".kce-ma-progress-bar");
    const startTime = Date.now();
    const durationMs = autoClose * 1000;
    let progressRafId = null;
    const tickProgress = () => {
      if (!popup.isConnected) return;
      const pct = Math.max(0, 1 - (Date.now() - startTime) / durationMs);
      progressBar.style.transform = `scaleX(${pct})`;
      if (pct > 0) progressRafId = requestAnimationFrame(tickProgress);
    };
    progressRafId = requestAnimationFrame(tickProgress);

    const toActBtn = popup.querySelector(".kce-ma-to-act");
    const closeFn = () => {
      if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = null; }
      popup.classList.add("kce-ma-popup-out");
      setTimeout(() => { if (popup.isConnected) popup.remove(); }, 400);
      if (maPopupTimerId) { clearTimeout(maPopupTimerId); maPopupTimerId = null; }
    };
    const updateToBtn = () => { toActBtn.textContent = "Timeout " + formatDuration(MA_TIMEOUT_STEPS[timeoutIdx]); };

    maPopupTimerId = setTimeout(closeFn, autoClose * 1000);
    popup.querySelector(".kce-ma-close").addEventListener("click", closeFn);
    popup.querySelector(".kce-ma-ignore").addEventListener("click", closeFn);
    popup.querySelector(".kce-ma-to-dec").addEventListener("click", () => { timeoutIdx = Math.max(0, timeoutIdx - 1); updateToBtn(); });
    popup.querySelector(".kce-ma-to-inc").addEventListener("click", () => { timeoutIdx = Math.min(MA_TIMEOUT_STEPS.length - 1, timeoutIdx + 1); updateToBtn(); });
    toActBtn.addEventListener("click", () => {
      const secs = MA_TIMEOUT_STEPS[timeoutIdx];
      maUserLastTimeout.set(username, secs);
      closeFn();
      const ch = (window.location.pathname.match(/^\/([^/]+)/) || [])[1] || null;
      executeModAction(
        { action: "timeout", label: "Timeout " + formatDuration(secs), durationSeconds: secs, color: "#f59e0b" },
        { channel: ch, username, messageId: null, messageText: messages[messages.length - 1] || "" }
      );
    });
    popup.querySelector(".kce-ma-ban").addEventListener("click", () => {
      closeFn();
      const ch = (window.location.pathname.match(/^\/([^/]+)/) || [])[1] || null;
      executeModAction(
        { action: "ban", label: "PERMANENT BAN", color: "#7f1d1d" },
        { channel: ch, username, messageId: null, messageText: messages[messages.length - 1] || "" }
      );
    });
    popup.querySelectorAll(".kce-ma-dis-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ms = parseInt(btn.dataset.ms, 10);
        maSaveSettings({ disabledUntil: ms === -1 ? -1 : Date.now() + ms });
        closeFn();
        showModToast("Moderation Assist vypnut" + (ms === -1 ? " nav\u017Edy" : " na " + btn.textContent), true);
      });
    });
  }

  // ── Test commands ─────────────────────────────────────
  function maInterceptChatInput(e) {
    if (e.key !== "Enter") return;
    const el = e.target;
    if (!el) return;
    const isInput = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    if (!isInput) return;
    const raw = (el.value !== undefined ? el.value : el.textContent || "").trim();
    if (!raw.startsWith("!assistTest")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (el.value !== undefined) { el.value = ""; } else { el.textContent = ""; }
    el.dispatchEvent(new Event("input", { bubbles: true }));

    const parts = raw.split(/\s+/);
    const testUser = parts[1] || null;

    if (!testUser) {
      showMaWelcome();
    } else {
      const fakeHistory = [
        testUser + ": kdy bude stream",
        testUser + ": kdy bude stream pls",
        testUser + ": kdy bude stream!!!",
      ];
      showMaPopup(testUser, fakeHistory, "3\xD7 stejn\xE1 zpr\xE1va (test)");
    }
  }

  async function maInit() {
    try {
      const r = await chrome.storage.sync.get(MA_KEY);
      const stored = r[MA_KEY] || {};
      // Migrace starých nastavení: checkModOnly dříve defaultovalo na true,
      // nyní default je false. Pokud uživatel nastavení explicitně nezměnil
      // (žádný _v tag), resetujeme checkModOnly na false.
      if (!stored._v && stored.checkModOnly === true) {
        stored.checkModOnly = false;
        stored._v = 1;
      }
      maSettings = { ...MA_DEFAULT_SETTINGS, ...stored };
    } catch (_) {}

    kceLog("[KCE-MA] init – načtená nastavení:", JSON.stringify({ enabled: maSettings.enabled, checkModOnly: maSettings.checkModOnly, disabledUntil: maSettings.disabledUntil }), "| isMod:", maIsMod);

    // Kontrola mod statusu pro aktuální kanál – BEZ await (15s API timeout neblokuje init).
    // Dokud check nedoběhne, mod akce jsou blokované (kceModCheckPending = true).
    checkModeratorStatus();

    // Test command interceptor
    document.addEventListener("keydown", maInterceptChatInput, true);

    // PRIMÁRNÍ detekce zpráv – page-bridge (MAIN world) zachytává zprávy přímo
    // z Pusher WebSocketu a vystřelí event. Žádný DOM parsing, žádný delay.
    document.addEventListener("kce-new-chat-message", (e) => {
      const { username, content } = e.detail || {};
      if (!username || !content) return;
      if (maIsEnabled()) maCheckMessage(username, content);
      handleMentionInMessage(username, content);
    });

    // Po 3s: označ stávající zprávy jako zpracované a spusť scan
    setTimeout(() => {
      // Fallback na document.body pokud findChatroomEl() selže (offline chat apod.)
      const scanRoot = findChatroomEl() || document.body;
      // Pre-markujeme jen elementy s reálným obsahem (ne prázdné [data-index] placeholdery
      // ve virtuálním listu – ty by jinak byly považovány za zpracované i po načtení obsahu)
      querySelectorAllDeep(scanRoot, "[data-chat-entry], .chat-entry, .kce-message").forEach((el) => {
        const text = (el.textContent || "").trim();
        if (text.length > 3 && text.includes(":")) maProcessedEntries.add(el);
      });
      // Záložní scan – primární cesta vede přes WebSocket bridge.
      // Tady scanujeme jen sporadicky pro případ, že by bridge nezachytil event.
      setInterval(maPeriodicScan, 30000);
      // Memory cleanup 1× za minutu (TTL na maUserHistory, cooldown, hard-cap na userů)
      setInterval(maEvictStale, 60000);
      // Welcome notifikace
      if (maIsEnabled()) showMaWelcome();
    }, 3000);
  }

  // =====================================================

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
      node?.classList?.contains?.("kce-swipe-bg") ||
      node?.classList?.contains?.("kce-ma-popup");

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
            // Slow mode bublina se přidává jako tooltip-pozicovaný element – chyť ji okamžitě
            suppressSlowModeTooltips(node);
            // Uložená šířka chatu – pokud panel právě teď naběhl, aplikuj okamžitě.
            // Tohle běží i předtím, než dojde řada na setupChatResize() v init().
            if (kceSavedChatWidth) tryApplyChatWidth();
            if (node.dataset?.chatEntry) {
              addEnhancementClass(node, "message");
              tagLinkHighlights(node);
            }
            if (node.querySelectorAll) {
              node.querySelectorAll("[data-chat-entry]").forEach((el) => {
                addEnhancementClass(el, "message");
                tagLinkHighlights(el);
              });
            }
            if (node.shadowRoot) injectCssIntoRoot(node.shadowRoot);
          }
        }
      }
      if (!dominated) scheduleTag();
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: false });

    // Startup retag pro fázi načítání (před tím, než observer chytne všechno)
    [200, 1500, 5000].forEach((ms) => setTimeout(tagChatMessages, ms));
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

  function findElementsByTextInsensitive(root, text) {
    const needle = text.toLowerCase();
    const out = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const t = (node.textContent || "").toLowerCase();
        if (t.includes(needle)) out.push(node);
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
      // Substringy pro Kickův "pauza při scrollu" banner v různých jazycích.
      // Hledá se jako case-insensitive includes – stačí, aby jakýkoli substring sedl.
      const KICK_PAUSE_TEXT_HINTS = [
        "paused for scrolling",     // EN
        "chat paused",               // EN zkrácené
        "pozastaven",                // CZ (chat pozastaven)
        "pozastav",                  // CZ kratší
      ];

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
        "display:none;position:fixed;z-index:9999;pointer-events:none;" +
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
        // Sbíráme přes všechny lokalizační substringy; deduplikujeme a vyhazujeme
        // 1) náš vlastní banner (.kce-pause-banner), 2) elementy, které obsahují jiné nalezené
        const all = new Set();
        for (const hint of KICK_PAUSE_TEXT_HINTS) {
          for (const el of findElementsByTextInsensitive(document.body, hint)) all.add(el);
        }
        const found = [...all].filter((el) => !el.closest(".kce-pause-banner"));
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
          // Texty tlačítek "skoč na živý chat" – EN i CZ varianty
          const resumeTexts = [
            "Jump to live", "Go to live", "Resume", "View new messages", "New messages",
            "Skočit", "Pokračovat", "Nové zprávy", "Zobrazit nové",
          ];
          for (const text of resumeTexts) {
            const btns = findElementsByTextInsensitive(document.body, text);
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
    // Startup retry – Kick chat panel se renderuje postupně. Po 3 pokusech necháváme
    // už jen 12s watchdog, který znovu připojí handler, pokud Kick chatroom přemontoval.
    [800, 3000, 8000].forEach((ms) => setTimeout(run, ms));
    setInterval(run, 12000);
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

  /** Diagnostika struktury zprávy – běží jen s KCE_DEBUG=1.
   *  Použij pro ladění, když Kick změní DOM a selektory přestanou matchovat. */
  let diagDone = false;
  function logChatDiagnostic() {
    if (!KCE_DEBUG || diagDone) return;
    const entry = document.querySelector("div[data-index]") || document.querySelector("[data-chat-entry], .chat-entry");
    if (!entry) return;
    diagDone = true;
    const cs = getComputedStyle(entry);
    const info = {
      tag: entry.tagName,
      classes: entry.className,
      offsetHeight: entry.offsetHeight,
      computed: { lineHeight: cs.lineHeight, position: cs.position, transform: cs.transform },
    };
    kceLog("[KCE] Chat message diagnostic:", info);
  }

  const CHAT_WIDTH_KEY = "kickChatEnhancerChatWidth";

  // ── EARLY LOAD šířky chatu ──────────────────────────────
  // Načítáme okamžitě (paralelně se zbytkem init), aby Kick neměl čas vyrenderovat
  // chat v default šířce a pak se to neměnilo skokem. Aplikujeme jakmile panel existuje.
  let kceSavedChatWidth = null;
  const kceChatWidthLoadedPromise = chrome.storage.sync.get(CHAT_WIDTH_KEY)
    .then((result) => {
      kceSavedChatWidth = result[CHAT_WIDTH_KEY] || null;
      tryApplyChatWidth();
    })
    .catch(() => {});

  function applyChatWidthToPanel(panel) {
    if (!kceSavedChatWidth || !panel) return false;
    if (panel.dataset.kceChatWidthApplied === String(kceSavedChatWidth)) return true;
    panel.style.width = kceSavedChatWidth + "px";
    panel.style.minWidth = kceSavedChatWidth + "px";
    panel.style.maxWidth = kceSavedChatWidth + "px";
    panel.style.flexShrink = "0";
    panel.dataset.kceChatWidthApplied = String(kceSavedChatWidth);
    return true;
  }

  function tryApplyChatWidth() {
    if (!kceSavedChatWidth) return false;
    const panel = findChatPanel();
    if (panel) return applyChatWidthToPanel(panel);
    return false;
  }

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

  let setupChatResizeRunning = false;
  async function setupChatResize() {
    if (setupChatResizeRunning) return;
    setupChatResizeRunning = true;
    try {
      await _setupChatResizeImpl();
    } finally {
      setupChatResizeRunning = false;
    }
  }
  async function _setupChatResizeImpl() {
    const existing = document.querySelector(".kce-chat-resize-handle");
    if (existing && existing.isConnected) return;
    if (existing) existing.remove();

    // Počkáme jen na load uložené šířky (paralelně už běží od start scriptu).
    await kceChatWidthLoadedPromise;

    const trySetup = () => {
      const chatPanel = findChatPanel();
      if (!chatPanel) return false;

      const parent = chatPanel.parentElement;
      if (!parent) return false;

      // Aplikuj šířku okamžitě (idempotentní – pokud už platí, nic se nestane)
      applyChatWidthToPanel(chatPanel);

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
        kceSavedChatWidth = newWidth;
        chatPanel.dataset.kceChatWidthApplied = String(newWidth);
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

      kceLog("[KCE] Chat resize handle připojen:", chatPanel.tagName, chatPanel.className?.slice(0, 60));
      return true;
    };

    if (trySetup()) return;
    // Rychlejší retry sekvence – panel se obvykle objeví do 1-2s, dáváme dohromady ~5s pokrytí.
    const delays = [100, 250, 500, 1000, 2000, 4000];
    for (const ms of delays) {
      await new Promise((r) => setTimeout(r, ms));
      if (trySetup()) return;
    }
  }

  // Při navigaci v Kick SPA (pushState) se kanál může změnit – musíme zopakovat mod check
  // a smazat staré handles, dokud potvrzení nepřijde.
  function setupSpaNavigationWatch() {
    let lastPath = window.location.pathname;
    const onPathChange = () => {
      const current = window.location.pathname;
      if (current === lastPath) return;
      lastPath = current;
      kceLog("[KCE] SPA navigace →", current);
      removeAllModHandles();
      checkModeratorStatus();
    };
    // pushState / replaceState wrapper – Kick používá React Router
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) { const r = origPush.apply(this, args); onPathChange(); return r; };
    history.replaceState = function (...args) { const r = origReplace.apply(this, args); onPathChange(); return r; };
    window.addEventListener("popstate", onPathChange);
  }

  async function init() {
    injectIntoAllShadowRoots();
    const settings = await getSettings();
    applyEnhancements(settings);
    tagChatMessages();
    // Username detekce běží paralelně – pro mention highlight je třeba znát aktuálního usera
    detectCurrentUsername();
    await maInit();
    observeChat();
    setupSpaNavigationWatch();
    setupPauseOnHover(settings);
    setupModDragHandle(settings);
    setupChatResize();
    setInterval(() => {
      const h = document.querySelector(".kce-chat-resize-handle");
      if (!h || !h.isConnected) setupChatResize();
    }, 8000);
    // Doplnit "(Xs)" do "Slow mode activated" banneru – Kick ho re-renderuje při změnách,
    // periodicky kontrolujeme. Suppression tooltipu běží zvlášť přes MutationObserver.
    setInterval(() => {
      if (kceSlowModeInfo.enabled) annotateSlowModeBanner(document.body);
      // Suppress i ony Kickovy tooltipy, co tam mohly stát od loadu (před našim observer registered)
      suppressSlowModeTooltips(document.body);
    }, 1500);
    // Jeden resize event pro virtualizer (CSS změnilo výšky řádků) – jen jednou
    setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
    // Scroll na nejnovější zprávy – 2× stačí (300ms hned po injekci CSS, 2000ms po načtení chatu)
    [300, 2000].forEach((ms) => setTimeout(() => {
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
