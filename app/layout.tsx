import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dead Men Tell Tales",
  description:
    "A dead man's switch for encrypted documents on Hedera + World ID + Ledger + drand.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Hero/brand display = Pirata One (kept). Engraved labels + buttons = Cinzel
            (a Roman inscriptional face that reads like brass/stone engraving). Running
            body + chat + fields = EB Garamond (Cinzel's canonical companion — a warm,
            highly legible old-book serif that replaces the muddier IM Fell English). */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Pirata+One&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
