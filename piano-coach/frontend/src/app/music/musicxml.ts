/**
 * Files in, ABC notation out: .abc / .txt as they are, MusicXML (.musicxml,
 * .xml, compressed .mxl, as exported by MuseScore, Sibelius, Finale,
 * Dorico and others) converted here. The result goes through the same check
 * as anything typed, so the person sees what was read before adding it.
 *
 * MusicXML: the first part (the piano) is read; each staff and voice
 * becomes an ABC voice; keys, metres, tempo, repeats and endings, ties,
 * chords, triplets, dynamics, fingering and staccato carry over. Grace and
 * cue notes are left out.
 */
import { strFromU8, unzipSync } from 'fflate';

export interface Imported {
  abc: string;
  title: string;
  composer: string;
  warnings: string[];
}

const MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];
const SHARPS = 'FCGDAEB';
const FLATS = 'BEADGCF';
const DYN = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'sfz', 'fp'];

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function keyName(fifths: number, mode: string): string {
  const i = Math.max(-7, Math.min(7, fifths)) + 7;
  return (mode === 'minor' ? MINOR[i] : MAJOR[i]) ?? 'C';
}

function keyAlters(fifths: number): Record<string, number> {
  const m: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (let i = 0; i < Math.abs(fifths) && i < 7; i++) m[(fifths > 0 ? SHARPS : FLATS)[i] ?? 'C'] = fifths > 0 ? 1 : -1;
  return m;
}

export async function importFile(file: File): Promise<Imported> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.abc') || name.endsWith('.txt')) {
    const abc = await file.text();
    const t = /^T:(.*)$/m.exec(abc);
    const c = /^C:(.*)$/m.exec(abc);
    return { abc, title: t?.[1]?.trim() ?? '', composer: c?.[1]?.trim() ?? '', warnings: [] };
  }
  if (name.endsWith('.mxl')) {
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    let path = '';
    const container = files['META-INF/container.xml'];
    if (container !== undefined) {
      const m = /full-path="([^"]+)"/.exec(strFromU8(container));
      if (m !== null) path = m[1] ?? '';
    }
    if (path === '' || files[path] === undefined) path = Object.keys(files).find((k) => !k.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(k)) ?? '';
    const data = files[path];
    if (data === undefined) throw new Error('This .mxl file has no score inside.');
    return fromMusicXml(strFromU8(data));
  }
  if (name.endsWith('.musicxml') || name.endsWith('.xml')) return fromMusicXml(await file.text());
  if (name.endsWith('.mid') || name.endsWith('.midi')) throw new Error('MIDI files carry no notation. Export MusicXML from your notation app, or ask the coach to add the song.');
  throw new Error('Choose an .abc, .musicxml, .xml or .mxl file.');
}

interface Item {
  t: number;
  dur: number;
  rest: boolean;
  pitches: { step: string; alter: number; oct: number; tie: boolean; finger: number }[];
  tie: boolean;
  tm: [number, number] | null;
  dyn: string;
  stacc: boolean;
}

interface MeasureOut {
  len: number;
  items: Map<string, Item[]>;
  forward: boolean;
  backward: boolean;
  ending: number;
  key: string | null;
  meter: string | null;
  meterLen: number;
}

function text(el: Element | null | undefined, sel: string): string {
  return el?.querySelector(sel)?.textContent?.trim() ?? '';
}

