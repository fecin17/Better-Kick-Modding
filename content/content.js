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
  };

  let cachedCss = null;

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
  }

  function tagChatMessages(root = null) {
    const doc = document;

    // 1. data-chat-entry (ověřené z kick-tools)
    doc.querySelectorAll("[data-chat-entry]").forEach((el) => {
      addEnhancementClass(el, "message");
    });

    // 2. Třídy obsahující chat-entry, chatEntry, message-row
    doc.querySelectorAll("[class*='chat-entry'], [class*='chatEntry'], [class*='message-row']").forEach((el) => {
      addEnhancementClass(el, "message");
    });

    // 3. Fallback: divy v scroll kontejneru chatu s typickou strukturou (ikona + jméno + text)
    const chatScroll = doc.querySelector("[class*='chat'][class*='scroll'], [class*='chatroom'][class*='scroll']");
    if (chatScroll) {
      const candidates = chatScroll.querySelectorAll(":scope > div > div, :scope > div");
      candidates?.forEach((el) => {
        const text = el.textContent || "";
        const hasColon = text.includes(":");
        const hasEmote = el.querySelector("img[data-emote-id], img.gc-emote-c, img[class*='emote']");
        if (hasColon || hasEmote) addEnhancementClass(el, "message");
      });
    }

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

    setTimeout(tagChatMessages, 500);
    setTimeout(tagChatMessages, 2000);
    setTimeout(tagChatMessages, 5000);
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

  async function init() {
    injectIntoAllShadowRoots();
    const settings = await getSettings();
    applyEnhancements(settings);
    tagChatMessages();
    observeChat();
    setupPauseOnHover(settings);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[STORAGE_KEY]) {
      applyEnhancements(changes[STORAGE_KEY].newValue || defaultSettings);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 100));
  } else {
    setTimeout(init, 100);
  }
})();
