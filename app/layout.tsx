import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Athena for Quilstead: Day-one readiness",
  description: "Demo case view. Simulated systems; nothing here contacts a real HRIS, IdP or Slack.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
