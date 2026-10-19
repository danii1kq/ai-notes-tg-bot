import http from "node:http";
import { describe, expect, it } from "vitest";
import { createLlmProxy } from "../src/llm/proxy.js";
import { createLogger } from "../src/logger.js";

const logger = createLogger("error", "test");

interface CapturedRequest {
  headers: http.IncomingHttpHeaders;
  body: string;
  url: string;
}

describe("llm proxy", () => {
  it("adds the session header and the credential, and forwards the body", async () => {
    let captured: CapturedRequest | null = null;

    const upstream = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        captured = {
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          url: request.url ?? "",
        };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;

    const proxy = createLlmProxy({
      host: "127.0.0.1",
      port: 0,
      targetBaseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: "test-key",
      sessionId: "session-1",
      logger,
    });
    await proxy.start();

    const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [] }),
    });
    const payload = await response.json();

    expect(payload).toEqual({ ok: true });
    const request = captured as CapturedRequest | null;
    expect(request).not.toBeNull();
    expect(request?.headers["x-opencode-session"]).toBe("session-1");
    expect(request?.headers.authorization).toBe("Bearer test-key");
    expect(request?.body).toBe(JSON.stringify({ model: "test", messages: [] }));
    expect(request?.url).toBe("/v1/chat/completions");

    await proxy.stop();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
});
