/// <reference path="../pb_data/types.d.ts" />
/**
 * Link previews: the title, description, site name and preview image of a
 * web page a person (or the AI agent) adds to a board.
 *
 *   YouTube  the video's title and channel from YouTube's oEmbed endpoint;
 *            the thumbnail is YouTube's still for that video id.
 *   Others   the page itself, read once: its Open Graph tags (og:title,
 *            og:description, og:image, og:site_name), else <title> and the
 *            description meta tag. Only the first 400 KB are read.
 *
 * Only public web addresses are read: names that point at this computer or
 * the local network (localhost, 10.x, 192.168.x, ...) are never fetched.
 * A page that does not answer within a few seconds simply has no preview;
 * adding the card never fails because of it.
 */

const OEMBED = 'https://www.youtube.com/oembed?format=json&url=';
const YT_STILL = 'https://i.ytimg.com/vi/';
const TIMEOUT = 6;
const MAX_HTML = 400000;

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase();
  if (h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '[::1]' || h === '::1' || h.indexOf('[') === 0) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The content of <meta property|name="key" content="..."> in either attribute order. */
function meta(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = new RegExp('<meta[^>]+(?:property|name)\\s*=\\s*["\']' + k + '["\'][^>]*?content\\s*=\\s*["\']([^"\']*)["\']', 'i').exec(html);
  if (a) return decode(a[1]);
  const b = new RegExp('<meta[^>]+content\\s*=\\s*["\']([^"\']*)["\'][^>]*?(?:property|name)\\s*=\\s*["\']' + k + '["\']', 'i').exec(html);
  return b ? decode(b[1]) : '';
}

/** A url found on a page, made absolute against the page's own url. */
function absolute(base, ref) {
  const r = String(ref || '').trim();
  if (r === '') return '';
  if (/^https?:\/\//i.test(r)) return r;
  if (r.indexOf('//') === 0) return (base.match(/^(https?):/i) || ['', 'https'])[1] + ':' + r;
  const origin = (base.match(/^(https?:\/\/[^/?#]+)/i) || ['', ''])[1];
  if (origin === '') return '';
  if (r.charAt(0) === '/') return origin + r;
  const dir = base.slice(origin.length).split('?')[0].split('#')[0].replace(/[^/]*$/, '');
  return origin + (dir.charAt(0) === '/' ? dir : '/') + r;
}

function youtube(url, id) {
  const out = { kind: 'youtube', title: '', description: '', site: 'YouTube', image: YT_STILL + id + '/hqdefault.jpg', author: '' };
  try {
    const res = $http.send({ url: OEMBED + encodeURIComponent(url), method: 'GET', timeout: TIMEOUT });
    if (res.statusCode === 200 && res.json) {
      out.title = decode(res.json.title || '');
      out.author = decode(res.json.author_name || '');
    }
  } catch (err) {
    console.log('[research-board] YouTube preview unavailable:', String(err));
  }
  return out;
}

/** The preview of a web page, or a preview with empty fields when it cannot be read. */
function preview(url) {
  const cards = require(`${__hooks}/lib_cards.js`);
  const empty = { kind: 'link', title: '', description: '', site: cards.hostOf(url), image: '', author: '' };
  const id = cards.youtubeId(url);
  if (id !== '') return youtube(url, id);
  if (isPrivateHost(hostOf(url))) return empty;
  try {
    const res = $http.send({
      url: url,
      method: 'GET',
      timeout: TIMEOUT,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ResearchBoard/1.0; link preview)', accept: 'text/html,application/xhtml+xml' },
    });
    if (res.statusCode < 200 || res.statusCode >= 400) return empty;
    const type = String((res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || '');
    if (type !== '' && type.toLowerCase().indexOf('html') < 0) return empty;
    const html = toString(res.body).slice(0, MAX_HTML);
    const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const site = meta(html, 'og:site_name');
    return {
      kind: 'link',
      title: (meta(html, 'og:title') || meta(html, 'twitter:title') || (titleTag ? decode(titleTag[1]) : '')).slice(0, 500),
      description: (meta(html, 'og:description') || meta(html, 'description') || meta(html, 'twitter:description')).slice(0, 1000),
      site: (site || cards.hostOf(url)).slice(0, 200),
      image: absolute(url, meta(html, 'og:image') || meta(html, 'og:image:url') || meta(html, 'twitter:image')).slice(0, 5000),
      author: (meta(html, 'author') || meta(html, 'article:author')).slice(0, 200),
    };
  } catch (err) {
    console.log('[research-board] link preview unavailable for', url, String(err));
    return empty;
  }
}

module.exports = {
  isPrivateHost: isPrivateHost,
  preview: preview,
  youtubeStill: (id) => YT_STILL + id + '/hqdefault.jpg',
};
