/**
 * Test fixtures written by code (no binary files in the repo):
 *   deckPdf()  a two-page PDF: page 1 has a real text layer (Helvetica),
 *              page 2 is a picture only (an image XObject, no text: needs OCR)
 *   deckPptx() a two-slide PPTX (Office Open XML, stored zip)
 */
import { deflateRawSync } from 'node:zlib';

export const DECK_LINES = ['Acme Robotics', 'We raise USD 3M seed to build warehouse robots.', 'ARR 1.2M, growing 15 percent month on month.'];

function pdfFrom(objects) {
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += i + 1 + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

export function deckPdf(lines = DECK_LINES) {
  let text = '';
  lines.forEach((l, i) => {
    text += 'BT /F1 ' + (i === 0 ? 20 : 12) + ' Tf 72 ' + (720 - i * 28) + ' Td (' + l.replace(/[()\\]/g, (c) => '\\' + c) + ') Tj ET\n';
  });
  const pic = 'q 300 0 0 200 72 400 cm /Im1 Do Q\n';
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]).toString('latin1');
  return pdfFrom([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + text.length + ' >>\nstream\n' + text + 'endstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 6 0 R >>',
    '<< /Length ' + pic.length + ' >>\nstream\n' + pic + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n' + pixels + '\nendstream',
  ]);
}

/* A minimal zip writer (deflate), enough for an OOXML package. */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8');
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function deckPptx() {
  const slide = (texts) =>
    '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>' +
    texts.map((t) => '<p:sp><p:txBody><a:p><a:r><a:t>' + t.replace(/&/g, '&amp;') + '</a:t></a:r></a:p></p:txBody></p:sp>').join('') +
    '</p:spTree></p:cSld></p:sld>';
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>'],
    ['ppt/_rels/presentation.xml.rels', '<?xml version="1.0"?><Relationships><Relationship Id="rId2" Target="slides/slide2.xml"/><Relationship Id="rId3" Target="slides/slide1.xml"/></Relationships>'],
    ['ppt/slides/slide1.xml', slide(['Beta Labs', 'Seed round & team'])],
    ['ppt/slides/slide2.xml', slide(['Traction: 40 customers'])],
  ]);
}
