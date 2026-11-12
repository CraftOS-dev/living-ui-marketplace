/// <reference path="../pb_data/types.d.ts" />
/**
 * Email renderer for agent operations (campaigns.preview).
 *
 * A line-for-line port of the renderer the app's Review tab uses, which runs
 * in the browser: frontend/src/app/services/apiAdapter.ts, "Email renderer
 * (port of email_renderer.render_email)" (renderBlock, renderBlocksText,
 * renderEmail and their helpers). Same inputs give the same HTML and text.
 * Keep it in step with that file.
 */

function str(v) {
  return v == null ? '' : String(v);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback === undefined ? 0 : fallback;
}

// apiAdapter.ts esc()
function esc(s) {
  return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FONT_FAMILIES = {
  system: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
  serif: "Georgia,'Times New Roman',Times,serif",
  mono: "'JetBrains Mono','Fira Code',Consolas,monospace",
};
const TEXT_SIZE_PX = { small: 14, normal: 16, large: 18 };
const IMAGE_WIDTH_VAL = { small: '240px', medium: '400px', full: '100%' };

// apiAdapter.ts safeColor()
function safeColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (v.startsWith('#') && (v.length === 4 || v.length === 7) && /^#[0-9a-fA-F]+$/.test(v)) return v;
  const m = v.match(/rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/);
  if (m) {
    const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
    const hex = (x) => {
      const h = x.toString(16).toUpperCase();
      return h.length < 2 ? '0' + h : h;
    };
    return '#' + hex(r) + hex(g) + hex(b);
  }
  return fallback;
}

// apiAdapter.ts designColor()
function designColor(design, key, fallback) {
  return safeColor(design[key], fallback);
}

// apiAdapter.ts designFont()
function designFont(design) {
  const fam = design.fontFamily;
  if (typeof fam === 'string' && fam in FONT_FAMILIES) return FONT_FAMILIES[fam];
  return FONT_FAMILIES.system;
}

// apiAdapter.ts substitute()
function substitute(text, ctx) {
  let out = text || '';
  for (const k of Object.keys(ctx)) out = out.split('{' + k + '}').join(ctx[k] || '');
  return out;
}

// apiAdapter.ts alignOf()
function alignOf(value, fallback) {
  const fb = fallback === undefined ? 'left' : fallback;
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  return v === 'left' || v === 'center' || v === 'right' ? v : fb;
}

// apiAdapter.ts renderBlock()
function renderBlock(block, ctx, design) {
  const bt = (str(block.type) || 'text').toLowerCase();
  if (bt === 'heading') {
    const level = Math.max(1, Math.min(num(block.level, 1), 3));
    const text = substitute(str(block.text), ctx);
    const size = level === 1 ? '28px' : level === 2 ? '22px' : '18px';
    const align = alignOf(block.align);
    const color = safeColor(block.color, designColor(design, 'headingColor', '#171717'));
    return `<h${level} style="margin:0 0 16px 0;font-size:${size};line-height:1.3;font-weight:700;color:${color};text-align:${align};">${text}</h${level}>`;
  }
  if (bt === 'text') {
    const text = substitute(str(block.text), ctx);
    const sizeKey = typeof block.size === 'string' && block.size in TEXT_SIZE_PX ? block.size : 'normal';
    const fontPx = TEXT_SIZE_PX[sizeKey];
    const align = alignOf(block.align);
    const color = safeColor(block.color, designColor(design, 'textColor', '#262626'));
    const bodyText = text.replace(/\n/g, '<br>');
    if (!bodyText.trim()) return '<p style="margin:0 0 16px 0;">&nbsp;</p>';
    return `<p style="margin:0 0 16px 0;font-size:${fontPx}px;line-height:1.6;color:${color};text-align:${align};">${bodyText}</p>`;
  }
  if (bt === 'image') {
    const url = str(block.url);
    if (!url || !(url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))) return '';
    const align = alignOf(block.align, 'center');
    const widthKey = typeof block.width === 'string' && block.width in IMAGE_WIDTH_VAL ? block.width : 'full';
    const widthCss = IMAGE_WIDTH_VAL[widthKey];
    return `<div style="margin:0 0 16px 0;text-align:${align};"><img src="${esc(url)}" alt="${esc(block.alt)}" style="max-width:100%;width:${widthCss};height:auto;border-radius:8px;display:inline-block;" /></div>`;
  }
  if (bt === 'button') {
    const label = esc(substitute(str(block.label) || 'Click here', ctx));
    let url = str(block.url) || '#';
    if (!(url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:') || url.startsWith('{'))) url = '#';
    const align = alignOf(block.align, 'center');
    const bg = safeColor(block.backgroundColor, designColor(design, 'buttonBg', '#FF4F18'));
    const fg = safeColor(block.textColor, designColor(design, 'buttonTextColor', '#FFFFFF'));
    return `<div style="margin:24px 0;text-align:${align};"><a href="${esc(url)}" style="display:inline-block;background:${bg};color:${fg};padding:12px 28px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">${label}</a></div>`;
  }
  if (bt === 'divider') {
    const color = safeColor(block.color, '#EAEAEA');
    return `<hr style="border:none;border-top:1px solid ${color};margin:24px 0;" />`;
  }
  if (bt === 'spacer') {
    const height = Math.max(4, Math.min(num(block.height, 16), 128));
    return `<div style="height:${height}px;line-height:1px;">&nbsp;</div>`;
  }
  if (bt === 'html') return substitute(str(block.html), ctx);
  return '';
}

// apiAdapter.ts renderBlocksText()
function renderBlocksText(blocks, ctx) {
  const out = [];
  const strip = (s) => s.replace(/(<br\s*\/?>)/gi, '\n').replace(/<[^>]+>/g, '');
  for (const block of blocks) {
    const bt = (str(block.type) || 'text').toLowerCase();
    if (bt === 'heading') {
      out.push(strip(substitute(str(block.text), ctx)).toUpperCase(), '');
    } else if (bt === 'text') {
      out.push(strip(substitute(str(block.text), ctx)), '');
    } else if (bt === 'button') {
      out.push(`${substitute(str(block.label) || 'Click here', ctx)}: ${str(block.url)}`, '');
    } else if (bt === 'image') {
      out.push(`[${str(block.alt) || 'image'}]`, '');
    } else if (bt === 'divider') {
      out.push('---', '');
    } else if (bt === 'html') {
      out.push(substitute(str(block.html).replace(/<[^>]+>/g, ''), ctx), '');
    }
  }
  return out.join('\n').trim();
}

// apiAdapter.ts renderEmail()
function renderEmail(opts) {
  const design = opts.design || {};
  const emailBg = designColor(design, 'emailBg', '#F5F5F5');
  const cardBg = designColor(design, 'cardBg', '#FFFFFF');
  const textColor = designColor(design, 'textColor', '#262626');
  const fontFamily = designFont(design);

  const body = (opts.blocks || [])
    .map((b) => renderBlock(b || {}, opts.context, design))
    .filter(Boolean)
    .join('');
  const orgName = opts.organizationName;
  const orgAddr = opts.organizationAddress;
  const orgLine =
    orgName || orgAddr
      ? `<div style="margin-bottom:6px;">${esc(orgName)}${orgName && orgAddr ? ' · ' : ''}${esc(orgAddr)}</div>`
      : '';
  const footer = `${orgLine}<div>Created by Newsletter Tool livingUI</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${emailBg};font-family:${fontFamily};color:${textColor};">
<div style="display:none;font-size:1px;color:${emailBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(substitute(opts.preheader || '', opts.context))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${emailBg};padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${cardBg};border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
<tr><td style="padding:32px 32px 8px 32px;">
${body || '<p style="margin:0;">(Empty email)</p>'}
</td></tr>
<tr><td style="padding:24px 32px 32px 32px;border-top:1px solid #EAEAEA;font-size:12px;color:#737373;line-height:1.5;">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  let text = renderBlocksText(opts.blocks || [], opts.context);
  text +=
    orgName || orgAddr
      ? `\n\n---\n${(orgName + ' · ' + orgAddr).replace(/^ ·|·\s*$/g, '').trim()}\n`
      : '\n\n---\n';
  text += 'Created by Newsletter Tool livingUI\n';
  return { html: html, text: text };
}

module.exports = { renderEmail: renderEmail, esc: esc };
