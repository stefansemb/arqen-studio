import { describe, expect, it } from "vitest";
import { parsePageLinks, readPageMeta } from "../src/news";
import { decide, type GateInput } from "../src/watcher";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const settings = { enabled: true, intervalMin: 15, autoBuild: false, maxPerWeek: 2, cooldownHours: 12, minCreditsLeft: 4000, killWindowMin: 30, maxConfirmHours: 6, dailyPick: true, dailyPickHour: 14 };
const gate = (over: Omit<Partial<GateInput>, "story"> & { story?: Partial<GateInput["story"]> } = {}): GateInput => ({
  alreadyCovered: false,
  recentBuilds: [],
  creditsLeft: 100_000,
  settings,
  now: NOW,
  ...over,
  story: { tier: 1, official: true, sources: ["Anthropic News"], first_seen: hoursAgo(1), ...over.story },
});

describe("decide", () => {
  it("builds a confirmed tier-1 story (dry run says so)", () => {
    expect(decide(gate())).toEqual({ decision: "would_build", note: "Dry run: nothing was built" });
  });

  it("sends tier 2 to the roundup and ignores tier 0", () => {
    expect(decide(gate({ story: { tier: 2 } })).decision).toBe("roundup");
    expect(decide(gate({ story: { tier: 0 } })).decision).toBe("ignored");
  });

  it("waits for confirmation when a single non-official outlet reports it, then expires", () => {
    expect(decide(gate({ story: { official: false, sources: ["The Verge AI"] } })).decision).toBe("waiting");
    expect(decide(gate({ story: { official: false, sources: ["The Verge AI", "TechCrunch AI"] } })).decision).toBe("would_build");
    // Two unknown sites are not a confirmation.
    expect(decide(gate({ story: { official: false, sources: ["benzinga.com (Google News)", "Startup Fortune (Google News)"] } })).decision).toBe("waiting");
    expect(decide(gate({ story: { official: false, sources: ["benzinga.com (Google News)", "Reuters (Google News)"] } })).decision).toBe("would_build");
    // The same outlet via Google News, or an aggregator, is not a second source.
    expect(decide(gate({ story: { official: false, sources: ["The Decoder", "the-decoder.com (Google News)"] } })).decision).toBe("waiting");
    expect(decide(gate({ story: { official: false, sources: ["The Decoder", "Google News"] } })).decision).toBe("waiting");
    expect(decide(gate({ story: { official: false, sources: ["The Decoder", "Hacker News"] } })).decision).toBe("waiting");
    expect(decide(gate({ story: { official: false, sources: ["The Verge AI"], first_seen: hoursAgo(30) } })).decision).toBe("expired");
  });

  it("sends stories confirmed too long after they were first seen to the roundup", () => {
    const late = decide(gate({ story: { official: false, sources: ["TechCrunch AI", "The Decoder"], first_seen: hoursAgo(18.5) } }));
    expect(late).toMatchObject({ decision: "roundup", note: expect.stringContaining("too late") });
    expect(decide(gate({ story: { first_seen: hoursAgo(5) } })).decision).toBe("would_build");
  });

  it("respects coverage, weekly cap, cooldown and credits", () => {
    expect(decide(gate({ alreadyCovered: true })).decision).toBe("covered");
    expect(decide(gate({ recentBuilds: [hoursAgo(20), hoursAgo(50)] }))).toMatchObject({ decision: "blocked", note: expect.stringContaining("Weekly") });
    expect(decide(gate({ recentBuilds: [hoursAgo(20), hoursAgo(200)] })).decision).toBe("would_build");
    expect(decide(gate({ recentBuilds: [hoursAgo(3)] }))).toMatchObject({ decision: "blocked", note: expect.stringContaining("Cooldown") });
    expect(decide(gate({ creditsLeft: 6000 }))).toMatchObject({ decision: "blocked", note: expect.stringContaining("credits") });
    expect(decide(gate({ creditsLeft: null })).decision).toBe("would_build");
  });
});

describe("lab pages", () => {
  const page = { name: "Lab", url: "https://www.lab.ai/news", match: "/news/" };

  it("finds article links, keeps the readable headline and skips listing/pagination/other hosts", () => {
    const html = `
      <a href="/news"><span>News</span></a>
      <a href="/news/claude-text-watermark"><img src="x.png"></a>
      <a href="/news/claude-text-watermark"><h3>Claude text <b>watermark</b></h3></a>
      <a href="https://lab.ai/news/new-model-launch/">Introducing Model 9</a>
      <a href="/news?page=2">More</a>
      <a href="https://other.com/news/x">Elsewhere</a>`;
    expect(parsePageLinks(html, page)).toEqual([
      { title: "Claude text watermark", url: "https://www.lab.ai/news/claude-text-watermark" },
      { title: "Introducing Model 9", url: "https://lab.ai/news/new-model-launch/" },
    ]);
  });

  it("reads og meta in either attribute order", () => {
    const html = `<title>Fallback</title><meta content="Model 9 is here" property="og:title">
      <meta property="og:description" content="Our best model">
      <meta property="article:published_time" content="2026-10-01T09:00:00Z">`;
    expect(readPageMeta(html)).toEqual({ title: "Model 9 is here", description: "Our best model", published: "2026-10-01T09:00:00.000Z" });
  });
});

