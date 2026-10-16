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
      { url: "/icon.svg?v=brand-v2", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.ico?v=brand-v2", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
    ],
    apple: {
      url: "/apple-touch-icon.png?v=brand-v2",
      sizes: "180x180",
      type: "image/png",
    },
  },
};
export const viewport: Viewport = {
  themeColor: "#155E50",
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
