/** Unauthenticated liveness probe (Onesecondafter /healthz piece). */
function attachHealthz(server) {
  server.middlewares.use((req, res, next) => {
    const path = String(req.url || '').split('?')[0];
    if (path !== '/healthz') return next();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'no-store');
    res.end('ok');
  });
}

export function healthzPlugin() {
  return {
    name: 'havoc-healthz',
    configureServer(server) {
      attachHealthz(server);
    },
    configurePreviewServer(server) {
      attachHealthz(server);
    },
  };
}
