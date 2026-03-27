# AI Sidebar for Firefox

A Firefox WebExtension (Manifest V3) that adds a sidebar for chatting with AI about any web page. Supports multiple providers and streams responses in real time.

## Features

- **Multi-provider support** — Claude, OpenAI, Grok, and local models via LM Studio
- **Page-aware context** — automatically distills the current page content and sends it to the AI
- **Streaming responses** — token-by-token output with Markdown rendering
- **Per-tab conversations** — each browser tab maintains its own chat history
- **Quick actions** — one-click Summarize, Analyze, Key Points, and Explain
- **Thinking mode** — collapsible thinking blocks for models that support extended thinking (Claude) or `<think>` tags (DeepSeek, Qwen, etc.)
- **Comment extraction** — reads user comments from same-origin iframes (XenForo, etc.) and inline comment sections
- **Theme support** — auto, light, and dark themes
- **Keyboard shortcut** — `Ctrl+Shift+U` (Mac: `Ctrl+Shift+U`) to toggle the sidebar

## Setup

1. Open `about:debugging#/runtime/this-firefox` in Firefox
2. Click **Load Temporary Add-on** and select `manifest.json`
3. Open the sidebar (View > Sidebar > AI Chat, or use the keyboard shortcut)
4. Go to the extension settings to configure your API key and preferred provider

## Project Structure

```
manifest.json              Extension manifest (MV3)
background/
  background.js            Message router, streaming via ports
  providers/
    base.js                Abstract provider + ProviderError
    sse.js                 Server-Sent Events stream parser
    claude.js              Anthropic Claude API (with extended thinking)
    openai.js              OpenAI / Grok API
    lmstudio.js            LM Studio (local, extends OpenAI)
content/
  distill.js               Page content extraction (classic IIFE)
sidebar/
  sidebar.html / js / css  Chat UI
  lib/
    marked.esm.js          Vendored Markdown parser
    markdown.js            Markdown rendering helpers
shared/
  constants.js             Provider definitions, defaults, system prompt
  settings.js              Settings load/save via browser.storage.sync
  actions.js               Quick action definitions
options/
  options.html / js / css  Settings page
```

## Development

```bash
# Lint
npx web-ext lint

# Run with auto-reload
npx web-ext run
```

## Packaging

```bash
cd firefox-ai && zip -r ../firefox-ai.zip . -x '.*' -x '__MACOSX' -x 'node_modules/*'
```

## CLI Signing

You can sign the add-on from the command line with `web-ext`, and the sign step already packages the extension for you.

1. Create AMO API credentials in Developer Hub.
2. Export them as environment variables:

```bash
export WEB_EXT_API_KEY="your-amo-jwt-issuer"
export WEB_EXT_API_SECRET="your-amo-jwt-secret"
```

Aliases are also supported:

```bash
export AMO_JWT_ISSUER="your-amo-jwt-issuer"
export AMO_JWT_SECRET="your-amo-jwt-secret"
```

3. Run the signing script:

```bash
./scripts/sign-addon.js
```

By default this signs an `unlisted` build and writes the signed `.xpi` to `web-ext-artifacts/`.

Optional:

```bash
CHANNEL=listed AMO_METADATA_FILE=./amo-metadata.json ./scripts/sign-addon.js
```

If `web-ext` is not installed globally, the script falls back to `npx web-ext`.

References:
- Firefox Extension Workshop: https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- Firefox Extension Workshop: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
