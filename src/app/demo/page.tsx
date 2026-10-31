import type { Metadata } from "next";
import { DemoRedirect } from "./demo-redirect";

export const metadata: Metadata = {
  title: "Demo Account | Money Nest",
  description: "Test all features in Money Nest with a fully loaded demo workspace.",
};

export default function DemoPage() {
  return <DemoRedirect />;
}
