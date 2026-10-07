import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildVideoResource, uploadVideo } from "../src/youtube";

const publish = { title: "My video", description: "About it", tags: ["ai", "news"] };
const opts = { privacy: "unlisted" as const, categoryId: "28", notifySubscribers: false, syntheticMedia: true };

describe("buildVideoResource", () => {
  it("maps publish info and options onto snippet/status", () => {
    const r = buildVideoResource(publish, opts);
    expect(r.snippet).toMatchObject({ title: "My video", description: "About it", tags: ["ai", "news"], categoryId: "28" });
    expect(r.status).toEqual({ privacyStatus: "unlisted", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  });

  it("forces private with publishAt when scheduled", () => {
    const r = buildVideoResource(publish, { ...opts, privacy: "public", publishAt: "2026-10-01T15:00:00+02:00" });
    expect(r.status.privacyStatus).toBe("private");
    expect(r.status).toMatchObject({ publishAt: "2026-10-01T13:00:00.000Z" });
  });
});

describe("uploadVideo (resumable protocol against a mock server)", () => {
  let server: http.Server;
  let received = Buffer.alloc(0);
  let failedOnce = false;
  let initBody: unknown;
  let initHeaders: http.IncomingHttpHeaders = {};
  const file = path.join(os.tmpdir(), `yta-upload-test-${process.pid}.bin`);
  const content = Buffer.from(Array.from({ length: 3500 }, (_, i) => i % 251));

  beforeAll(async () => {
    fs.writeFileSync(file, content);
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        if (req.method === "POST" && req.url?.startsWith("/upload/youtube/v3/videos")) {
          // YouTube now and then rejects a valid token; "stale-token" stands in for that.
          if (req.headers.authorization === "Bearer stale-token") {
            res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code: 401, errors: [{ reason: "authError" }] } }));
            return;
          }
          initBody = JSON.parse(body.toString());
          initHeaders = req.headers;
          res.writeHead(200, { Location: `${base}/session` }).end();
          return;
        }
        if (req.method === "PUT" && req.url === "/session") {
          const range = String(req.headers["content-range"]);
          const status = range.match(/^bytes \*\/(\d+)$/);
          if (status) {
            // Offset query after a failure.
            res.writeHead(308, received.length ? { Range: `bytes=0-${received.length - 1}` } : {}).end();
            return;
          }
          const [, start, , total] = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/)!.map(Number);
          // Simulate one transient server error on the second chunk, after nothing was stored.
          if (start > 0 && !failedOnce) {
            failedOnce = true;
            res.writeHead(503).end();
            return;
          }
          expect(start).toBe(received.length);
          received = Buffer.concat([received, body]);
          if (received.length < total) res.writeHead(308, { Range: `bytes=0-${received.length - 1}` }).end();
          else res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "vid123" }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.YOUTUBE_API_BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    fs.rmSync(file, { force: true });
    delete process.env.YOUTUBE_API_BASE;
  });

  it("uploads in chunks, survives a 503 by resuming from the server's offset, and returns the id", async () => {
    const progress: number[] = [];
    const result = await uploadVideo({
      file,
      resource: buildVideoResource(publish, opts),
      notifySubscribers: false,
      accessToken: "test-token",
      chunkSize: 1000,
      onProgress: (f) => progress.push(f),
    });
    expect(result).toEqual({ id: "vid123" });
    expect(received.equals(content)).toBe(true);
    expect(failedOnce).toBe(true);
    expect(initHeaders.authorization).toBe("Bearer test-token");
    expect(initHeaders["x-upload-content-length"]).toBe("3500");
    expect(initBody).toMatchObject({ snippet: { title: "My video" }, status: { privacyStatus: "unlisted" } });
    expect(progress[progress.length - 1]).toBe(1);
  }, 20000);

  it("gets a fresh token and retries once when the start of the upload is rejected with 401", async () => {
    received = Buffer.alloc(0);
    let refreshed = 0;
    const result = await uploadVideo({
      file,
      resource: buildVideoResource(publish, opts),
      notifySubscribers: false,
      accessToken: "stale-token",
      chunkSize: 4000,
      refreshToken: async () => {
        refreshed++;
        return "fresh-token";
      },
    });
    expect(result).toEqual({ id: "vid123" });
    expect(refreshed).toBe(1);
    expect(initHeaders.authorization).toBe("Bearer fresh-token");
  }, 20000);
});
