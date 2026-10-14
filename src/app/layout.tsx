import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FinanceProvider } from "@/components/finance-provider";
import { testFixturesEnabled } from "@/lib/test-fixtures";
export const metadata: Metadata = {
  applicationName: "Money Nest",
  title: { default: "Money Nest", template: "%s | Money Nest" },
  description:
    "Manage your accounts, spending, bills, orders and refunds together in your Money Nest finance workspace.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.ico", type: "image/x-icon", sizes: "32x32" },
    ],
    apple: {
      url: "/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
    },
  },
};
export const viewport: Viewport = {
  themeColor: "#111113",
  width: "device-width",
  initialScale: 1,
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <FinanceProvider allowTestFixtures={testFixturesEnabled()}>
          {children}
        </FinanceProvider>
      </body>
    </html>
  );
}
