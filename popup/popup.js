const STORAGE_KEY = "kickChatEnhancerSettings";

const defaults = {
  messageSpacing: true,
  visualSeparation: true,
  improveReplyStyling: true,
  emoteSize: true,
  usernameHighlight: true,
  pauseChatOnHover: true,
};

async function loadSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const settings = { ...defaults, ...result[STORAGE_KEY] };

  document.getElementById("messageSpacing").checked = settings.messageSpacing;
  document.getElementById("visualSeparation").checked = settings.visualSeparation;
  document.getElementById("improveReplyStyling").checked = settings.improveReplyStyling;
  document.getElementById("emoteSize").checked = settings.emoteSize;
  document.getElementById("usernameHighlight").checked = settings.usernameHighlight;
  document.getElementById("pauseChatOnHover").checked = settings.pauseChatOnHover;
}

async function saveSettings() {
  const settings = {
    messageSpacing: document.getElementById("messageSpacing").checked,
    visualSeparation: document.getElementById("visualSeparation").checked,
    improveReplyStyling: document.getElementById("improveReplyStyling").checked,
    emoteSize: document.getElementById("emoteSize").checked,
    usernameHighlight: document.getElementById("usernameHighlight").checked,
    pauseChatOnHover: document.getElementById("pauseChatOnHover").checked,
  };
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}

document.querySelectorAll(".toggle input").forEach((input) => {
  input.addEventListener("change", saveSettings);
});

loadSettings();
