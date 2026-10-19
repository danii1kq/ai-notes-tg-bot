// Временный placeholder: проверяет, что пайплайн деплоя (build -> up -> health) живой.
// Заменяется реальным кодом бота.
import http from "node:http";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const port = Number(process.env.PORT ?? 8080);

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "ai-notes-tg-bot", version: pkg.version }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`placeholder bot ${pkg.version} listening on :${port}`);
  });
