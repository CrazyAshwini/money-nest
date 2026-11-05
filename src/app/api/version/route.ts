export const dynamic = "force-dynamic";

export async function GET() {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.BUILD_ID ||
    "v2.3";

  return Response.json(
    {
      version: commit.slice(0, 7),
      timestamp: Date.now(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
      },
    },
  );
}
