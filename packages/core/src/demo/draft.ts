import fs from "node:fs";
import { chromium } from "playwright-core";
import { z } from "zod";
import { generateStructured } from "../llm";
import { findBrowser } from "./record";
import { parseDemoSpec, type DemoAction, type DemoSpec } from "./spec";

/**
 * Claude writes the demo steps: the page is opened once, its controls are listed with usable
 * selectors, and Claude turns the user's goal into narration plus actions on those controls.
 */

export interface PageControl {
  selector: string;
  tag: string;
  type?: string;
  label: string;
  options?: string[];
  range?: string;
  visible: boolean;
}

/** Lists the page's interactive elements with a selector Playwright can use. */
export async function inspectPage(url: string): Promise<{ title: string; headings: string[]; controls: PageControl[] }> {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 864 } });
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      throw new Error(`Could not open ${url}. Is the app running?`);
    }
    await page.waitForTimeout(800);
    return await page.evaluate(() => {
      const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      const esc = (s: string) => s.replace(/(["\\])/g, "\\$1");
      const seen = new Set<string>();
      const controls: PageControl[] = [];
      const els = document.querySelectorAll("input, select, textarea, button, a[href], [role=button], [role=radio], [role=tab], label .file-button, canvas");
      els.forEach((el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id;
        const label = (
          el.getAttribute("aria-label") ||
          (id && text(document.querySelector(`label[for="${id}"]`))) ||
          text(el.closest("label")) ||
          text(el) ||
          el.getAttribute("title") ||
          el.getAttribute("placeholder") ||
          ""
        ).slice(0, 80);
        let selector = "";
        if (id) selector = `#${id}`;
        else if (tag === "canvas") {
          const fig = el.closest("figure");
          const parent = fig?.parentElement;
          if (fig && parent?.id) selector = `#${parent.id} figure:nth-child(${Array.from(parent.children).indexOf(fig) + 1}) canvas`;
        } else if (el.classList.contains("file-button")) {
          const input = el.closest("label")?.querySelector("input[id]");
          if (input) selector = `label:has(#${input.id}) .file-button`;
        } else if (label) {
          const scope = el.parentElement?.closest("[id]");
          selector = `${scope ? `#${scope.id} ` : ""}${tag}:has-text("${esc(label.slice(0, 40))}")`;
        }
        if (!selector || seen.has(selector)) return;
        seen.add(selector);
        const r = (el as HTMLElement).getBoundingClientRect();
        const c: PageControl = { selector, tag, label, visible: r.width > 0 && r.height > 0 };
        const type = (el as HTMLInputElement).type;
        if (tag === "input" && type) c.type = type;
        if (tag === "select") c.options = Array.from((el as HTMLSelectElement).options).slice(0, 15).map((o) => `${o.value}=${o.text}`);
        if (type === "range") {
          const i = el as HTMLInputElement;
          c.range = `${i.min || 0}..${i.max || 100} step ${i.step || 1}, now ${i.value}`;
        }
        controls.push(c);
      });
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, .group-title, p"))
        .map((h) => text(h))
        .filter(Boolean)
        .slice(0, 40);
      return { title: document.title, headings, controls: controls.slice(0, 250) };
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

const ActionSchema = z.object({
  kind: z.enum(["click", "type", "select", "slide", "upload", "hover", "scroll", "look", "wait", "waitFor"]),
  target: z.string().describe("Selector from the control list (the file input for upload). Empty for wait."),
  text: z.string().describe("type: the text to type; select: the option value; upload: the file path; otherwise empty"),
  number: z.number().describe("slide: target value; wait: milliseconds; otherwise 0"),
  via: z.string().describe("upload: the visible button to point at (e.g. the file-button selector); otherwise empty"),
});

const DraftSchema = z.object({
  title: z.string().describe("YouTube-style title for the demo video"),
  steps: z.array(z.object({ say: z.string(), do: z.array(ActionSchema) })),
});

function toAction(a: z.infer<typeof ActionSchema>): DemoAction | null {
  switch (a.kind) {
    case "click":
    case "hover":
    case "scroll":
    case "look":
    case "waitFor":
      return a.target ? ({ [a.kind]: a.target } as DemoAction) : null;
    case "type":
      return a.target ? { type: { into: a.target, text: a.text } } : null;
    case "select":
      return a.target ? { select: { in: a.target, value: a.text } } : null;
    case "slide":
      return a.target ? { slide: { on: a.target, to: a.number } } : null;
    case "upload":
      return a.target && a.text ? { upload: { into: a.target, file: a.text, ...(a.via ? { via: a.via } : {}) } } : null;
    case "wait":
      return { wait: Math.min(5000, Math.max(200, a.number || 1000)) };
  }
}

export async function draftDemoSpec(input: { goal: string; url: string; files?: string[]; seconds?: number }): Promise<{ spec: DemoSpec; warnings: string[] }> {
  const goal = input.goal.trim();
  if (goal.length < 10) throw new Error("Describe what the demo should show.");
  const files = (input.files ?? []).map((f) => f.trim()).filter(Boolean);
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  const seconds = Math.min(180, Math.max(30, input.seconds ?? 60));
  const page = await inspectPage(input.url);

  const draft = await generateStructured({
    schema: DraftSchema,
    effort: "medium",
    system: `You script screen-recorded product demos for a YouTube channel. A robot performs your actions in a real browser while
an AI voice reads your narration, so every action must use a selector from the control list, exactly as written.
Narration: English, first person, friendly and concrete, like a creator showing their own tool. Speak about what is on screen right now.
No hype words, no claims the page does not show. About 2.6 words per second; the whole video should be ~${seconds} s, so ~${Math.round(seconds * 2.6)} words in total.
Steps: 5-10. Each step = 1-2 sentences plus the actions done while they are spoken (keep actions short enough to fit). Step 1 says what the tool is and
what we will make. The last step shows the finished result. After an action that changes a preview/result, add a "look" at that result.
After an upload or anything that processes, add "waitFor" on an element that only appears when it is done, if the list has one.
Only upload the files you are given. Never click buttons that log in, buy, delete or download a file; "hover" them instead.`,
    prompt: `Goal: ${goal}
App: ${input.url} (page title: ${page.title})
${files.length ? `Files you may upload: ${files.join(", ")}` : "No files to upload."}

Page text (headings and help):
${page.headings.join("\n")}

Controls (selector | tag/type | label | extra; hidden ones may appear later):
${page.controls.map((c) => `${c.selector} | ${c.tag}${c.type ? `/${c.type}` : ""} | ${c.label}${c.options ? ` | options: ${c.options.join(", ")}` : ""}${c.range ? ` | range ${c.range}` : ""}${c.visible ? "" : " | hidden"}`).join("\n")}`,
  });

  const known = new Set(page.controls.map((c) => c.selector));
  const warnings: string[] = [];
  const steps = draft.steps.map((s, i) => {
    const actions = s.do.map(toAction).filter((a): a is DemoAction => Boolean(a));
    for (const a of actions) {
      const target = a.click ?? a.hover ?? a.scroll ?? a.look ?? a.waitFor ?? a.type?.into ?? a.select?.in ?? a.slide?.on ?? a.upload?.into;
      if (target && !known.has(target)) warnings.push(`Step ${i + 1}: "${target}" is not in the page's control list; check it.`);
    }
    return { say: s.say, do: actions };
  });
  return { spec: parseDemoSpec({ title: draft.title, url: input.url, zoom: 1.5, steps }), warnings };
}
