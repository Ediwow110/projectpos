import type { JSX, ReactNode } from "react";
import type { Metadata } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexPOS — Retail operations, under control.",
  description: "Premium point-of-sale and retail operations workspace.",
  icons: {
    icon: "/brand/nexpos-mark.svg",
    shortcut: "/brand/nexpos-mark.svg",
    apple: "/brand/nexpos-mark.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
