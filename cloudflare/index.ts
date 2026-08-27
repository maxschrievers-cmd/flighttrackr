interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ORIGIN_BASE_URL: string;
}

const CACHE_TTL_SECONDS = 5;

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Vary": "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

async function proxyApi(request: Request, env: Env): Promise<Response> {
  const incoming = new URL(request.url);
  const origin = new URL(env.ORIGIN_BASE_URL);
  origin.pathname = incoming.pathname;
  origin.search = incoming.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-FlightTrackr-Edge", "cloudflare-workers");

  const upstreamRequest = new Request(origin.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "follow",
  });

  const upstream = await fetch(upstreamRequest);
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("X-FlightTrackr-Edge", "cloudflare-workers");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");

  if (request.method === "GET" && incoming.pathname === "/api/nearby" && upstream.ok) {
    responseHeaders.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`);
  } else {
    responseHeaders.set("Cache-Control", "no-store");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await proxyApi(request, env);
      } catch (error) {
        console.error("FlightTrackr API proxy failed", error);
        return new Response(JSON.stringify({ error: "Upstream service unavailable" }), {
          status: 502,
          headers: new Headers({
            "Content-Type": "application/json; charset=utf-8",
            ...Object.fromEntries(corsHeaders(request)),
          }),
        });
      }
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return new Response(response.body, { status: response.status, headers });
  },
};
