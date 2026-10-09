import Link from "next/link";
export default function NotFound() {
  return (
    <main className="login">
      <h1>Page not found</h1>
      <Link href="/dashboard">Return to your dashboard</Link>
    </main>
  );
}
