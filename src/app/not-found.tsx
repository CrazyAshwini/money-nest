import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found-page">
      <section className="not-found-card" aria-labelledby="not-found-title">
        <Link
          href="/dashboard"
          className="brand"
          aria-label="Money Nest overview"
        >
          <span className="brand-icon" aria-hidden="true">
            M<span />
          </span>
          <span>Money Nest</span>
        </Link>
        <p className="eyebrow">404 · Page not found</p>
        <h1 id="not-found-title">Let's get you back home.</h1>
        <p>
          This page is unavailable. Use the overview to find your accounts,
          payments and orders.
        </p>
        <div className="page-actions">
          <Link href="/dashboard" className="button primary">
            Go to overview
          </Link>
          <Link href="/accounts" className="button">
            View accounts
          </Link>
        </div>
      </section>
    </main>
  );
}
