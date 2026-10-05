/**
 * INFRA — outbound HTTP for collectors. Always a timeout, never throws on a
 * non-2xx status (collectors decide what a status means), throws only when the
 * request itself could not complete.
 */

const USER_AGENT = 'NetSentry/0.1 (Agent App; passive security monitor)';

function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/.exec(url);
  return m ? m[1] : url;
}

function createHttp() {
  return {
    getJson(url, opts) {
      const o = opts || {};
      const headers = Object.assign({ 'user-agent': USER_AGENT }, o.headers || {});
      let res;
      try {
        res = $http.send({ url, method: 'GET', headers, timeout: o.timeout || 20 });
      } catch (err) {
        throw new Error(`Request to ${hostOf(url)} failed: ${err}`);
      }
      let json = null;
      try {
        json = res.json;
      } catch (_) {
        json = null;
      }
      return {
        status: res.statusCode,
        json,
        get text() {
          return toString(res.body);
        },
        /** One response header (first value), '' when absent. Header names are matched case-insensitively. */
        header(name) {
          const want = String(name).toLowerCase();
          const all = res.headers || {};
          for (const k of Object.keys(all)) {
            if (k.toLowerCase() !== want) continue;
            const v = all[k];
            return Array.isArray(v) ? String(v[0] || '') : String(v || '');
          }
          return '';
        },
      };
    },
  };
}

module.exports = { createHttp };
