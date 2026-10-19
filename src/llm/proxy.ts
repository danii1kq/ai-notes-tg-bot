import http from "node:http";
import https from "node:https";
import type { Logger } from "../logger.js";

export interface LlmProxyOptions {
  host: string;
  port: number;
  /** Base URL of the upstream OpenAI compatible API, for example https://host/v1 */
  targetBaseUrl: string;
  /** Credential injected into every upstream request. */
  apiKey: string;
  /** Stable session id, the OpenCode Go relay routes requests by it. */
  sessionId: string;
  logger: Logger;
}

export interface LlmProxy {
  start(): Promise<void>;
  stop(): Promise<void>;
  baseUrl: string;
  /** Port the proxy listens on (after `start`, useful when port 0 was used). */
  port: number;
}

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

/**
 * A tiny reverse proxy in front of the model provider.
 *
 * The OpenCode Go relay refuses requests without the `x-opencode-session`
 * header, and the Hermes provider profile does not send it. The proxy adds the
 * header and the credential, so the key never has to be written into the
 * Hermes configuration and the agent only talks to a local endpoint.
 */
export function createLlmProxy(options: LlmProxyOptions): LlmProxy {
  const base = options.targetBaseUrl.replace(/\/+$/, "");
  const logger = options.logger;

  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        const body = await readBody(request);
        const suffix = (request.url ?? "/").replace(/^\/v1(?=\/|$)/, "");
        const target = `${base}${suffix}`;

        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (HOP_BY_HOP.has(key.toLowerCase())) continue;
          if (typeof value === "string") headers[key] = value;
          else if (Array.isArray(value)) headers[key] = value.join(", ");
        }
        if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
        if (options.sessionId) headers["x-opencode-session"] = options.sessionId;
        headers["content-length"] = String(Buffer.byteLength(body));

        const upstream = upstreamRequest(
          target,
          {
            method: request.method ?? "GET",
            headers,
          },
          (upstreamResponse) => {
            response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            upstreamResponse.pipe(response);
          },
        );
        upstream.on("error", (error) => {
          logger.error("llm proxy upstream error", { error: error.message, target });
          if (!response.headersSent) {
            response.writeHead(502, { "content-type": "application/json" });
          }
          response.end(JSON.stringify({ error: { message: error.message } }));
        });
        upstream.end(body);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("llm proxy failed", { error: message });
        if (!response.headersSent) {
          response.writeHead(500, { "content-type": "application/json" });
        }
        response.end(JSON.stringify({ error: { message } }));
      }
    })();
  });

  return {
    baseUrl: `http://${options.host}:${options.port}/v1`,
    get port() {
      const address = server.address();
      return address && typeof address === "object" ? address.port : options.port;
    },
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          logger.info("llm proxy listening", {
            host: options.host,
            port: options.port,
            target: base,
          });
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Sends the request to the upstream, http or https depending on the target. */
function upstreamRequest(
  target: string,
  options: { method: string; headers: Record<string, string> },
  callback: (response: http.IncomingMessage) => void,
): http.ClientRequest {
  const isHttps = target.startsWith("https://");
  const transport = isHttps ? https : http;
  return transport.request(target, { method: options.method, headers: options.headers }, callback);
}

function readBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