describe("official and covered checks", () => {
  it("counts a lab source as official only for its own company's stories", async () => {
    const { isOfficialFor } = await import("../src/watcher");
    expect(isOfficialFor("OpenAI News", "OpenAI")).toBe(true);
    expect(isOfficialFor("NVIDIA Newsroom", "OpenAI")).toBe(false);
    expect(isOfficialFor("The Verge AI", "OpenAI")).toBe(false);
  });

  it("only accepts 'already covered' when the named video exists", async () => {
    const { matchCovered } = await import("../src/watcher");
    const titles = ["Gemini 4 Argon Is Locked Away", "Researchers plug GPT-6 Astra into a robot"];
    expect(matchCovered("gemini 4 argon is  locked away", titles)).toBe(true);
    expect(matchCovered("FTC probes OpenAI", titles)).toBe(false);
    expect(matchCovered("", titles)).toBe(false);
  });
});

describe("planAdvance", () => {
  const ok = { ok: true, wordCount: 600, issues: [] };
  const bad = { ok: false, wordCount: 600, issues: [{ severity: "high" as const, claim: "It costs $5", problem: "not in source" }, { severity: "low" as const, claim: "x", problem: "y" }] };
  const p = (status: string, error: string | null = null) => ({ status, error }) as never;

  it("waits while a job runs and fails when the run failed or the project is gone", async () => {
    const { planAdvance } = await import("../src/watcher");
    expect(planAdvance("scripting", p("running"), { uploaded: false })).toEqual({ kind: "wait" });
    expect(planAdvance("producing", p("failed", "Render: boom"), { uploaded: false })).toEqual({ kind: "fail", reason: "Render: boom" });
    expect(planAdvance("producing", undefined, { uploaded: false }).kind).toBe("fail");
  });

  it("produces after a passed check, rewrites once with the high claims, then stops for review", async () => {
    const { planAdvance } = await import("../src/watcher");
    expect(planAdvance("scripting", p("review"), { check: ok, uploaded: false })).toEqual({ kind: "produce" });
    expect(planAdvance("scripting", p("review"), { check: bad, uploaded: false })).toEqual({ kind: "rewrite", avoid: ["It costs $5"] });
    expect(planAdvance("rewriting", p("review"), { check: bad, uploaded: false }).kind).toBe("review");
    expect(planAdvance("rewriting", p("review"), { check: ok, uploaded: false })).toEqual({ kind: "produce" });
  });

  it("uploads a rendered video and announces it once uploaded", async () => {
    const { planAdvance } = await import("../src/watcher");
    expect(planAdvance("producing", p("done"), { uploaded: false })).toEqual({ kind: "upload" });
    expect(planAdvance("uploading", p("done"), { uploaded: true })).toEqual({ kind: "announce" });
    expect(planAdvance("uploading", p("done"), { uploaded: false }).kind).toBe("fail");
  });
});

describe("briefText", () => {
  it("adds the angle and the rejected claims to the script prompt", async () => {
    const { briefText } = await import("../src/steps/script");
    expect(briefText({})).toBe("");
    const t = briefText({ angle: "Safety angle", avoid: ["It costs $5"] });
    expect(t).toContain("Editorial angle: Safety angle");
    expect(t).toContain("- It costs $5");
  });
});

describe("Hugging Face releases", () => {
  it("turns new models into official news items for the lab", async () => {
    const { hfModelsToItems, HF_ORGS, isOfficialFor } = await import("../src/watcher");
    const xiaomi = HF_ORGS.find((h) => h.org === "XiaomiMiMo")!;
    const items = hfModelsToItems([{ id: "XiaomiMiMo/MiMo-V2.6-Pro", createdAt: "2026-09-27T03:58:00.000Z" }, { id: "XiaomiMiMo/no-date" }], xiaomi);
    expect(items).toEqual([
      {
        title: "Xiaomi releases MiMo-V2.6-Pro on Hugging Face",
        url: "https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Pro",
        source: "Xiaomi MiMo (Hugging Face)",
        published: "2026-09-27T03:58:00.000Z",
        summary: "New model weights published by XiaomiMiMo on Hugging Face.",
      },
    ]);
    expect(isOfficialFor("Xiaomi MiMo (Hugging Face)", "Xiaomi")).toBe(true);
    expect(isOfficialFor("Zhipu GLM (Hugging Face)", "Zhipu")).toBe(true);
    expect(isOfficialFor("MiniMax (Hugging Face)", "Zhipu")).toBe(false);
    expect(isOfficialFor("Kimi Blog", "Moonshot")).toBe(true);
  });
});

