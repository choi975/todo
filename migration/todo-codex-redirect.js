const TARGET_ORIGIN = "https://todo.choi975.workers.dev";

export default {
  async fetch(request) {
    const sourceUrl = new URL(request.url);
    const targetUrl = new URL(sourceUrl.pathname + sourceUrl.search, TARGET_ORIGIN);

    if (sourceUrl.pathname.startsWith("/api/")) {
      return fetch(new Request(targetUrl, request));
    }

    return Response.redirect(targetUrl.toString(), 308);
  },
};
