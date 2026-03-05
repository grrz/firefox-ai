import {getProviderConfig, loadSettings} from '../shared/settings.js';
import {RESPONSE_LANGUAGES, SYSTEM_PROMPT} from '../shared/constants.js';
import {OpenAIProvider} from './providers/openai.js';
import {ClaudeProvider} from './providers/claude.js';
import {LMStudioProvider} from './providers/lmstudio.js';

function createProvider(settings) {
  const config = getProviderConfig(settings);
  switch (settings.activeProvider) {
    case 'claude':
      return new ClaudeProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'grok':
      return new OpenAIProvider(config);
    case 'lmstudio':
      return new LMStudioProvider(config);
    default:
      throw new Error(`Unknown provider: ${settings.activeProvider}`);
  }
}

function buildChatMessages(messages, pageContext, settings) {
  const chatMessages = [];

  let systemContent = SYSTEM_PROMPT;
  const selectedLanguage = RESPONSE_LANGUAGES[settings?.responseLanguage] || RESPONSE_LANGUAGES.en;
  systemContent += `\n\nAlways answer in ${selectedLanguage}.`;
  if (pageContext?.textContent) {
    systemContent += `\n\n--- PAGE CONTEXT ---\n${pageContext.textContent}\n--- END PAGE CONTEXT ---`;
  }
  chatMessages.push({ role: 'system', content: systemContent });

  for (const msg of messages) {
    const m = { role: msg.role, content: msg.content };
    if (msg.thinking) m.thinking = msg.thinking;
    chatMessages.push(m);
  }

  return chatMessages;
}

function mergeContextLimits(allLimitEntries) {
  const details = [];
  for (const entry of allLimitEntries) {
    if (!entry || !Array.isArray(entry.details)) continue;
    for (const detail of entry.details) {
      if (!details.includes(detail)) details.push(detail);
    }
  }
  return {
    applied: details.length > 0,
    details,
  };
}

async function getDistilledContentForActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return { error: 'No active tab' };

  const tabId = tabs[0].id;
  const frameResponses = [];
  let frames;

  try {
    frames = await browser.webNavigation.getAllFrames({ tabId });
  } catch {
    frames = [];
  }

  // Fallback to top frame if frame enumeration is unavailable.
  if (!Array.isArray(frames) || frames.length === 0) {
    return browser.tabs.sendMessage(tabId, {type: 'distill', options: {includeIframes: true}});
  }

  for (const frame of frames) {
    try {
      const data = await browser.tabs.sendMessage(
        tabId,
        { type: 'distill', options: { includeIframes: false } },
        { frameId: frame.frameId }
      );
      if (data && !data.error && data.textContent) {
        frameResponses.push({
          frameId: frame.frameId,
          url: frame.url || data.url || '',
          data,
        });
      }
    } catch {
      // Some frames are inaccessible (restricted/internal/cross-browser boundary).
    }
  }

  if (frameResponses.length === 0) {
    return {
      title: '',
      url: tabs[0].url || '',
      textContent: '',
      wordCount: 0,
      error: 'Could not access page content. The page may not be fully loaded.',
    };
  }

  const topFrame = frameResponses.find((f) => f.frameId === 0) || frameResponses[0];
  const childFrames = frameResponses.filter((f) => f !== topFrame);

  const MAX_CHILD_FRAMES = 8;
  const includedChildFrames = childFrames.slice(0, MAX_CHILD_FRAMES);

  const parts = [topFrame.data.textContent];
  for (const frame of includedChildFrames) {
    const sectionTitle = frame.data.title || frame.url || `Frame ${frame.frameId}`;
    parts.push(`## Embedded frame: ${sectionTitle}\n\n${frame.data.textContent}`);
  }

  const limits = [];
  if (childFrames.length > MAX_CHILD_FRAMES) {
    limits.push(`embedded frames: included ${MAX_CHILD_FRAMES} of ${childFrames.length}`);
  }
  if (frames.length > frameResponses.length) {
    limits.push(`inaccessible frames skipped: ${frames.length - frameResponses.length}`);
  }

  const contextLimits = mergeContextLimits([
    topFrame.data.contextLimits,
    ...includedChildFrames.map((f) => f.data.contextLimits),
    { details: limits },
  ]);

  const textContent = parts.join('\n\n---\n\n');
  const wordCount = textContent.split(/\s+/).filter(Boolean).length;

  return {
    title: topFrame.data.title || tabs[0].title || '',
    url: topFrame.data.url || tabs[0].url || '',
    description: topFrame.data.description || '',
    textContent,
    wordCount,
    contextLimits,
  };
}