describe("established sources", () => {
  it("recognizes outlets by feed name, Google News publisher or domain", async () => {
    const { isEstablishedSource } = await import("../src/watcher");
    for (const s of ["TechCrunch AI", "The Verge AI", "Reuters (Google News)", "venturebeat.com (Google News)", "The Guardian (Google News)", "Semafor (Google News)"]) {
      expect(isEstablishedSource(s), s).toBe(true);
    }
    for (const s of ["benzinga.com (Google News)", "tradingview.com (Google News)", "Startup Fortune (Google News)", "r/singularity", "Hacker News"]) {
      expect(isEstablishedSource(s), s).toBe(false);
    }
  });
});

describe("daily pick and sources", () => {
  const story = (over: Record<string, unknown>) => ({
    key: "k",
    tier: 2,
    decision: "roundup" as const,
    score: 7,
    covered: 0,
    sources: ["The Decoder"],
    official: false,
    first_seen: hoursAgo(3),
    best_url: "https://the-decoder.com/x",
    ...over,
  });

  it("picks the highest-scoring fresh, uncovered roundup story with a real article link", async () => {
    const { pickDaily } = await import("../src/watcher");
    const list = [
      story({ key: "low", score: 5 }),
      story({ key: "best", score: 9 }),
      story({ key: "old", score: 10, first_seen: hoursAgo(30) }),
      story({ key: "covered", score: 10, covered: 1 }),
      story({ key: "gnews", score: 10, best_url: "https://news.google.com/rss/articles/abc" }),
      story({ key: "ok", score: 7 }),
    ];
    expect(pickDaily(list, NOW)).toBe("best");
    expect(pickDaily([story({ score: 5 })], NOW)).toBeUndefined();
    expect(pickDaily([story({ score: 9, sources: ["tradingview.com (Google News)"] })], NOW)).toBeUndefined();
  });

  it("is due after the pick hour when nothing was made in the last 20 h", async () => {
    const { dailyPickDue } = await import("../src/watcher");
    const at = (h: number) => {
      const d = new Date(NOW);
      d.setHours(h, 0, 0, 0);
      return d;
    };
    expect(dailyPickDue(settings, [], at(15))).toBe(true);
    expect(dailyPickDue(settings, [], at(10))).toBe(false);
    expect(dailyPickDue(settings, [new Date(at(15).getTime() - 5 * 3600_000).toISOString()], at(15))).toBe(false);
    expect(dailyPickDue({ ...settings, dailyPick: false }, [], at(15))).toBe(false);
  });

  it("waits for a real article when a confirmed story only has Google News/Reddit links", () => {
    const g = gate({ story: { official: false, sources: ["TechCrunch (Google News)", "Wired (Google News)"], best_url: "https://news.google.com/rss/articles/x" } as never });
    expect(decide(g)).toMatchObject({ decision: "waiting", note: expect.stringContaining("direct article") });
  });

  it("credits the publisher of Google News items", async () => {
    const { fromGoogleNews, isSignalOnlyUrl } = await import("../src/watcher");
    const item = { title: "OpenAI launches GPT-6.1 Sol - TechCrunch", url: "https://news.google.com/rss/articles/x", source: "Google News", published: "", summary: "" };
    expect(fromGoogleNews(item)).toMatchObject({ title: "OpenAI launches GPT-6.1 Sol", source: "TechCrunch (Google News)" });
    expect(fromGoogleNews({ ...item, title: "Self-restarting model - a first - the-decoder.com" })).toMatchObject({
      title: "Self-restarting model - a first",
      source: "the-decoder.com (Google News)",
    });
    // The feed's <source> wins over a tagline after the outlet in the title.
    const abc = { ...item, title: "Trump cuts ties with Anthropic - ABC News - Breaking News, Latest News and Videos", publisher: "ABC News" };
    expect(fromGoogleNews(abc)).toMatchObject({ title: "Trump cuts ties with Anthropic", source: "ABC News (Google News)" });
    const { isEstablishedSource } = await import("../src/watcher");
    expect(isEstablishedSource("ABC News (Google News)")).toBe(true);
    expect(isSignalOnlyUrl("https://www.reddit.com/r/singularity/comments/1")).toBe(true);
    expect(isSignalOnlyUrl("https://techcrunch.com/2026/10/01/x")).toBe(false);
  });
});
