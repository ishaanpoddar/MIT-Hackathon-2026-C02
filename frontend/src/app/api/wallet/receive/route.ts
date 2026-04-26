import { NextResponse } from "next/server";

export async function POST() {
  try {
    const { execSync } = await import("child_process");
    const stdout = execSync(
      `npx @moneydevkit/agent-wallet@latest receive-bolt12`,
      {
        encoding: "utf-8",
        timeout: 60000,
        windowsHide: true,
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      } as Record<string, unknown>
    );
    const trimmed = stdout.trim();

    let offer = "";
    try {
      const parsed = JSON.parse(trimmed);
      offer = parsed.offer ?? parsed.bolt12 ?? "";
    } catch {
      const match = trimmed.match(/(lno1[a-z0-9]+)/i);
      if (match) offer = match[1];
    }

    if (!offer) {
      return NextResponse.json(
        { error: "Could not parse BOLT12 offer from MDK output", raw: trimmed },
        { status: 500 }
      );
    }

    return NextResponse.json({ offer });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
