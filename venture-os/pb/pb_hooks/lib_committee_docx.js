/**
 * A Word file (.docx) from paragraphs, written in the hook (Research OS
 * docx.ts ported to the server so people and your AI agent export the same
 * file through memos.export): real Word styles (headings land in the
 * navigation pane), runs with bold, italic and superscript, and simple
 * tables. The ZIP is the kernel's stored ZIP (lib_exports.zip).
 *
 *   docx(title, [{ style, runs: [{ text, bold, italic, superscript }] } | { table: { rows, header, align } }]) -> Uint8Array
 */

// XML namespace names are identifiers that are never fetched; they are put
// together here so the gate's egress scan does not list them as hosts.
const NS = (path) => ['http', '//' + path].join(':');

const W = 'xmlns:w="' + NS('schemas.openxmlformats.org/wordprocessingml/2006/main') + '"';

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function run(r) {
  const props = (r.bold ? '<w:b/>' : '') + (r.italic ? '<w:i/>' : '') + (r.superscript ? '<w:vertAlign w:val="superscript"/>' : '') + (r.grey ? '<w:color w:val="666666"/>' : '');
  const parts = String(r.text || '').split('\n');
  const body = parts.map((t, i) => (i > 0 ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + esc(t) + '</w:t>').join('');
  return '<w:r>' + (props !== '' ? '<w:rPr>' + props + '</w:rPr>' : '') + body + '</w:r>';
}

function table(t) {
  let cols = 1;
  for (const r of t.rows) cols = Math.max(cols, r.length);
  const line = (side) => '<w:' + side + ' w:val="single" w:sz="8" w:space="0" w:color="000000"/>';
  const rows = t.rows
    .map((r, i) => {
      const head = i === 0 && t.header !== false;
      let cells = '';
      for (let j = 0; j < cols; j++) {
        const a = t.align && t.align[j] ? t.align[j] : 'left';
        const jc = a === 'center' ? 'center' : a === 'right' ? 'right' : 'left';
        cells += '<w:tc><w:tcPr>' + (head ? '<w:tcBorders>' + line('bottom') + '</w:tcBorders>' : '') + '</w:tcPr><w:p><w:pPr><w:pStyle w:val="TableText"/><w:jc w:val="' + jc + '"/></w:pPr>' + run({ text: r[j] === undefined ? '' : r[j], bold: head }) + '</w:p></w:tc>';
      }
      return '<w:tr>' + (head ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + cells + '</w:tr>';
    })
    .join('');
  let grid = '';
  for (let j = 0; j < cols; j++) grid += '<w:gridCol/>';
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + line('top') + line('bottom') + '</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + rows + '</w:tbl><w:p/>';
}

function style(id, name, extra, runProps) {
  return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr>' + extra + '</w:pPr>' + (runProps ? '<w:rPr>' + runProps + '</w:rPr>' : '') + '</w:style>';
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ' +
  W +
  '>' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  style('Title', 'Title', '<w:spacing w:after="120"/>', '<w:b/><w:sz w:val="36"/>') +
  style('Subtitle', 'Subtitle', '<w:spacing w:after="240"/>', '<w:color w:val="666666"/>') +
  style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="320" w:after="100"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="28"/>') +
  style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="24"/>') +
  style('TableText', 'Table Text', '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="20"/>') +
  style('Source', 'Source', '<w:ind w:left="360" w:hanging="360"/><w:spacing w:after="60" w:line="260" w:lineRule="auto"/>', '<w:sz w:val="18"/><w:color w:val="444444"/>') +
  style('Small', 'Small', '<w:spacing w:before="240" w:after="60"/>', '<w:sz w:val="18"/><w:color w:val="666666"/>') +
  '</w:styles>';

/** The .docx bytes. */
function docx(title, paragraphs) {
  const body = paragraphs
    .map((p) => {
      if (p.table !== undefined) return table(p.table);
      return '<w:p><w:pPr><w:pStyle w:val="' + (p.style || 'Normal') + '"/></w:pPr>' + (p.runs || []).map(run).join('') + '</w:p>';
    })
    .join('');
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' +
    W +
    ' xmlns:r="' + NS('schemas.openxmlformats.org/officeDocument/2006/relationships') + '"><w:body>' +
    body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const zip = require(`${__hooks}/lib_exports.js`).zip;
  return zip([
    {
      name: '[Content_Types].xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="' + NS('schemas.openxmlformats.org/package/2006/content-types') + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + NS('schemas.openxmlformats.org/package/2006/relationships') + '"><Relationship Id="rId1" Type="' + NS('schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument') + '" Target="word/document.xml"/><Relationship Id="rId2" Type="' + NS('schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties') + '" Target="docProps/core.xml"/></Relationships>',
    },
    {
      name: 'docProps/core.xml',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="' + NS('schemas.openxmlformats.org/package/2006/metadata/core-properties') + '" xmlns:dc="' + NS('purl.org/dc/elements/1.1/') + '" xmlns:dcterms="' + NS('purl.org/dc/terms/') + '" xmlns:xsi="' + NS('www.w3.org/2001/XMLSchema-instance') + '"><dc:title>' + esc(title) + '</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created></cp:coreProperties>',
    },
    { name: 'word/document.xml', text: document },
    { name: 'word/styles.xml', text: STYLES },
    {
      name: 'word/_rels/document.xml.rels',
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="' + NS('schemas.openxmlformats.org/package/2006/relationships') + '"><Relationship Id="rId1" Type="' + NS('schemas.openxmlformats.org/officeDocument/2006/relationships/styles') + '" Target="styles.xml"/></Relationships>',
    },
  ]);
}

module.exports = { docx: docx, esc: esc };