export function fromMusicXml(xml: string): Imported {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') !== null) throw new Error('This file is not valid MusicXML.');
  const root = doc.documentElement;
  if (root.nodeName === 'score-timewise') throw new Error('Timewise MusicXML is not supported; export partwise MusicXML.');
  if (root.nodeName !== 'score-partwise') throw new Error('This file is not a MusicXML score.');
  const warnings: string[] = [];
  const title = text(root, 'work > work-title') || text(root, 'movement-title') || text(root, 'credit-words');
  const composer = root.querySelector('identification > creator[type="composer"]')?.textContent?.trim() ?? '';
  const parts = Array.from(root.querySelectorAll(':scope > part'));
  if (parts.length === 0) throw new Error('This score has no parts.');
  const part = parts.find((p) => Number(text(p, 'attributes > staves') || '1') >= 2) ?? parts[0]!;
  if (parts.length > 1) warnings.push('Only one part (the piano) was imported.');

  let divisions = 1;
  let fifths = 0;
  let mode = 'major';
  let beats = 4;
  let beatType = 4;
  let tempo: number | null = null;
  let firstKey = '';
  let firstMeter = '';
  const clefs: Record<string, string> = { '1': 'treble', '2': 'bass' };
  const voices = new Map<string, { staff: string; voice: string }>();
  const measures: MeasureOut[] = [];
  let skippedGrace = false;

  for (const m of Array.from(part.querySelectorAll(':scope > measure'))) {
    const out: MeasureOut = { len: 0, items: new Map(), forward: false, backward: false, ending: 0, key: null, meter: null, meterLen: 0 };
    let pos = 0;
    let lastStart = 0;
    const lastItem = new Map<string, Item>();
    const pendingDyn = new Map<string, string>();
    for (const el of Array.from(m.children)) {
      const tag = el.nodeName;
      if (tag === 'attributes') {
        const d = text(el, 'divisions');
        if (d !== '') divisions = Number(d) || divisions;
        const f = text(el, 'key > fifths');
        if (f !== '') {
          fifths = Number(f) || 0;
          mode = text(el, 'key > mode') === 'minor' ? 'minor' : 'major';
          const k = keyName(fifths, mode);
          if (firstKey === '') firstKey = k;
          else out.key = k;
        }
        const b = text(el, 'time > beats');
        if (b !== '') {
          beats = Number(b.split('+')[0]) || 4;
          beatType = Number(text(el, 'time > beat-type')) || 4;
          const mt = `${beats}/${beatType}`;
          if (firstMeter === '') firstMeter = mt;
          else out.meter = mt;
        }
        for (const c of Array.from(el.querySelectorAll('clef'))) {
          const n = c.getAttribute('number') ?? '1';
          const sign = text(c, 'sign');
          clefs[n] = sign === 'F' ? 'bass' : 'treble';
        }
      } else if (tag === 'direction') {
        const staff = text(el, 'staff') || '1';
        const dyn = el.querySelector('direction-type > dynamics');
        if (dyn !== null) {
          const name = dyn.firstElementChild?.nodeName ?? '';
          if (DYN.includes(name)) pendingDyn.set(staff, name);
        }
        const snd = el.querySelector('sound[tempo]');
        if (snd !== null && tempo === null) tempo = Number(snd.getAttribute('tempo')) || null;
      } else if (tag === 'sound') {
        if (el.getAttribute('tempo') !== null && tempo === null) tempo = Number(el.getAttribute('tempo')) || null;
      } else if (tag === 'backup') pos -= Number(text(el, 'duration')) || 0;
      else if (tag === 'forward') pos += Number(text(el, 'duration')) || 0;
      else if (tag === 'barline') {
        const rep = el.querySelector('repeat')?.getAttribute('direction');
        if (rep === 'forward') out.forward = true;
        if (rep === 'backward') out.backward = true;
        const end = el.querySelector('ending');
        if (end !== null && end.getAttribute('type') === 'start') out.ending = Number((end.getAttribute('number') ?? '1').split(/[ ,]/)[0]) || 1;
      } else if (tag === 'note') {
        if (el.querySelector('grace') !== null) {
          skippedGrace = true;
          continue;
        }
        const chord = el.querySelector('chord') !== null;
        const dur = Number(text(el, 'duration')) || 0;
        const cue = el.querySelector('cue') !== null;
        const voice = text(el, 'voice') || '1';
        const staff = text(el, 'staff') || '1';
        const key = `${staff}:${voice}`;
        if (cue) {
          if (!chord) pos += dur;
          continue;
        }
        if (!voices.has(key)) voices.set(key, { staff, voice });
        const isRest = el.querySelector('rest') !== null;
        const tied = Array.from(el.querySelectorAll('tie')).some((x) => x.getAttribute('type') === 'start') || Array.from(el.querySelectorAll('notations > tied')).some((x) => x.getAttribute('type') === 'start');
        const finger = Number(text(el, 'notations > technical > fingering')) || 0;
        const pitch = isRest ? null : { step: text(el, 'pitch > step') || 'C', alter: Math.round(Number(text(el, 'pitch > alter') || '0')), oct: Number(text(el, 'pitch > octave') || '4'), tie: tied, finger };
        if (chord) {
          const prev = lastItem.get(key);
          if (prev !== undefined && pitch !== null) {
            prev.pitches.push(pitch);
            if (tied) prev.tie = true;
          }
          continue;
        }
        const am = text(el, 'time-modification > actual-notes');
        const nm = text(el, 'time-modification > normal-notes');
        const item: Item = { t: pos, dur, rest: isRest, pitches: pitch !== null ? [pitch] : [], tie: tied, tm: am !== '' && nm !== '' ? [Number(am), Number(nm)] : null, dyn: pendingDyn.get(staff) ?? '', stacc: el.querySelector('notations > articulations > staccato') !== null };
        pendingDyn.delete(staff);
        const list = out.items.get(key) ?? [];
        list.push(item);
        out.items.set(key, list);
        lastItem.set(key, item);
        lastStart = pos;
        pos += dur;
        out.len = Math.max(out.len, pos);
      }
      void lastStart;
    }
    out.meterLen = (beats * 4 * divisions) / beatType;
    // The divisions of this measure travel with it (they may change).
    (out as MeasureOut & { div: number }).div = divisions;
    (out as MeasureOut & { fifths: number }).fifths = fifths;
    measures.push(out);
  }
  if (skippedGrace) warnings.push('Grace notes were left out.');
  if (measures.length === 0) throw new Error('This score has no measures.');

  // Voice ids: RH, RH2 … on the upper staff; LH, LH2 … on the lower.
  const order = [...voices.entries()].sort((a, b) => Number(a[1].staff) - Number(b[1].staff) || Number(a[1].voice) - Number(b[1].voice));
  const ids = new Map<string, { id: string; clef: string; primary: boolean }>();
  const perStaff = new Map<string, number>();
  for (const [key, v] of order) {
    const n = (perStaff.get(v.staff) ?? 0) + 1;
    perStaff.set(v.staff, n);
    const base = v.staff === '1' ? 'RH' : v.staff === '2' ? 'LH' : `S${v.staff}`;
    ids.set(key, { id: n === 1 ? base : `${base}${n}`, clef: clefs[v.staff] ?? 'treble', primary: n === 1 });
  }
  if (ids.size > 6) throw new Error('This score has more than 6 voices on the piano part; simplify it in your notation app first.');

  /* --------------------------------------------------------- write ABC */
  const lengthText = (dur: number, div: number): string => {
    // L:1/16 → one unit is a sixteenth = div/4 divisions.
    let num = Math.round(dur * 4 * 1000);
    let den = Math.round(div * 1000);
    const g = gcd(num, den) || 1;
    num /= g;
    den /= g;
    if (num === den) return '';
    if (den === 1) return String(num);
    return (num === 1 ? '' : String(num)) + '/' + den;
  };
  const noteText = (p: Item['pitches'][number], acc: Record<string, number>, keyAlt: Record<string, number>): string => {
    const id = p.step + p.oct;
    const cur = acc[id] ?? keyAlt[p.step] ?? 0;
    let a = '';
    if (p.alter !== cur) {
      a = p.alter === 1 ? '^' : p.alter === 2 ? '^^' : p.alter === -1 ? '_' : p.alter === -2 ? '__' : '=';
      acc[id] = p.alter;
    }
    const letter = p.oct >= 5 ? p.step.toLowerCase() + "'".repeat(p.oct - 5) : p.step + ','.repeat(Math.max(0, 4 - p.oct));
    return a + letter;
  };

  const lines = new Map<string, string[]>();
  for (const [key] of ids) lines.set(key, []);
  let fif = 0;
  measures.forEach((ms) => {
    const div = (ms as MeasureOut & { div: number }).div;
    fif = (ms as MeasureOut & { fifths: number }).fifths;
    const keyAlt = keyAlters(fif);
    const len = Math.max(ms.len, ms.len > 0 && ms.len < ms.meterLen ? ms.len : ms.meterLen);
    for (const [key, meta] of ids) {
      const items = (ms.items.get(key) ?? []).slice().sort((a, b) => a.t - b.t);
      const acc: Record<string, number> = {};
      const parts: string[] = [];
      if (ms.key !== null) parts.push(`[K:${ms.key}]`);
      if (ms.meter !== null) parts.push(`[M:${ms.meter}]`);
      let cur = 0;
      let tupLeft = 0;
      let wrote = false;
      const gap = (to: number): void => {
        if (to - cur > 0.0001) {
          parts.push((meta.primary ? 'z' : 'x') + lengthText(to - cur, div));
          wrote = true;
        }
        cur = to;
      };
      for (const it of items) {
        if (it.t < cur - 0.0001) continue;
        gap(it.t);
        let shown = it.dur;
        let pre = '';
        if (it.tm !== null) {
          shown = (it.dur * it.tm[0]) / it.tm[1];
          if (tupLeft <= 0) {
            const [a, n] = it.tm;
            pre = a === 3 && n === 2 ? '(3' : `(${a}:${n}:${a}`;
            tupLeft = a;
          }
          tupLeft -= 1;
        } else tupLeft = 0;
        const deco = (it.dyn !== '' ? `!${it.dyn}!` : '') + (it.stacc ? '.' : '');
        let body: string;
        if (it.rest) body = (meta.primary ? 'z' : 'x') + lengthText(shown, div);
        else if (it.pitches.length === 1) {
          const p = it.pitches[0]!;
          body = (p.finger > 0 ? `!${p.finger}!` : '') + noteText(p, acc, keyAlt) + lengthText(shown, div) + (it.tie ? '-' : '');
        } else {
          const sorted = it.pitches.slice().sort((a, b) => a.oct * 12 + 'CDEFGAB'.indexOf(a.step) * 2 - (b.oct * 12 + 'CDEFGAB'.indexOf(b.step) * 2));
          body = '[' + sorted.map((p) => (p.finger > 0 ? `!${p.finger}!` : '') + noteText(p, acc, keyAlt)).join('') + ']' + lengthText(shown, div) + (it.tie ? '-' : '');
        }
        parts.push(pre + deco + body);
        wrote = true;
        cur = it.t + it.dur;
      }
      gap(len);
      if (!wrote) parts.push((meta.primary ? 'z' : 'x') + lengthText(len, div));
      lines.get(key)!.push(parts.join(' '));
    }
  });

  // Bar separators: repeats and endings at the start of each measure.
  const sep = (i: number): string => {
    const m = measures[i]!;
    const prev = i > 0 ? measures[i - 1] : undefined;
    let s = prev?.backward === true ? ':|' : '|';
    if (m.forward) s = prev?.backward === true ? '::' : '|:';
    if (m.ending > 0) s += `[${m.ending}`;
    return s;
  };
  const lastSep = measures[measures.length - 1]?.backward === true ? ':|' : '|]';
  const head = ['X:1', `T:${title || 'Imported score'}`];
  if (composer !== '') head.push(`C:${composer}`);
  head.push(`M:${firstMeter || '4/4'}`, 'L:1/16', `Q:1/4=${Math.round(tempo ?? 90)}`);
  for (const [, meta] of ids) head.push(`V:${meta.id} clef=${meta.clef}`);
  head.push(`K:${firstKey || 'C'}`);
  const body: string[] = [];
  const per = 4;
  for (let c = 0; c < measures.length; c += per) {
    for (const [key, meta] of ids) {
      const bars = lines.get(key)!;
      let line = `[V:${meta.id}]`;
      for (let i = c; i < Math.min(measures.length, c + per); i++) line += ` ${sep(i)} ${bars[i]}`;
      if (c + per >= measures.length) line += ` ${lastSep}`;
      body.push(line);
    }
  }
  return { abc: head.concat(body).join('\n') + '\n', title, composer, warnings };
}
