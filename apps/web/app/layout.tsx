import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Arqen AI Studio" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Arqen <span>AI Studio</span>
          </Link>
          <span className="tagline">Article or script in, video out.</span>
          <nav style={{ marginLeft: "auto", display: "flex", gap: 18 }}>
            <Link href="/">Projects</Link>
            <Link href="/batch">Batch</Link>
            <Link href="/watcher">Watcher</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
