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

  function tagChatMessages(root = null) {
    const doc = document;
    const base = root ?? doc;

    // 1. data-chat-entry (včetně uvnitř Shadow DOM)
    querySelectorAllDeep(base, "[data-chat-entry]").forEach((el) => {
      addEnhancementClass(el, "message");
      ensureModHandle(el);
    });

    // 2. Třídy obsahující chat-entry, chatEntry, message-row
    querySelectorAllDeep(base, "[class*='chat-entry'], [class*='chatEntry'], [class*='message-row']").forEach((el) => {
      addEnhancementClass(el, "message");
      ensureModHandle(el);
    });

    // 3. Fallback: divy v scroll kontejneru chatu (včetně Shadow DOM)
    const searchRoot = base === document ? document.body : base;
    const chatScroll = base.querySelector?.("[class*='chat'][class*='scroll'], [class*='chatroom'][class*='scroll']")
      || querySelectorDeep(searchRoot, "[class*='chat'][class*='scroll']")
      || querySelectorDeep(searchRoot, "[class*='chatroom'][class*='scroll']");
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

    const searchRootForIndex = base === document ? document.body : base;
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

    // 5. Uvnitř chatroomu: třídy message/line/entry/row (včetně Shadow DOM)
    const chatrooms = querySelectorAllDeep(base, "[class*='chatroom']");
    chatrooms.forEach((chatroom) => {
      querySelectorAllDeep(chatroom, "[class*='message'], [class*='Message'], [class*='line'], [class*='Line'], [class*='entry'], [class*='Entry'], [class*='row'], [class*='Row']").forEach((el) => {
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
    });

  }

  function ensureModHandle(entryEl) {
    if (document.documentElement.dataset.kceModDrag !== "1") return;
    if (entryEl.querySelector(".kce-mod-handle")) return;
    const root = entryEl.getRootNode();
    if (root instanceof ShadowRoot) injectCssIntoRoot(root);
    const handle = document.createElement("div");
    handle.className = "kce-mod-handle";
    handle.textContent = "\u22EE";
    entryEl.appendChild(handle);
  }

  function findEntry(startEl) {
    let el = startEl;
    while (el && el !== document.body) {
      if (el.classList?.contains("kce-message") || el.dataset?.index !== undefined || el.dataset?.chatEntry !== undefined) return el;
      el = el.parentElement;
    }
    return null;
  }

  function getMessageData(entryEl) {
    const channelMatch = window.location.pathname.match(/^\/([^/]+)/);
    const channel = channelMatch ? channelMatch[1] : null;
    let messageId = entryEl.id?.replace(/^[^0-9]+/, "") || entryEl.dataset?.messageId || entryEl.dataset?.id || null;
    if (!messageId && entryEl.dataset?.chatEntry && String(entryEl.dataset.chatEntry).match(/^\d+$/)) messageId = entryEl.dataset.chatEntry;
    if (!messageId) {
      const fromChild = entryEl.querySelector?.("[data-message-id], [data-id]");
      if (fromChild) messageId = fromChild.dataset?.messageId || fromChild.dataset?.id || null;
    }
    const firstLink = entryEl.querySelector('a[href*="/"]');
    let username = null;
    if (firstLink && firstLink.href) {
      const m = firstLink.getAttribute("href").match(/\/([^/]+)\/?$/);
      if (m) username = m[1];
    }
    if (!username && firstLink) username = (firstLink.textContent || "").trim().replace(/:$/, "");
    return { channel, messageId, username };
  }

  function formatDuration(s) {
    if (s < 60) return Math.round(s) + "s";
    if (s < 3600) return Math.round(s / 60) + " min";
    if (s < 86400) return Math.round(s / 3600) + " h";
    return Math.round(s / 86400) + " d";
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
    }, 2000);

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
    if (!channel) return;
    const base = "https://kick.com";
    try {
      if (action === "delete" && messageId) {
        const crRes = await fetch(base + "/api/v2/channels/" + encodeURIComponent(channel) + "/chatroom", { credentials: "include" });
        const crData = await crRes.json();
        const chatroomId = crData?.id ?? crData?.chatroom?.id;
        if (chatroomId) {
          const r = await fetch(base + "/api/v2/chatrooms/" + chatroomId + "/messages/" + encodeURIComponent(messageId), { method: "DELETE", credentials: "include" });
          if (r.ok) console.log("[KCE] Zpráva smazána.");
          else console.warn("[KCE] Smazání zprávy:", r.status, await r.text());
        }
      } else if (action === "ban" && username) {
        const r = await fetch(base + "/api/v2/channels/" + encodeURIComponent(channel) + "/bans", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username }),
        });
        if (r.ok) console.log("[KCE] Uživatel zabanován.");
        else console.warn("[KCE] Ban:", r.status, await r.text());
      } else if (action === "timeout" && username && durationSeconds) {
        const r = await fetch(base + "/api/v1/channels/" + encodeURIComponent(channel) + "/mute-user", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username, duration: durationSeconds }),
        });
        if (r.ok) console.log("[KCE] Timeout " + durationSeconds + "s.");
        else console.warn("[KCE] Timeout:", r.status, await r.text());
      }
    } catch (err) {
      console.warn("[KCE] Moderation error:", err);
    }
  }

  function executeModAction(info, data) {
    const payload = {
      action: info.action,
      channel: data.channel,
      messageId: data.messageId,
      username: data.username,
      durationSeconds: info.durationSeconds || null,
    };
    runModerationApi(payload);
  }

  function observeChat() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes?.forEach((node) => {
          if (node?.nodeType !== Node.ELEMENT_NODE) return;
          if (node.dataset?.chatEntry) addEnhancementClass(node, "message");
          if (node.querySelectorAll) {
            node.querySelectorAll("[data-chat-entry]").forEach((el) => addEnhancementClass(el, "message"));
          }
          if (node.shadowRoot) {
            injectCssIntoRoot(node.shadowRoot);
          }
        });
      }
      tagChatMessages();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(tagChatMessages, 100);
    setTimeout(tagChatMessages, 500);
    setTimeout(tagChatMessages, 1000);
    setTimeout(tagChatMessages, 2000);
    setTimeout(tagChatMessages, 4000);
    setTimeout(tagChatMessages, 8000);
    setTimeout(tagChatMessages, 12000);
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

    const run = () => {
      const chatEntry = querySelectorDeep(document.body, "[data-chat-entry]") || document.querySelector("[data-chat-entry]");
      const scrollParents = chatEntry ? getAllScrollParents(chatEntry).filter((el) => el.scrollHeight > el.clientHeight) : [];
      const chatroom = querySelectorDeep(document.body, "[class*='chatroom']") || document.querySelector("[class*='chatroom']");
      const chatroomScroll = chatroom ? findAllScrollContainers(chatroom) : [];
      const byId = document.getElementById("chatroom-messages") || querySelectorDeep(document.body, "#chatroom-messages");
      const primaryScroll = scrollParents[0] || chatroomScroll[0] || getPrimaryScrollContainer(chatEntry);
      let allScrollContainers = scrollParents.length ? scrollParents : (chatroomScroll.length ? chatroomScroll : (primaryScroll ? [primaryScroll] : []));
      if (byId && byId.scrollHeight > byId.clientHeight && !allScrollContainers.includes(byId)) {
        allScrollContainers = [byId, ...allScrollContainers];
      }
      if (!allScrollContainers.length) return;
      if (allScrollContainers[0].dataset.kcePauseSetup) return;
      allScrollContainers[0].dataset.kcePauseSetup = "1";

      let paused = false;
      const pinnedMap = new Map();
      const restores = [];
      let scrollIntoViewRestore = null;
      const hiddenKickNotifications = new Set();
      let kickBannerHideInterval = null;
      const KICK_PAUSE_TEXT = "Chat paused for scrolling";
      const KICK_PAUSE_TEXT_ALT = "paused for scrolling";

      const primaryScrollContainer = allScrollContainers[0];
      const banner = document.createElement("div");
      banner.className = "kce-pause-banner";
      banner.textContent = "Chat pozastaven";
      banner.style.cssText =
        "display:none;position:sticky;top:0;left:0;right:0;z-index:100;padding:8px 12px;font-size:13px;color:#d0d0d8;background:rgba(35,40,43,0.97);border-bottom:1px solid rgba(255,255,255,0.12);text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.2);";
      primaryScrollContainer.insertBefore(banner, primaryScrollContainer.firstChild);
      const showBanner = () => { banner.style.display = "block"; };
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
      const origScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (...args) {
        if (paused && allScrollContainers.some((sc) => sc.contains(this))) return;
        return origScrollIntoView.apply(this, args);
      };
      scrollIntoViewRestore = () => {
        Element.prototype.scrollIntoView = origScrollIntoView;
        scrollIntoViewRestore = null;
      };

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
          applyScrollTopLock(el);
          applyScrollMethodsLock(el);
        });
      }

      function removeAllLocks() {
        restores.forEach((fn) => { try { fn(); } catch (_) {} });
        restores.length = 0;
        if (scrollIntoViewRestore) scrollIntoViewRestore();
        scrollIntoViewRestore = null;
      }

      allScrollContainers.forEach((el) => {
        el.addEventListener("scroll", () => {
          if (paused) pinnedMap.set(el, el.scrollTop);
        }, { passive: true });
      });

      let rafId = null;
      const enforceScroll = () => {
        if (!paused) return;
        try {
          allScrollContainers.forEach((el) => {
            if (el.isConnected) {
              const pin = pinnedMap.get(el);
              if (pin !== undefined && el.scrollTop !== pin) el.scrollTop = pin;
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
        allScrollContainers.forEach((sc) => pinnedMap.set(sc, sc.scrollTop));
        applyScrollIntoViewLock();
        applyAllLocks();
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
    [500, 1500, 3500, 7000].forEach((ms) => setTimeout(run, ms));
  }

  /**
   * Po injekci CSS se změní velikosti řádků chatu.
   * Virtualizér Kicku to potřebuje vědět – triggernem resize event
   * a scrollneme chat dolů na nejnovější zprávy.
   */
  function nudgeVirtualizerAndScroll() {
    window.dispatchEvent(new Event("resize"));
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
    if (document.querySelector(".kce-chat-resize-handle")) return;

    const trySetup = async () => {
      const chatPanel = findChatPanel();
      if (!chatPanel) return false;

      const parent = chatPanel.parentElement;
      if (!parent) return false;

      const cs = getComputedStyle(chatPanel);
      if (cs.position === "static") {
        chatPanel.style.position = "relative";
      }

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
      chatPanel.appendChild(handle);

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

      console.log("[KCE] Chat resize handle připojen k:", chatPanel.tagName, chatPanel.className?.slice(0, 60));
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
