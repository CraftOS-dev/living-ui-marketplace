/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS request limits (per client address, per minute), replacing the
 * platform's loose defaults (`/api/ops/` 300 a minute is less than one busy
 * screen: Home, Next and a deal board open in parallel).
 *
 * - Operations: 1,800 a minute (the ERP's and HR OS's figure).
 * - Sign-in and recovery stay tight against password and code guessing:
 *   login and accept-invite 30 a minute, recover 10.
 * - Setup (`setup.status` is read on every page load) 300.
 * - People reach the app through CraftBot's LAN relay or tunnel from
 *   loopback, so the limits follow the address the relay forwards.
 */
migrate(
  (app) => {
    const s = app.settings();
    s.trustedProxy.headers = ['Cf-Connecting-Ip', 'X-Forwarded-For'];
    s.trustedProxy.useLeftmostIP = true;
    s.rateLimits.enabled = true;
    s.rateLimits.rules = [
      { label: '*:auth', maxRequests: 240, duration: 60 },
      { label: '/api/collections/', maxRequests: 1200, duration: 60 },
      { label: 'POST /api/ops/auth/login', maxRequests: 30, duration: 60 },
      { label: 'POST /api/ops/auth/accept-invite', maxRequests: 30, duration: 60 },
      { label: 'POST /api/ops/auth/recover', maxRequests: 10, duration: 60 },
      { label: '/api/ops/setup/', maxRequests: 300, duration: 60 },
      { label: '/api/ops/', maxRequests: 1800, duration: 60 },
      { label: '/api/_console', maxRequests: 120, duration: 60 },
      { label: '/api/_coverage', maxRequests: 600, duration: 60 },
    ];
    app.save(s);
  },
  (app) => {
    const s = app.settings();
    s.rateLimits.rules = [
      { label: '*:auth', maxRequests: 30, duration: 60 },
      { label: '/api/collections/', maxRequests: 1200, duration: 60 },
      { label: '/api/ops/', maxRequests: 300, duration: 60 },
      { label: '/api/_console', maxRequests: 120, duration: 60 },
      { label: '/api/_coverage', maxRequests: 600, duration: 60 },
    ];
    app.save(s);
  },
);
