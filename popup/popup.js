const STORAGE_KEY = "kickChatEnhancerSettings";

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

function updateSpacingSliderVisibility() {
  const on = document.getElementById("messageSpacing").checked;
  document.getElementById("spacingSliderWrap").style.display = on ? "" : "none";
}

async function loadSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = { ...defaults, ...result[STORAGE_KEY] };

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

document.querySelectorAll(".toggle input").forEach((input) => {
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

loadSettings();
