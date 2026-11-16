// Cloudflare Worker: serve ecell.in/eureka-finals/* from the Pages project.
// Route: ecell.in/eureka-finals*   Pages project built with BASE=/eureka-finals/ and deployed with its files inside an "eureka-finals" folder.
const ORIGIN = 'https://eureka-finals.pages.dev';
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/eureka-finals') return Response.redirect(url.origin + '/eureka-finals/' + url.search, 301);
    const target = ORIGIN + url.pathname + url.search;
    const res = await fetch(target, { method: request.method, headers: request.headers, redirect: 'manual' });
    return new Response(res.body, res);
  },
};
