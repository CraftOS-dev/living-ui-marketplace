/**
 * Email delivery helpers: block → HTML rendering, RFC-822 MIME building and
 * base64url encoding (Goja has no btoa/Buffer), plus the Gmail send call
 * through the CraftBot integration bridge.
 */
function b64url(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = [];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 128) bytes.push(code);
    else if (code < 2048) bytes.push(192 | (code >> 6), 128 | (code & 63));
    else bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += chars[a >> 2] + chars[((a & 3) << 4) | ((b || 0) >> 4)];
    out += b === undefined ? '=' : chars[((b & 15) << 2) | ((c || 0) >> 6)];
    out += c === undefined ? '=' : chars[c & 63];
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Render the campaign's blocks (or plain body) as a simple email HTML body. */
function renderHtml(blocks, body) {
  const parts = [];
  if (Array.isArray(blocks) && blocks.length > 0) {
    for (const block of blocks) {
      if (block.type === 'heading') {
        parts.push('<h2 style="margin:24px 0 8px;font:600 20px system-ui,sans-serif">' + escapeHtml(block.text) + '</h2>');
      } else if (block.type === 'button') {
        parts.push(
          '<p style="margin:20px 0"><a href="' + escapeHtml(block.url || '#') +
            '" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;' +
            'text-decoration:none;font:500 14px system-ui,sans-serif">' +
            escapeHtml(block.text || 'Click here') + '</a></p>',
        );
      } else if (block.type === 'divider') {
        parts.push('<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">');
      } else {
        parts.push(
          '<p style="margin:12px 0;font:400 15px/1.6 system-ui,sans-serif;color:#111">' +
            escapeHtml(block.text).replace(/\n/g, '<br>') + '</p>',
        );
      }
    }
  } else {
    parts.push(
      '<p style="margin:12px 0;font:400 15px/1.6 system-ui,sans-serif;color:#111">' +
        escapeHtml(body).replace(/\n/g, '<br>') + '</p>',
    );
  }
  return (
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff;padding:24px;border-radius:8px">' +
    parts.join('\n') +
    '</div></body></html>'
  );
}

/** Send one email via the CraftBot Gmail integration. Returns {ok, detail}. */
function sendViaGmail(to, fromName, fromEmail, subject, html) {
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const from = fromEmail ? (fromName ? `${fromName} <${fromEmail}>` : fromEmail) : '';
  const headers = [
    'To: ' + to,
    from !== '' ? 'From: ' + from : null,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
  ]
    .filter((line) => line !== null)
    .join('\r\n');
  const mime = headers + '\r\n\r\n' + html;
  try {
    const res = bridge.callIntegration('gmail', 'POST', '/gmail/v1/users/me/messages/send', {
      raw: b64url(mime),
    });
    if (res && res.status >= 200 && res.status < 300) return { ok: true, detail: '' };
    const detail = res && res.error ? String(res.error) : 'Gmail returned status ' + (res ? res.status : '?');
    return { ok: false, detail: detail.slice(0, 380) };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 380) };
  }
}

module.exports = { b64url, renderHtml, sendViaGmail };
