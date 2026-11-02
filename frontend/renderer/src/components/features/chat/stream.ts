// Reads the assistant's server-sent events from a fetch response body.
//
// EventSource only does GET, and this request carries a body, so the panel reads the stream
// itself. An event is a block of lines ending in a blank line:
//
//     event: status
//     data: {"text":"Checking sales"}
//
// A block cut off by a dropped connection has no blank line after it and is ignored, and so
// is a block whose data is not JSON — a half-event must never look like an answer.

export interface SseEvent {
  event: string;
  data: unknown;
}

export function parseSseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return null;
  }
}

export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const parsed = parseSseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (parsed) yield parsed;
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
