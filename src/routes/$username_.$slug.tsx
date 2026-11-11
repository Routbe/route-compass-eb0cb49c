import { createFileRoute } from "@tanstack/react-router";
import Page from "@/components/imported-pages/ShortLink";

/**
 * `rout.be/<handle>/<code>` — eigen korte link van een geverifieerd account.
 *
 * Eigen codes leven nooit in de root: ze hangen onder de handle van hun
 * eigenaar, zodat niemand een handle of systeemroute kan kapen. De slug in de
 * databank is exact dit pad zonder leading slash (`jdelplanche/apple`).
 */
export const Route = createFileRoute("/$username_/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params, next }) => {
        const { resolveShortLink, redirectResponse, rateLimitedResponse, pausedResponse } =
          await import("@/lib/short-link-redirect.server");
        const { RateLimitError } = await import("@/lib/rate-limit.server");
        const handle = params.username.replace(/^@/, "").toLowerCase();
        try {
          const result = await resolveShortLink(`${handle}/${params.slug}`, request);
          if (result?.status === "ok") return redirectResponse(result.targetUrl);
          if (result?.status === "paused") return pausedResponse(request);
        } catch (error) {
          if (error instanceof RateLimitError) {
            return rateLimitedResponse(error.retryAfterSeconds);
          }
        }
        // Front QR of the ROUT Card: rout.be/<handle>/<4 digits>. Scanning with a phone always opens
        // the public profile; partners check freshness via /api/public/card-check.
        if (/^\d{4}$/.test(params.slug) && /^[\w.-]{1,100}$/.test(handle)) {
          return new Response(null, { status: 302, headers: { location: `/${handle}`, "cache-control": "no-store" } });
        }
        return next();
      },
    },
  },
  head: () => ({
    meta: [
      { title: "ROUT" },
      { name: "description", content: "ROUT — QR-codes en korte links met karakter." },
      { property: "og:title", content: "ROUT" },
      { property: "og:description", content: "ROUT — QR-codes en korte links met karakter." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Page,
});
