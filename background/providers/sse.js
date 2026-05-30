/**
 * Parse an SSE stream from a ReadableStream body.
 * Yields {event, data} objects for each SSE message.
 */
export async function* parseSSEStream(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentData = [];

  const flushMessage = () => {
    if (currentData.length === 0) return null;
    const message = {
      event: currentEvent,
      data: currentData.join('\n'),
    };
    currentEvent = '';
    currentData = [];
    return message;
  };

  const processLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') return flushMessage();
    if (line.startsWith(':')) return null;

    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).replace(/^ /, '');
    } else if (line.startsWith('data:')) {
      currentData.push(line.slice(5).replace(/^ /, ''));
    }
    return null;
  };

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) {
          const message = processLine(buffer);
          if (message) yield message;
          buffer = '';
        }
        const message = flushMessage();
        if (message) yield message;
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const message = processLine(line);
        if (message) yield message;
        newlineIndex = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
}
