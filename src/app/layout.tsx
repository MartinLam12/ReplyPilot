import type { Metadata } from "next";
import "./globals.css";
import { ClientLayout } from "./client-layout";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "ReplyPilot — AI Email Assistant for Boxing Gyms",
  description:
    "Reply to leads faster and follow up after every class. AI-drafted emails, Gmail integration, and automated follow-ups — built for boxing and martial arts gyms.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col bg-surface-50">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
