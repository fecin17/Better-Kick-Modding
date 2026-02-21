/**
 * DIAGNOSTIKA: Spusť v DevTools konzoli (F12) na stránce Kick.com s otevřeným streamem.
 * Vyber CELÝ obsah tohoto souboru (Ctrl+A), zkopíruj (Ctrl+C), vlož do konzole a stiskni Enter.
 * Výsledek je v window.__kceDiagnostic – pro zobrazení zadej: __kceDiagnostic
 */
(function () {
  try {
  function querySelectorDeep(root, selector) {
    const el = root.querySelector?.(selector);
    if (el) return el;
    try {
      for (const node of root.querySelectorAll?.("*") ?? []) {
        if (node.shadowRoot) {
          const found = querySelectorDeep(node.shadowRoot, selector);
          if (found) return found;
        }
      }
    } catch (_) {}
    return null;
  }

  function getAllScrollParents(el) {
    const list = [];
    let parent = el?.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      const oy = style.overflowY;
      const ox = style.overflowX;
      if (oy === "auto" || oy === "scroll" || oy === "overlay" || ox === "auto" || ox === "scroll" || ox === "overlay") {
        list.push(parent);
      }
      parent = parent.parentElement;
    }
    return list;
  }

  function analyzeScrollContainer(el, label) {
    if (!el) return null;
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const overflow = style.overflow;
    const scrollHeight = el.scrollHeight;
    const clientHeight = el.clientHeight;
    const scrollTop = el.scrollTop;
    const isScrollable = scrollHeight > clientHeight;
    return {
      label,
      tag: el.tagName,
      className: el.className?.slice(0, 120),
      id: el.id || null,
      overflow,
      overflowY,
      overflowX,
      scrollHeight,
      clientHeight,
      scrollTop,
      isScrollable,
      inShadow: !!el.getRootNode?.()?.host,
    };
  }

  const r = { url: location.href };

  r.dataChatEntry = document.querySelectorAll("[data-chat-entry]").length;
  r.chatEntryClass = document.querySelectorAll("[class*='chat-entry']").length;
  r.chatroomClass = document.querySelectorAll("[class*='chatroom']").length;
  r.gcEmote = document.querySelectorAll("img.gc-emote-c, img[data-emote-id]").length;

  // Vyhledání v dokumentu i Shadow DOM
  const chatEntry = querySelectorDeep(document.body, "[data-chat-entry]") || document.querySelector("[data-chat-entry]");
  if (chatEntry) {
    r.firstMessage = {
      tag: chatEntry.tagName,
      classes: chatEntry.className,
      dataAttrs: [...chatEntry.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.name),
      parentClasses: chatEntry.parentElement?.className?.slice(0, 100),
    };
    r.firstMessageRoot = chatEntry.getRootNode?.()?.constructor?.name === "ShadowRoot" ? "ShadowRoot" : "Document";
  } else {
    r.firstMessage = "NENALEZENO – [data-chat-entry] neexistuje";
    const chatArea = document.querySelector("[class*='chat'], [id*='chat']");
    if (chatArea) {
      const children = chatArea.querySelectorAll(":scope > div > div, :scope > div");
      r.fallbackDivs = children.length;
      const sample = children[0];
      if (sample) {
        r.sampleStructure = {
          tag: sample.tagName,
          classes: sample.className?.slice(0, 120),
          hasColon: (sample.textContent || "").includes(":"),
          childCount: sample.children.length,
        };
      }
    }
  }

  // === ANALÝZA SCROLL KONTEJNERŮ ===
  r.scrollContainers = [];
  if (chatEntry) {
    const scrollParents = getAllScrollParents(chatEntry);
    scrollParents.forEach((el, i) => {
      r.scrollContainers.push(analyzeScrollContainer(el, `scrollParent_${i}`));
    });
  }

  // Alternativní scroll kontejnery podle běžných selektorů
  const scrollSelectors = [
    "[class*='chat'][class*='scroll']",
    "[class*='chatroom'][class*='scroll']",
    "[class*='chat'] [class*='scroll']",
    "[class*='messages'][class*='scroll']",
    "[class*='message-list']",
    "[class*='chat-messages']",
  ];
  r.scrollBySelector = [];
  const seenElements = new Set(chatEntry ? getAllScrollParents(chatEntry) : []);
  scrollSelectors.forEach((sel) => {
    const el = querySelectorDeep(document.body, sel) || document.querySelector(sel);
    if (el && !seenElements.has(el)) {
      seenElements.add(el);
      r.scrollBySelector.push({ selector: sel, ...analyzeScrollContainer(el, sel) });
    }
  });

  // Hledání prvního skutečně scrollovatelného kontejneru (nejbližší k zprávám)
  if (chatEntry) {
    const scrollParents = getAllScrollParents(chatEntry);
    const firstScrollable = scrollParents.find((el) => el.scrollHeight > el.clientHeight);
    r.primaryScrollContainer = firstScrollable ? analyzeScrollContainer(firstScrollable, "PRIMARY") : "NENALEZEN";
  }

  // Hledání scroll kontejnerů podle overflow (včetně Shadow DOM v chatroom)
  r.scrollByOverflow = [];
  const chatroom = querySelectorDeep(document.body, "[class*='chatroom']") || document.querySelector("[class*='chatroom']");
  if (chatroom) {
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        try {
          const s = getComputedStyle(node);
          if ((s.overflowY === "auto" || s.overflowY === "scroll" || s.overflowY === "overlay") && node.scrollHeight > node.clientHeight) {
            r.scrollByOverflow.push(analyzeScrollContainer(node, "overflow"));
          }
        } catch (_) {}
      }
      if (node.shadowRoot) for (const c of node.shadowRoot.childNodes || []) visit(c);
      for (const c of node.children || node.childNodes || []) visit(c);
    };
    visit(chatroom);
  }

  const shadows = [];
  document.querySelectorAll("*").forEach((el) => {
    if (el.shadowRoot) shadows.push({ tag: el.tagName, class: el.className?.slice(0, 50) });
  });
  r.shadowRoots = shadows.length;
  if (shadows.length) r.shadowHosts = shadows.slice(0, 5);

  r.kceLoaded = !!document.querySelector("style[data-kce-injected]");
  r.kceDataAttrs = {
    messageSpacing: document.documentElement.dataset.kceMessageSpacing,
    visualSeparation: document.documentElement.dataset.kceVisualSeparation,
    pauseChatOnHover: document.documentElement.dataset.kcePauseChatOnHover,
  };

  // === DIAGNOSTIKA SCROLLU: Kdo skutečně scrolluje? ===
  // Spusť __kceStartScrollSpy() v konzoli, nech chvíli běžet (přijdou nové zprávy), pak __kceStopScrollSpy()
  // Výsledek: __kceScrollSpyResult – pole { target, scrollTop, time }
  window.__kceScrollSpyResult = [];
  window.__kceScrollSpyOff = null;
  window.__kceStartScrollSpy = function () {
    if (window.__kceScrollSpyOff) return console.log("Scroll spy už běží.");
    window.__kceScrollSpyResult = [];
    const capture = function (e) {
      const t = e.target;
      if (t.nodeType !== Node.ELEMENT_NODE) return;
      window.__kceScrollSpyResult.push({
        tag: t.tagName,
        className: (t.className && String(t.className).slice(0, 80)) || null,
        scrollTop: t.scrollTop,
        scrollHeight: t.scrollHeight,
        time: new Date().toISOString(),
      });
    };
    document.addEventListener("scroll", capture, true);
    window.__kceScrollSpyOff = function () {
      document.removeEventListener("scroll", capture, true);
      window.__kceScrollSpyOff = null;
      console.log("Scroll spy zastaven. Počet zachycených scrollů:", window.__kceScrollSpyResult.length);
      console.log("Poslední záznamy:", window.__kceScrollSpyResult.slice(-5));
    };
    console.log("Scroll spy zapnut – čekej na nové zprávy v chatu, pak zadej __kceStopScrollSpy()");
  };
  window.__kceStopScrollSpy = function () {
    if (window.__kceScrollSpyOff) window.__kceScrollSpyOff();
  };

  console.log("=== Kick Chat Enhancer – diagnostika ===");
  console.log(JSON.stringify(r, null, 2));
  console.log("Tip: Pro zjištění, který element scrolluje při nových zprávách: __kceStartScrollSpy() → počkej → __kceStopScrollSpy() → __kceScrollSpyResult");
  window.__kceDiagnostic = r;
  return r;
  } catch (e) {
    console.error("KCE Diagnostika chyba:", e);
    window.__kceDiagnostic = { error: String(e), stack: e.stack };
    return window.__kceDiagnostic;
  }
})();
