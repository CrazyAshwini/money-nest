import type { Metadata, Viewport } from "next";
import "./globals.css";
import { FinanceProvider } from "@/components/finance-provider";
export const metadata: Metadata = {
  title: "Personal Finance OS",
  description:
    "A clearer picture of your money. Private accounts, spending, bills and goals.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
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
        <FinanceProvider>{children}</FinanceProvider>
      </body>
    </html>
  );
}
