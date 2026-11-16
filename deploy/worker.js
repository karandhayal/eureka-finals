// Cloudflare Worker: serve ecell.in/eureka-finals/* from GitHub Pages (karandhayal.github.io/eureka-finals/).
// Route: ecell.in/eureka-finals*
const ORIGIN = 'https://karandhayal.github.io';
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/eureka-finals') return Response.redirect(url.origin + '/eureka-finals/' + url.search, 301);
    const target = ORIGIN + url.pathname + url.search;
    const res = await fetch(target, { method: request.method, redirect: 'manual' });
    return new Response(res.body, res);
  },
};
