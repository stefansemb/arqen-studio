/**
 * Telegram notifications with buttons. The worker long-polls getUpdates, so button presses work
 * without the app being reachable from the internet. Setup: create a bot with @BotFather, put
 * TELEGRAM_BOT_TOKEN in .env, send /start to the bot and copy the chat id it replies with into
 * TELEGRAM_CHAT_ID. Only that chat's button presses are honored.
 */
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { DATA_DIR, ROOT } from "./paths";

/** Read from .env on every call, so adding the token or chat id works without restarting the app. */
function envValue(name: string): string {
  try {
    const v = parseEnv(fs.readFileSync(path.join(ROOT, ".env"), "utf8"))[name]?.trim();
    if (v) return v;
  } catch {
    // no .env: fall back to the process environment
  }
  return process.env[name]?.trim() ?? "";
}
const token = () => envValue("TELEGRAM_BOT_TOKEN");
const chatId = () => envValue("TELEGRAM_CHAT_ID");

export function telegramStatus(): { configured: boolean; linked: boolean } {
  return { configured: !!token(), linked: !!token() && !!chatId() };
}

export interface Button {
  text: string;
  /** callback_data, at most 64 bytes, e.g. "stop:1a2b3c4d". */
  data: string;
}

async function call<T = unknown>(method: string, body: Record<string, unknown> | FormData, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    ...(body instanceof FormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? `HTTP ${res.status}`}`);
  return json.result as T;
}

const keyboard = (buttons?: Button[]) => (buttons?.length ? { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] } : undefined);

/** Sends a message (with a photo if the file exists). Returns false when Telegram isn't set up. */
export async function notify(text: string, opts: { photo?: string; buttons?: Button[] } = {}): Promise<boolean> {
  if (!telegramStatus().linked) return false;
  const markup = keyboard(opts.buttons);
  if (opts.photo && fs.existsSync(opts.photo)) {
    const form = new FormData();
    form.set("chat_id", chatId());
    form.set("caption", text.slice(0, 1024));
    if (markup) form.set("reply_markup", JSON.stringify(markup));
    form.set("photo", await fs.openAsBlob(opts.photo), path.basename(opts.photo));
    await call("sendPhoto", form, 60_000);
  } else {
    await call("sendMessage", { chat_id: chatId(), text: text.slice(0, 4096), reply_markup: markup, disable_web_page_preview: true });
  }
  return true;
}

interface Update {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number }; caption?: string; text?: string } };
}

const pollStatusFile = () => path.join(DATA_DIR, "telegram-status.json");
function writePollStatus(s: { lastPoll: string; error?: string }) {
  try {
    fs.writeFileSync(pollStatusFile(), JSON.stringify(s));
  } catch {
    // diagnostics only
  }
}

const offsetFile = () => path.join(DATA_DIR, "telegram-offset.json");
const readOffset = () => {
  try {
    return Number(JSON.parse(fs.readFileSync(offsetFile(), "utf8")).offset) || 0;
  } catch {
    return 0;
  }
};

/**
 * One long poll (up to ~25 s). `onButton` gets the callback data and returns the line appended
 * to the message (e.g. "Stopped: the video is private"); its buttons are then removed.
 */
export async function pollTelegram(onButton: (data: string) => Promise<string>): Promise<void> {
  if (!token()) return;
  let updates: Update[];
  try {
    updates = await call<Update[]>("getUpdates", { offset: readOffset(), timeout: 25, allowed_updates: ["message", "callback_query"] }, 40_000);
    writePollStatus({ lastPoll: new Date().toISOString() });
  } catch (err) {
    writePollStatus({ lastPoll: new Date().toISOString(), error: (err as Error).message });
    throw err;
  }
  for (const u of updates) {
    fs.writeFileSync(offsetFile(), JSON.stringify({ offset: u.update_id + 1 }));
    if (u.message?.text?.startsWith("/start")) {
      const id = String(u.message.chat.id);
      await call("sendMessage", {
        chat_id: id,
        text: chatId() === id ? "Linked. Notifications from Arqen AI Studio arrive here." : `Your chat id is ${id}. Put TELEGRAM_CHAT_ID=${id} in .env and restart the app.`,
      });
      continue;
    }
    const q = u.callback_query;
    if (!q?.data || !q.message) continue;
    if (String(q.message.chat.id) !== chatId()) {
      await call("answerCallbackQuery", { callback_query_id: q.id, text: "Not allowed" }).catch(() => {});
      continue;
    }
    let result: string;
    try {
      result = await onButton(q.data);
    } catch (err) {
      result = `Failed: ${(err as Error).message}`;
    }
    await call("answerCallbackQuery", { callback_query_id: q.id, text: result.slice(0, 190) }).catch(() => {});
    const isPhoto = q.message.caption !== undefined;
    const body = `${isPhoto ? q.message.caption : q.message.text}\n\n${result}`;
    await call(isPhoto ? "editMessageCaption" : "editMessageText", {
      chat_id: q.message.chat.id,
      message_id: q.message.message_id,
      ...(isPhoto ? { caption: body.slice(0, 1024) } : { text: body.slice(0, 4096) }),
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
  }
}
