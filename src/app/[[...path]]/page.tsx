import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FinanceApp } from "@/components/finance-app";
import { NOT_FOUND_METADATA, resolveAppPage } from "@/lib/page-metadata";

type Props = { params: Promise<{ path?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const route = resolveAppPage((await params).path);
  if (!route) return NOT_FOUND_METADATA;
  return { title: route.title, description: route.description };
}

export default async function Page({ params }: Props) {
  if (!resolveAppPage((await params).path)) notFound();
  return <FinanceApp />;
}