// Port-based streaming communication
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-chat') return;

  let abortController = null;

  port.onMessage.addListener(async (message) => {
    if (message.type === 'abort') {
      abortController?.abort();
      return;
    }

    if (message.type === 'chat') {
      abortController = new AbortController();
      const { messages, pageContext } = message;

      try {
        const settings = await loadSettings();
        const provider = createProvider(settings);

        const validation = provider.validate();
        if (!validation.valid) {
          port.postMessage({ type: 'error', error: validation.error, retryable: false });
          return;
        }

        const chatMessages = buildChatMessages(messages, pageContext, settings);

        port.postMessage({ type: 'stream_start' });

        await provider.sendMessage(chatMessages, {
          signal: abortController.signal,
          onThinkingToken: (token) => {
            try {
              port.postMessage({ type: 'stream_thinking', token });
            } catch {
              abortController?.abort();
            }
          },
          onToken: (token) => {
            try {
              port.postMessage({ type: 'stream_token', token });
            } catch {
              // Port disconnected
              abortController?.abort();
            }
          },
        });

        port.postMessage({ type: 'stream_end' });
      } catch (err) {
        if (err.name === 'AbortError') {
          try { port.postMessage({ type: 'stream_end', aborted: true }); } catch {}
          return;
        }
        try {
          port.postMessage({
            type: 'error',
            error: err.message || 'An unexpected error occurred',
            retryable: err.retryable || false,
          });
        } catch {}
      } finally {
        abortController = null;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    abortController?.abort();
  });
});

// One-shot message handling
browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'getDistilledContent') {
    try {
      return await getDistilledContentForActiveTab();
    } catch (err) {
      return {
        title: '',
        url: '',
        textContent: '',
        wordCount: 0,
        error: 'Could not access page content. The page may not be fully loaded.',
      };
    }
  }

  if (message.type === 'getSettings') {
    return loadSettings();
  }

  // Proxy fetch for content scripts (background has host_permissions)
  if (message.type === 'fetchText') {
    try {
      const resp = await fetch(message.url, { credentials: 'include' });
      if (!resp.ok) return { text: '', status: resp.status };
      return { text: await resp.text(), status: resp.status };
    } catch (err) {
      return { text: '', error: err.message };
    }
  }

  // Fetch YouTube transcript via innertube get_transcript endpoint
  if (message.type === 'fetchYouTubeTranscript') {
    try {
      const { videoId, clientVersion, clientName, apiKey } = message;
      if (!videoId) return { error: 'Missing videoId' };

      // Build protobuf params: { field1: { field2: videoId } }
      const idBytes = new TextEncoder().encode(videoId);
      const inner = new Uint8Array([0x12, idBytes.length, ...idBytes]);
      const outer = new Uint8Array([0x0a, inner.length, ...inner]);
      const params = btoa(String.fromCharCode(...outer))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const ytClientVersion = clientVersion || '2.20250101.00.00';
      const ytClientName = typeof clientName === 'string' && clientName ? clientName : 'WEB';
      const endpoint = apiKey
        ? `https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}`
        : 'https://www.youtube.com/youtubei/v1/get_transcript';

      const resp = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-YouTube-Client-Version': ytClientVersion,
          // WEB maps to client id 1 in request headers.
          'X-YouTube-Client-Name': ytClientName === 'WEB' ? '1' : ytClientName,
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: ytClientName,
              clientVersion: ytClientVersion,
              hl: 'en',
            },
          },
          params,
        }),
      });
      console.log('[bg fetchYouTubeTranscript] status:', resp.status);
      if (!resp.ok) return { error: `HTTP ${resp.status}` };
      const data = await resp.json();
      console.log('[bg fetchYouTubeTranscript] keys:', Object.keys(data));
      return { data };
    } catch (err) {
      console.log('[bg fetchYouTubeTranscript] error:', err.message);
      return { error: err.message };
    }
  }
});
