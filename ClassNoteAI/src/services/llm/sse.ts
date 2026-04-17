/**
 * Parse Server-Sent Events from a streaming fetch body.
 * Yields each JSON payload (the text after `data: `). Skips comments
 * and the `[DONE]` sentinel.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const onAbort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1 || (idx = buffer.indexOf('\r\n\r\n')) !== -1) {
        const eventText = buffer.slice(0, idx);
        buffer = buffer.slice(idx + (buffer.charCodeAt(idx) === 13 ? 4 : 2));

        for (const line of eventText.split(/\r?\n/)) {
          if (!line || line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          const data = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'data') {
            if (data === '[DONE]') return;
            yield data;
          }
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
