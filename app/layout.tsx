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
      <body>{children}</body>
    </html>
  );
}
