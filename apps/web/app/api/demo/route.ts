import { NextResponse } from "next/server";
import { createDemoProject } from "@yta/core/demo";

export const dynamic = "force-dynamic";

/** POST { spec, voice? }: creates a demo video project from reviewed steps and queues it. */
export async function POST(req: Request) {
  const body = (await req.json()) as { spec?: unknown; voice?: unknown };
  try {
    return NextResponse.json(createDemoProject({ spec: body.spec, voice: body.voice }), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
