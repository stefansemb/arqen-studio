import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { decodeEscapes } from "./timing";
import { DATA_DIR } from "./paths";

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic());

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

/**
 * One structured-output call to Claude. Streams (long scripts can take a while)
 * and validates the final JSON against the zod schema.
 */
/** One line per Claude call in data/llm-usage.jsonl, so the spend can be split by step and model. Never fails the call. */
function logUsage(label: string, model: string, usage: Anthropic.Usage): void {
  try {
    const line = {
      at: new Date().toISOString(),
      label,
      model,
      in: usage.input_tokens,
      out: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    };
    fs.appendFileSync(path.join(DATA_DIR, "llm-usage.jsonl"), JSON.stringify(line) + "\n");
  } catch {
    // Logging is a nice-to-have.
  }
}

export async function generateStructured<T extends z.ZodType>(opts: {
  /** What the call is for, in the usage log ("watcher", "script", ...). */
  label?: string;
  schema: T;
  system: string;
  /** Text, or content blocks when sending images. */
  prompt: Anthropic.MessageParam["content"];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** Default: MODEL. Haiku models run without adaptive thinking and effort, which they don't accept. */
  model?: string;
}): Promise<z.infer<T>> {
  const model = opts.model ?? MODEL;
  const haiku = model.startsWith("claude-haiku");
  const stream = getClient().messages.stream({
    model,
    max_tokens: opts.maxTokens ?? 32000,
    ...(haiku ? {} : { thinking: { type: "adaptive" as const } }),
    output_config: haiku ? { format: zodOutputFormat(opts.schema) } : { effort: opts.effort ?? "medium", format: zodOutputFormat(opts.schema) },
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  });
  let msg: Anthropic.Message;
  try {
    msg = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AnthropicError && /authentication method/i.test(err.message)) {
      throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env in the project root.");
    }
    throw err;
  }

  logUsage(opts.label ?? "other", model, msg.usage);

  if (msg.stop_reason === "refusal") throw new Error("Claude declined this request (refusal).");
  if (msg.stop_reason === "max_tokens") throw new Error("Claude response hit max_tokens; output truncated.");

  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  // Models sometimes double-escape a symbol (€ as "\\u20ac"), which would reach the screen as "€".
  return opts.schema.parse(JSON.parse(text, (_key, value: unknown) => (typeof value === "string" ? decodeEscapes(value) : value)));
}
