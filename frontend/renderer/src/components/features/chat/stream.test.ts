import { describe, expect, it } from "vitest";
import { parseSseBlock, readSseEvents, type SseEvent } from "./stream";

function bodyOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSseEvents(body)) events.push(event);
  return events;
}

describe("parseSseBlock", () => {
  it("reads the event name and the JSON data", () => {
    expect(
      parseSseBlock('event: status\ndata: {"text":"Checking sales"}'),
    ).toEqual({
      event: "status",
      data: { text: "Checking sales" },
    });
  });

  it("ignores a block with no data or with data that is not JSON", () => {
    expect(parseSseBlock("event: status")).toBeNull();
    expect(parseSseBlock("event: status\ndata: {not json")).toBeNull();
  });
});

describe("readSseEvents", () => {
  it("reads several events that arrive in one chunk", async () => {
    const events = await collect(
      bodyOf(
        'event: meta\ndata: {"conversation_id":"c1"}\n\nevent: status\ndata: {"text":"A"}\n\n',
      ),
    );

    expect(events.map((e) => e.event)).toEqual(["meta", "status"]);
  });

  it("puts together an event that is split across chunks, even mid-word", async () => {
    const events = await collect(
      bodyOf(
        "event: sta",
        'tus\ndata: {"text":"Chec',
        'king sales"}\n',
        "\nevent: answer\ndata: {}\n\n",
      ),
    );

    expect(events).toEqual([
      { event: "status", data: { text: "Checking sales" } },
      { event: "answer", data: {} },
    ]);
  });

  it("does not split a multi-byte character that straddles two chunks", async () => {
    const bytes = new TextEncoder().encode(
      'event: status\ndata: {"text":"\\u6628\\u5929"}\n\n',
    );
    const cut = bytes.indexOf(0xe6) + 1; // inside the first character
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });

    expect(await collect(body)).toEqual([
      { event: "status", data: { text: "\u6628\u5929" } },
    ]);
  });

  it("drops a trailing event the connection cut off, and keeps the complete ones", async () => {
    const events = await collect(
      bodyOf(
        'event: meta\ndata: {"conversation_id":"c1"}\n\nevent: status\ndata: {"te',
      ),
    );

    expect(events.map((e) => e.event)).toEqual(["meta"]);
  });

  it("skips a malformed event and carries on", async () => {
    const events = await collect(
      bodyOf(
        "event: status\ndata: oops\n\n",
        'event: answer\ndata: {"ok":true}\n\n',
      ),
    );

    expect(events).toEqual([{ event: "answer", data: { ok: true } }]);
  });

  it("understands Windows line endings", async () => {
    const events = await collect(
      bodyOf('event: status\r\ndata: {"text":"A"}\r\n\r\n'),
    );

    expect(events).toEqual([{ event: "status", data: { text: "A" } }]);
  });
});
