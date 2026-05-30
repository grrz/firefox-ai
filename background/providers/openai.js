import { BaseProvider, ProviderError } from './base.js';
import { parseSSEStream } from './sse.js';

export class OpenAIProvider extends BaseProvider {
  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
  }

  buildBody(messages) {
    return {
      model: this.getModel(),
      messages,
      stream: true,
    };
  }

  async sendMessage(messages, { signal, onToken, onThinkingToken } = {}) {
    const validation = this.validate();
    if (!validation.valid) throw new ProviderError(validation.error);

    const response = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildBody(messages)),
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
    let reasoningText = '';
    let finishReason = null;
    for await (const { data } of parseSSEStream(response.body, signal)) {
      if (data === '[DONE]') break;
      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta;
        // Reasoning/thinking tokens (OpenAI o-series, Grok thinking)
        const reasoningToken = delta?.reasoning_content ?? delta?.reasoning;
        if (reasoningToken) {
          reasoningText += reasoningToken;
          onThinkingToken?.(reasoningToken);
        }
        const token = delta?.content;
        if (token) {
          fullText += token;
          onToken?.(token);
        }
      } catch {
        // Skip unparseable chunks
      }
    }

    if (!fullText && reasoningText) {
      onToken?.(reasoningText);
      fullText = reasoningText;
    }

    if (finishReason === 'length') {
      throw new ProviderError('Response stopped because the model reached its output limit.', {
        retryable: true,
        code: 'incomplete_response',
        details: {
          finishReason,
          receivedCharacters: fullText.length,
        },
        partialText: fullText,
      });
    }

    if (finishReason === 'content_filter') {
      throw new ProviderError('Response was blocked by the provider content filter.', {
        code: 'content_filter',
        details: { finishReason },
      });
    }

    if (!fullText) {
      throw new ProviderError('The provider returned an empty response.', {
        retryable: true,
        code: 'empty_response',
        details: { finishReason },
      });
    }

    return fullText;
  }
}
