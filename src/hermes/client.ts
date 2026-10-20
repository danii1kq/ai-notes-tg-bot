import { spawn } from "node:child_process";
import type { Logger } from "../logger.js";

export interface HermesRunResult {
  ok: boolean;
  /** Final answer of the agent (empty when the run failed). */
  text: string;
  error?: string;
  durationMs: number;
  model: string;
  usedFallback: boolean;
  stderr: string;
}

export interface HermesClientOptions {
  bin: string;
  model: string;
  fallbackModel: string;
  timeoutMs: number;
  maxTurns: number;
  /** Working directory of the agent, it contains the rules (`.hermes.md`). */
  workspace: string;
  env: NodeJS.ProcessEnv;
  logger: Logger;
}

/**
 * Runs Hermes Agent as a child process.
 *
 * The agent is started in one shot mode (`hermes -z`), so every message gets
 * a fresh, isolated run: the vault itself is the memory of the bot. When the
 * primary model fails, the run is repeated with the fallback model.
 */
export class HermesClient {
  constructor(private readonly options: HermesClientOptions) {}

  async run(prompt: string): Promise<HermesRunResult> {
    const primary = await this.spawnOnce(prompt, this.options.model);
    if (primary.ok) {
      return { ...primary, model: this.options.model, usedFallback: false };
    }

    const fallbackModel = this.options.fallbackModel;
    if (!fallbackModel || fallbackModel === this.options.model) {
      return { ...primary, model: this.options.model, usedFallback: false };
    }

    this.options.logger.warn("primary model failed, trying the fallback model", {
      model: this.options.model,
      error: primary.error,
    });
    const fallback = await this.spawnOnce(prompt, fallbackModel);
    return { ...fallback, model: fallbackModel, usedFallback: true };
  }

  private spawnOnce(
    prompt: string,
    model: string,
  ): Promise<Omit<HermesRunResult, "model" | "usedFallback">> {
    const startedAt = Date.now();
    // `hermes chat -q` runs one query in the working directory (the agent
    // workspace with the rules) and prints the final answer.
    const args = [
      "chat",
      "-Q",
      "-q",
      prompt,
      "--max-turns",
      String(this.options.maxTurns),
      "--yolo",
      "--skills",
      "obsidian",
      "-m",
      model,
    ];

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const child = spawn(this.options.bin, args, {
        cwd: this.options.workspace,
        env: {
          ...this.options.env,
          NO_COLOR: "1",
          TERM: "dumb",
          CI: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        this.options.logger.warn("hermes run timed out, killing the process", {
          model,
          timeoutMs: this.options.timeoutMs,
        });
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      }, this.options.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const finish = (result: { ok: boolean; text: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ...result,
          durationMs: Date.now() - startedAt,
          stderr: stderr.trim().slice(-4000),
        });
      };

      child.on("error", (error) => {
        finish({ ok: false, text: "", error: `could not start hermes: ${error.message}` });
      });

      child.on("close", (code) => {
        const text = cleanOutput(stdout);
        if (code === 0 && text) {
          finish({ ok: true, text });
          return;
        }
        finish({
          ok: false,
          text,
          error: `hermes exited with code ${code ?? "null"}${stderr ? `: ${stderr.trim().slice(-500)}` : ""}`,
        });
      });
    });
  }
}

/** Removes the banners and the trailing noise Hermes prints around the answer. */
function cleanOutput(raw: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape character is exactly what has to be removed
  const withoutAnsi = raw.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  const lines = withoutAnsi
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  while (lines.length > 0 && isNoise(lines[lines.length - 1] as string)) {
    lines.pop();
  }
  return lines.join("\n").trim();
}

function isNoise(line: string): boolean {
  return /^(hermes|welcome|connecting|loading|session|session_id:|model:|provider:)/i.test(
    line.trim(),
  );
}
