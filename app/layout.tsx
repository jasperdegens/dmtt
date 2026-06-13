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
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Alegreya+Sans:wght@400;500;700&family=Pirata+One&family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
