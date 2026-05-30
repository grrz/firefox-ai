import { BaseProvider, ProviderError } from './base.js';
import { parseSSEStream } from './sse.js';

export class ClaudeProvider extends BaseProvider {
  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  supportsThinking() {
    const model = this.getModel();
    return /claude-(3-7|sonnet-4|opus-4|4)/.test(model);
  }

  /**
   * Convert OpenAI-format messages to Anthropic format.
   * Extracts system message separately.
   * Preserves thinking blocks for multi-turn conversations.
   */
  convertMessages(messages) {
    let system = '';
    const converted = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system += (system ? '\n\n' : '') + msg.content;
      } else if (msg.role === 'assistant' && msg.thinking && this.supportsThinking()) {
        converted.push({
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: msg.thinking },
            { type: 'text', text: msg.content },
          ],
        });
      } else {
        converted.push({ role: msg.role, content: msg.content });
      }
    }

    return { system, messages: converted };
  }

  async sendMessage(messages, { signal, onToken, onThinkingToken } = {}) {
    const validation = this.validate();
    if (!validation.valid) throw new ProviderError(validation.error);

    const { system, messages: convertedMessages } = this.convertMessages(messages);
    const useThinking = this.supportsThinking();

    const body = {
      model: this.getModel(),
      max_tokens: useThinking ? 16000 : 4096,
      stream: true,
      messages: convertedMessages,
    };
    if (system) body.system = system;
    if (useThinking) {
      body.thinking = { type: 'enabled', budget_tokens: 10000 };
    }

    const response = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal,
    }).catch(err => {
      if (err.name === 'AbortError') throw err;
      throw new ProviderError(`Network error: ${err.message}`, { retryable: true });
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 401) {
        throw new ProviderError('Invalid API key. Check your settings.', { status: 401 });
      }
      if (response.status === 429) {
        throw new ProviderError('Rate limited. Please wait and try again.', { retryable: true, status: 429 });
      }
      throw new ProviderError(`API error (${response.status}): ${text}`, { status: response.status });
    }

    let fullText = '';
    let currentBlockType = null;
    let stopReason = null;

    for await (const { event, data } of parseSSEStream(response.body, signal)) {
      if (data === '[DONE]') break;
      try {
        const parsed = JSON.parse(data);

        if (parsed.type === 'content_block_start') {
          currentBlockType = parsed.content_block?.type || null;
        } else if (parsed.type === 'content_block_stop') {
          currentBlockType = null;
        } else if (event === 'content_block_delta' || parsed.type === 'content_block_delta') {
          if (currentBlockType === 'thinking' || parsed.delta?.type === 'thinking_delta') {
            const token = parsed.delta?.thinking;
            if (token) onThinkingToken?.(token);
          } else {
            const token = parsed.delta?.text;
            if (token) {
              fullText += token;
              onToken?.(token);
            }
          }
        } else if (event === 'message_delta' || parsed.type === 'message_delta') {
          if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
        }
      } catch {
        // Skip unparseable chunks
      }
    }

    if (stopReason === 'max_tokens') {
      throw new ProviderError('Response stopped because the model reached its output limit.', {
        retryable: true,
        code: 'incomplete_response',
        details: {
          stopReason,
          receivedCharacters: fullText.length,
        },
        partialText: fullText,
      });
    }

    if (stopReason === 'refusal') {
      throw new ProviderError('Response was refused by the provider.', {
        code: 'content_filter',
        details: { stopReason },
      });
    }

    if (!fullText) {
      throw new ProviderError('The provider returned an empty response.', {
        retryable: true,
        code: 'empty_response',
        details: { stopReason },
      });
    }

    return fullText;
  }
}
