const STORAGE_KEY = "kickChatEnhancerSettings";
const MA_KEY = "kickChatEnhancerModAssist";

const defaults = {
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

const maDefaults = {
  enabled: true,
  checkModOnly: false,
  disabledUntil: null,
  triggerConsecutive: 3,
  triggerWindow: 4,
  windowSeconds: 60,
  similarityThreshold: 0.65,
  autoCloseSecs: 15,
};

function updateSpacingSliderVisibility() {
  const on = document.getElementById("messageSpacing").checked;
  document.getElementById("spacingSliderWrap").style.display = on ? "" : "none";
}

function formatMaStatus(ma) {
  const statusEl = document.getElementById("maStatusValue");
  const reEnableBtn = document.getElementById("maReEnable");
  if (!ma.enabled) {
    statusEl.textContent = "Vypnuto";
    statusEl.className = "ma-status-value disabled";
    reEnableBtn.style.display = "inline-block";
    return;
  }
  const du = ma.disabledUntil;
  if (du === -1) {
    statusEl.textContent = "Trvale vypnuto";
    statusEl.className = "ma-status-value disabled";
    reEnableBtn.style.display = "inline-block";
    return;
  }
  if (du && Date.now() < du) {
    const remaining = Math.ceil((du - Date.now()) / 60000);
    statusEl.textContent = `Pozastaveno (${remaining < 60 ? remaining + " min" : Math.ceil(remaining / 60) + " h"})`;
    statusEl.className = "ma-status-value paused";
    reEnableBtn.style.display = "inline-block";
    return;
  }
  statusEl.textContent = "Aktivní";
  statusEl.className = "ma-status-value active";
  reEnableBtn.style.display = "none";
}

async function loadSettings() {
  const result = await chrome.storage.sync.get([STORAGE_KEY, MA_KEY]);
  const settings = { ...defaults, ...result[STORAGE_KEY] };
  const ma = { ...maDefaults, ...result[MA_KEY] };

  document.getElementById("messageSpacing").checked = settings.messageSpacing;
  document.getElementById("visualSeparation").checked = settings.visualSeparation;
  document.getElementById("improveReplyStyling").checked = settings.improveReplyStyling;
  document.getElementById("emoteSize").checked = settings.emoteSize;
  document.getElementById("usernameHighlight").checked = settings.usernameHighlight;
  document.getElementById("pauseChatOnHover").checked = settings.pauseChatOnHover;
  document.getElementById("modDragHandle").checked = settings.modDragHandle;

  document.getElementById("chatFontSize").value = settings.chatFontSize;
  document.getElementById("chatFontSizeValue").textContent = settings.chatFontSize + "px";

  document.getElementById("messageSpacingPx").value = settings.messageSpacingPx;
  document.getElementById("messageSpacingPxValue").textContent = settings.messageSpacingPx + "px";

  updateSpacingSliderVisibility();

  // MA settings
  document.getElementById("maEnabled").checked = ma.enabled;
  document.getElementById("maCheckModOnly").checked = ma.checkModOnly !== false;
  document.getElementById("maTriggerConsec").value = ma.triggerConsecutive ?? 3;
  document.getElementById("maTriggerConsecValue").textContent = ma.triggerConsecutive ?? 3;
  document.getElementById("maAutoClose").value = ma.autoCloseSecs ?? 15;
  document.getElementById("maAutoCloseValue").textContent = (ma.autoCloseSecs ?? 15) + "s";
  formatMaStatus(ma);
}

async function saveSettings() {
  const settings = {
    messageSpacing: document.getElementById("messageSpacing").checked,
    visualSeparation: document.getElementById("visualSeparation").checked,
    improveReplyStyling: document.getElementById("improveReplyStyling").checked,
    emoteSize: document.getElementById("emoteSize").checked,
    usernameHighlight: document.getElementById("usernameHighlight").checked,
    pauseChatOnHover: document.getElementById("pauseChatOnHover").checked,
    modDragHandle: document.getElementById("modDragHandle").checked,
    chatFontSize: parseFloat(document.getElementById("chatFontSize").value),
    messageSpacingPx: parseInt(document.getElementById("messageSpacingPx").value, 10),
  };
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}

async function saveMaSettings(updates) {
  const result = await chrome.storage.sync.get(MA_KEY);
  const current = { ...maDefaults, ...result[MA_KEY] };
  const updated = { ...current, ...updates };
  await chrome.storage.sync.set({ [MA_KEY]: updated });
  formatMaStatus(updated);
}

// Chat enhancer toggles
document.querySelectorAll(".toggle input").forEach((input) => {
  if (input.id.startsWith("ma")) return;
  input.addEventListener("change", () => {
    saveSettings();
    updateSpacingSliderVisibility();
  });
});

document.getElementById("chatFontSize").addEventListener("input", (e) => {
  document.getElementById("chatFontSizeValue").textContent = e.target.value + "px";
  saveSettings();
});
document.getElementById("messageSpacingPx").addEventListener("input", (e) => {
  document.getElementById("messageSpacingPxValue").textContent = e.target.value + "px";
  saveSettings();
});

// MA toggles
document.getElementById("maEnabled").addEventListener("change", (e) => {
  saveMaSettings({ enabled: e.target.checked });
});
document.getElementById("maCheckModOnly").addEventListener("change", (e) => {
  saveMaSettings({ checkModOnly: e.target.checked });
});
document.getElementById("maTriggerConsec").addEventListener("input", (e) => {
  document.getElementById("maTriggerConsecValue").textContent = e.target.value;
  saveMaSettings({ triggerConsecutive: parseInt(e.target.value, 10) });
});
document.getElementById("maAutoClose").addEventListener("input", (e) => {
  document.getElementById("maAutoCloseValue").textContent = e.target.value + "s";
  saveMaSettings({ autoCloseSecs: parseInt(e.target.value, 10) });
});

// Re-enable button
document.getElementById("maReEnable").addEventListener("click", () => {
  saveMaSettings({ disabledUntil: null, enabled: true });
  document.getElementById("maEnabled").checked = true;
});

loadSettings();
