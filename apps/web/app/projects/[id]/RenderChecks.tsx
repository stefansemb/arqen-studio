"use client";

import type { PacingReport, VerifyReport } from "@yta/core/verify";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Output tab: checks on the rendered file, scene pacing and the hook's open loop. */
export function RenderChecks(props: { projectId: string; verify: VerifyReport | null; pacing: PacingReport | null; mtime: number }) {
  const { verify, pacing } = props;
  if (!verify && !pacing) return null;
  const notes = verify?.checks.filter((c) => !c.ok) ?? [];

  return (
    <div className="stack" style={{ fontSize: 13 }}>
      {verify ? (
        <div>
          <h3 style={{ margin: "8px 0" }}>Render check {verify.ok ? "passed" : "failed"}</h3>
          {notes.length ? (
            notes.map((c) => (
              <div key={c.name} className={c.level === "fail" ? "error" : "muted"}>
                [{c.level}] {c.name}: {c.detail}
              </div>
            ))
          ) : (
            <div className="muted">Format, length, black frames, voice and loudness all OK.</div>
          )}
        </div>
      ) : null}

      {pacing ? (
        <div>
          <h3 style={{ margin: "8px 0" }}>Pacing</h3>
          <div className="muted">
            {pacing.scenesPerMin} scenes/min · longest scene {pacing.longest.hook} s in the hook, {pacing.longest.early} s to 1:30, {pacing.longest.body} s after
          </div>
          {pacing.loops.map((l, i) => (
            <div key={i} className="muted">
              Hook promise: {l.question} {l.payoff !== null ? `(paid off at ${clock(l.payoff)})` : "(no payoff found)"}
            </div>
          ))}
          {pacing.warnings.map((w, i) => (
            <div key={i}>
              {clock(w.at)} {w.detail}
            </div>
          ))}
        </div>
      ) : null}

      {verify?.sheet ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/files/${props.projectId}/${verify.sheet}?v=${props.mtime}`} alt="Frames from each scene of the render" style={{ width: "100%", borderRadius: 8 }} />
      ) : null}
    </div>
  );
}
