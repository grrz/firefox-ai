import { loadSettings, saveSettings } from '../shared/settings.js';

const $ = (sel) => document.querySelector(sel);
const PAGE_CHATS_STORAGE_KEY = 'pageChatsByUrl';
let savedChatsFilterValue = '';

// DOM Elements
const activeProviderEl = $('#activeProvider');
const responseLanguageEl = $('#responseLanguage');
const claudeApiKeyEl = $('#claude-apiKey');
const claudeModelEl = $('#claude-model');
const openaiApiKeyEl = $('#openai-apiKey');
const openaiModelEl = $('#openai-model');
const grokApiKeyEl = $('#grok-apiKey');
const grokModelEl = $('#grok-model');
const lmstudioEndpointEl = $('#lmstudio-endpoint');
const lmstudioModelEl = $('#lmstudio-model');
const savedChatsListEl = $('#savedChatsList');
const savedChatsMetaEl = $('#savedChatsMeta');
const savedChatsFilterEl = $('#savedChatsFilter');
const saveBtnEl = $('#save');
const statusEl = $('#status');
const tabAgentEl = $('#tabAgent');
const tabChatsEl = $('#tabChats');
const panelAgentEl = $('#panelAgent');
const panelChatsEl = $('#panelChats');

function setActiveTab(tab) {
  const isAgent = tab !== 'chats';
  document.body.classList.toggle('tab-chats', !isAgent);
  tabAgentEl.classList.toggle('active', isAgent);
  tabAgentEl.setAttribute('aria-selected', isAgent ? 'true' : 'false');
  panelAgentEl.classList.toggle('active', isAgent);
  panelAgentEl.hidden = !isAgent;

  tabChatsEl.classList.toggle('active', !isAgent);
  tabChatsEl.setAttribute('aria-selected', !isAgent ? 'true' : 'false');
  panelChatsEl.classList.toggle('active', !isAgent);
  panelChatsEl.hidden = isAgent;
}

function showProviderConfig(providerId) {
  document.querySelectorAll('.provider-config').forEach(el => {
    el.classList.toggle('active', el.dataset.provider === providerId);
  });
}

async function loadForm() {
  const settings = await loadSettings();

  activeProviderEl.value = settings.activeProvider;
  responseLanguageEl.value = settings.responseLanguage;
  showProviderConfig(settings.activeProvider);

  // Claude
  claudeApiKeyEl.value = settings.providers.claude.apiKey || '';
  claudeModelEl.value = settings.providers.claude.model || '';

  // OpenAI
  openaiApiKeyEl.value = settings.providers.openai.apiKey || '';
  openaiModelEl.value = settings.providers.openai.model || '';

  // Grok
  grokApiKeyEl.value = settings.providers.grok.apiKey || '';
  grokModelEl.value = settings.providers.grok.model || '';

  // LM Studio
  lmstudioEndpointEl.value = settings.providers.lmstudio.endpoint || '';
  lmstudioModelEl.value = settings.providers.lmstudio.model || '';

  await renderSavedChats();
}

function formatDate(ts) {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleString();
}

function getMessageCount(entry) {
  if (!entry || !Array.isArray(entry.messages)) return 0;
  return entry.messages.length;
}

async function renderSavedChats() {
  const saved = await browser.storage.local.get(PAGE_CHATS_STORAGE_KEY);
  const chats = saved?.[PAGE_CHATS_STORAGE_KEY];
  const listEl = savedChatsListEl;
  const metaEl = savedChatsMetaEl;

  if (!chats || typeof chats !== 'object' || Array.isArray(chats) || Object.keys(chats).length === 0) {
    metaEl.textContent = 'Total: 0';
    listEl.innerHTML = '<div class="saved-chat-empty">No saved chats yet.</div>';
    return;
  }

  const entries = Object.entries(chats)
    .map(([url, entry]) => ({
      url,
      updatedAt: entry?.updatedAt || 0,
      messageCount: getMessageCount(entry),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const filteredEntries = savedChatsFilterValue
    ? entries.filter((entry) => entry.url.toLowerCase().includes(savedChatsFilterValue))
    : entries;

  metaEl.textContent = `Showing: ${filteredEntries.length} of ${entries.length}`;

  if (filteredEntries.length === 0) {
    listEl.innerHTML = '<div class="saved-chat-empty">No chats match this filter.</div>';
    return;
  }

  listEl.replaceChildren();
  for (const entry of filteredEntries) {
    const itemEl = document.createElement('div');
    itemEl.className = 'saved-chat-item';

    const urlWrapEl = document.createElement('div');
    urlWrapEl.className = 'saved-chat-url';
    const linkEl = document.createElement('a');
    linkEl.href = entry.url;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.textContent = entry.url;
    urlWrapEl.appendChild(linkEl);

    const metaItemEl = document.createElement('div');
    metaItemEl.className = 'saved-chat-meta';
    metaItemEl.textContent = `${entry.messageCount} messages • Updated: ${formatDate(entry.updatedAt)}`;

    itemEl.appendChild(urlWrapEl);
    itemEl.appendChild(metaItemEl);
    listEl.appendChild(itemEl);
  }
}

async function saveForm() {
  const settings = {
    activeProvider: activeProviderEl.value,
    responseLanguage: responseLanguageEl.value,
    providers: {
      claude: {
        apiKey: claudeApiKeyEl.value.trim(),
        model: claudeModelEl.value.trim(),
      },
      openai: {
        apiKey: openaiApiKeyEl.value.trim(),
        model: openaiModelEl.value.trim(),
      },
      grok: {
        apiKey: grokApiKeyEl.value.trim(),
        model: grokModelEl.value.trim(),
      },
      lmstudio: {
        endpoint: lmstudioEndpointEl.value.trim(),
        model: lmstudioModelEl.value.trim(),
      },
    },
    ui: {},
  };

  await saveSettings(settings);
  await renderSavedChats();
  const status = statusEl;
  status.textContent = 'Settings saved!';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

activeProviderEl.addEventListener('change', (e) => {
  showProviderConfig(e.target.value);
});

saveBtnEl.addEventListener('click', saveForm);
tabAgentEl.addEventListener('click', () => setActiveTab('agent'));
tabChatsEl.addEventListener('click', () => setActiveTab('chats'));
savedChatsFilterEl.addEventListener('input', (e) => {
  savedChatsFilterValue = e.target.value.trim().toLowerCase();
  void renderSavedChats();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[PAGE_CHATS_STORAGE_KEY]) {
    void renderSavedChats();
  }
});

loadForm();
setActiveTab('agent');
