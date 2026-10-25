// AGENT_CITY_PORT lets a second copy (or a machine that already uses 4317) pick another port.
export const PORT = Number(process.env.AGENT_CITY_PORT) || 4317;

export const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

// Rejects any request whose Host header is not exactly this app's own local
// origin. Binding to 127.0.0.1 keeps other machines out; this check also
// stops a malicious web page from reaching the API through DNS rebinding
// (its requests carry the attacker's hostname in Host). Without it, such a
// page could POST to /api/agents/:id/run and spawn `claude` with
// `--permission-mode bypassPermissions`. The Vite dev proxy uses
// `changeOrigin: true`, which rewrites Host to `localhost:4317`.
export function requireLocalHost(allowedHosts = ALLOWED_HOSTS) {
  return (req, res, next) => {
    if (allowedHosts.has(req.headers.host)) {
      return next();
    }
    res.status(403).json({ error: 'Forbidden: requests must target localhost' });
  };
}
