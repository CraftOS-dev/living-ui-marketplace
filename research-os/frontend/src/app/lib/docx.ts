/**
 * A Word file from the manuscript model the server exports (ms.export
 * --format docx): paragraphs with a style and runs (bold, italic,
 * superscript), pictures and tables. Real Word styles, so headings land in
 * the navigation pane, captions are captions and the references keep a
 * hanging indent. Maths stays as its LaTeX (Word has its own equation
 * format; the PDF typesets it).
 */
import { opUrl } from './api.ts';
import { zip } from './zip.ts';

export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  superscript?: boolean;
}

export interface DocxParagraph {
  style: string;
  runs: DocxRun[];
  /** A figure's picture: a repository file, at a share of the text width. */
  image?: { item: string; version: number; name: string; ext: string; width: number };
  /** A table: rows of cell texts, the first a header row when `header`. */
  table?: { rows: string[][]; header?: boolean; align?: ('left' | 'center' | 'right')[] };
}

/** A picture's bytes and size, fetched before the file is put together. */
export interface DocxPicture {
  data: Uint8Array;
  ext: 'png' | 'jpeg';
  width: number;
  height: number;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const keyOf = (img: NonNullable<DocxParagraph['image']>): string => img.item + ':' + img.version;

/** Fetch the pictures the paragraphs show (a picture that fails to load is left out). */
export async function docxMedia(paragraphs: DocxParagraph[]): Promise<Map<string, DocxPicture>> {
  const out = new Map<string, DocxPicture>();
  for (const p of paragraphs) {
    const img = p.image;
    if (img === undefined || out.has(keyOf(img))) continue;
    try {
      const res = await fetch(opUrl('repo.file', { item: img.item, version: img.version }), { credentials: 'include' });
      if (!res.ok) continue;
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      out.set(keyOf(img), { data: new Uint8Array(await blob.arrayBuffer()), ext: img.ext === 'png' ? 'png' : 'jpeg', width: bmp.width, height: bmp.height });
      bmp.close();
    } catch {
      /* left out */
    }
  }
  return out;
}

function run(r: DocxRun): string {
  const props = (r.bold ? '<w:b/>' : '') + (r.italic ? '<w:i/>' : '') + (r.superscript ? '<w:vertAlign w:val="superscript"/>' : '');
  // A line break inside a run (a table cell, a block of code) is a <w:br/>.
  const parts = r.text.split('\n');
  const body = parts.map((t, i) => (i > 0 ? '<w:br/>' : '') + (t.includes('\t') ? t.split('\t').map((x, j) => (j > 0 ? '<w:tab/>' : '') + `<w:t xml:space="preserve">${esc(x)}</w:t>`).join('') : `<w:t xml:space="preserve">${esc(t)}</w:t>`)).join('');
  return `<w:r>${props !== '' ? `<w:rPr>${props}</w:rPr>` : ''}${body}</w:r>`;
}

// The text width of an A4 page with 2.54 cm margins, in EMU (914400 to the inch).
const TEXT_WIDTH = Math.round(((11906 - 2 * 1440) / 1440) * 914400);

function picture(id: number, rel: string, pic: DocxPicture, share: number): string {
  const cx = Math.round((TEXT_WIDTH * Math.min(100, Math.max(10, share))) / 100);
  const cy = Math.round((cx * pic.height) / Math.max(1, pic.width));
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="figure${id}.${pic.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function table(t: NonNullable<DocxParagraph['table']>): string {
  const cols = Math.max(1, ...t.rows.map((r) => r.length));
  const line = (side: string): string => `<w:${side} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`;
  const rows = t.rows
    .map((r, i) => {
      const head = i === 0 && t.header !== false;
      const cells = Array.from({ length: cols }, (_, j) => {
        const jc = t.align?.[j] === 'center' ? 'center' : t.align?.[j] === 'right' ? 'right' : 'left';
        return `<w:tc><w:tcPr>${head ? `<w:tcBorders>${line('bottom')}</w:tcBorders>` : ''}</w:tcPr><w:p><w:pPr><w:pStyle w:val="TableText"/><w:jc w:val="${jc}"/></w:pPr>${run({ text: r[j] ?? '', bold: head })}</w:p></w:tc>`;
      }).join('');
      return `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
    })
    .join('');
  // Booktabs-style: a rule above and below, and one under the header row.
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblBorders>${line('top')}${line('bottom')}</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>${rows}</w:tbl><w:p/>`;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function style(id: string, name: string, extra: string, runProps = '', based = 'Normal'): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:next w:val="Normal"/><w:qFormat/><w:pPr>${extra}</w:pPr>${runProps !== '' ? `<w:rPr>${runProps}</w:rPr>` : ''}</w:style>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('Title', 'Title', '<w:jc w:val="center"/><w:spacing w:after="240"/>', '<w:b/><w:sz w:val="36"/>')}
${style('Authors', 'Authors', '<w:jc w:val="center"/><w:spacing w:after="360"/>')}
${style('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:sz w:val="28"/>')}
${style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/>', '<w:b/><w:sz w:val="26"/>')}
${style('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/>', '<w:b/><w:i/>')}
${style('Quote', 'Quote', '<w:ind w:left="720" w:right="720"/>', '<w:i/>')}
${style('ListBullet', 'List Bullet', '<w:ind w:left="720" w:hanging="360"/>')}
${style('ListNumber', 'List Number', '<w:ind w:left="720" w:hanging="360"/>')}
${style('Figure', 'Figure', '<w:keepNext/><w:jc w:val="center"/><w:spacing w:before="120" w:after="60"/>')}
${style('Caption', 'caption', '<w:spacing w:after="240" w:line="276" w:lineRule="auto"/>', '<w:sz w:val="20"/>')}
${style('TableText', 'Table Text', '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="20"/>')}
${style('Equation', 'Equation', '<w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs>')}
${style('Code', 'Code', '<w:spacing w:after="160" w:line="240" w:lineRule="auto"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/>')}
${style('Bibliography', 'Bibliography', '<w:ind w:left="720" w:hanging="720"/><w:spacing w:after="120" w:line="276" w:lineRule="auto"/>')}
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

export function docx(title: string, paragraphs: DocxParagraph[], media: Map<string, DocxPicture> = new Map()): Blob {
  const rels: { id: string; target: string }[] = [];
  const files: { name: string; data: Uint8Array }[] = [];
  const relOf = new Map<string, string>();
  let pics = 0;
  const body = paragraphs
    .map((p) => {
      if (p.table !== undefined) return table(p.table);
      const list = p.style === 'ListBullet' ? 1 : p.style === 'ListNumber' ? 2 : 0;
      const numPr = list > 0 ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${list}"/></w:numPr>` : '';
      let inner = p.runs.map(run).join('');
      const pic = p.image !== undefined ? media.get(keyOf(p.image)) : undefined;
      if (p.image !== undefined && pic !== undefined) {
        const key = keyOf(p.image);
        let rel = relOf.get(key);
        if (rel === undefined) {
          rel = 'rIdImg' + (relOf.size + 1);
          relOf.set(key, rel);
          const name = 'media/image' + relOf.size + '.' + pic.ext;
          rels.push({ id: rel, target: name });
          files.push({ name: 'word/' + name, data: pic.data });
        }
        inner = picture(++pics, rel, pic, p.image.width) + inner;
      } else if (p.image !== undefined) inner = run({ text: '[' + p.image.name + ']' }) + inner;
      return `<w:p><w:pPr><w:pStyle w:val="${p.style}"/>${numPr}</w:pPr>${inner}</w:p>`;
    })
    .join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return zip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: 'docProps/core.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
    },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: NUMBERING },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${r.target}"/>`).join('')}</Relationships>`,
    },
    ...files,
  ]);
}
