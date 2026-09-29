import type { Metadata } from "next";
import "./globals.css";
import "./pirate.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "PIRATEAGENT — AI Data Intelligence Platform",
  description: "Turn a simple business request into clean, structured, source-backed web data with PirateAgent.",
  icons: {
    icon: "/pirate/images/favicon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Web fonts: Inter, JetBrains Mono, Cormorant Garamond, Jost */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Jost:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
