import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProjectSignal — Local projects worth chasing",
  description:
    "ProjectSignal scans planning applications and sends local businesses the projects most likely to need their services."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
