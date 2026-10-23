/**
 * Parameter expressions, the same small grammar the app's operations use
 * (pb_hooks/lib_expr.js): numbers, parameter names, + - * / ^, parentheses,
 * pi, and min max abs round floor ceil sqrt sin cos tan asin acos atan
 * (degrees). The app shows what an expression evaluates to as it is typed.
 */

type Node =
  | { num: number }
  | { name: string }
  | { fn: string; args: Node[] }
  | { op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { op: 'neg'; a: Node };

interface Tok {
  t: string;
  v?: string | number;
  at: number;
}

const FUNCS: Record<string, { n: number; f: (a: number[]) => number }> = {
  min: { n: -1, f: (a) => Math.min(...a) },
  max: { n: -1, f: (a) => Math.max(...a) },
  abs: { n: 1, f: (a) => Math.abs(a[0] ?? 0) },
  round: { n: 1, f: (a) => Math.round(a[0] ?? 0) },
  floor: { n: 1, f: (a) => Math.floor(a[0] ?? 0) },
  ceil: { n: 1, f: (a) => Math.ceil(a[0] ?? 0) },
  sqrt: { n: 1, f: (a) => Math.sqrt(a[0] ?? 0) },
  sin: { n: 1, f: (a) => Math.sin(((a[0] ?? 0) * Math.PI) / 180) },
  cos: { n: 1, f: (a) => Math.cos(((a[0] ?? 0) * Math.PI) / 180) },
  tan: { n: 1, f: (a) => Math.tan(((a[0] ?? 0) * Math.PI) / 180) },
  asin: { n: 1, f: (a) => (Math.asin(a[0] ?? 0) * 180) / Math.PI },
  acos: { n: 1, f: (a) => (Math.acos(a[0] ?? 0) * 180) / Math.PI },
  atan: { n: 1, f: (a) => (Math.atan(a[0] ?? 0) * 180) / Math.PI },
};

const digit = (c: string): boolean => c >= '0' && c <= '9';
const identStart = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (digit(c) || (c === '.' && digit(s.charAt(i + 1)))) {
      let j = i;
      while (j < s.length && (digit(s.charAt(j)) || s.charAt(j) === '.')) j++;
      if (s.charAt(j) === 'e' || s.charAt(j) === 'E') {
        let k = j + 1;
        if (s.charAt(k) === '+' || s.charAt(k) === '-') k++;
        if (digit(s.charAt(k))) {
          j = k;
          while (j < s.length && digit(s.charAt(j))) j++;
        }
      }
      const n = Number(s.slice(i, j));
      if (!Number.isFinite(n)) throw new Error('"' + s.slice(i, j) + '" is not a number');
      out.push({ t: 'num', v: n, at: i });
      i = j;
      continue;
    }
    if (identStart(c)) {
      let j = i;
      while (j < s.length && (identStart(s.charAt(j)) || digit(s.charAt(j)))) j++;
      out.push({ t: 'name', v: s.slice(i, j), at: i });
      i = j;
      continue;
    }
    if ('+-*/^(),'.includes(c)) {
      out.push({ t: c, at: i });
      i++;
      continue;
    }
    throw new Error('unexpected "' + c + '"');
  }
  return out;
}

export function parse(text: string): Node {
  const toks = tokenize(text);
  if (toks.length === 0) throw new Error('empty');
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const take = (t: string): void => {
    if (peek()?.t !== t) throw new Error('expected "' + t + '"');
    p++;
  };
  const expr = (): Node => {
    let n = term();
    while (peek()?.t === '+' || peek()?.t === '-') {
      const op = toks[p++]?.t as '+' | '-';
      n = { op, a: n, b: term() };
    }
    return n;
  };
  const term = (): Node => {
    let n = power();
    while (peek()?.t === '*' || peek()?.t === '/') {
      const op = toks[p++]?.t as '*' | '/';
      n = { op, a: n, b: power() };
    }
    return n;
  };
  const power = (): Node => {
    const b = unary();
    if (peek()?.t === '^') {
      p++;
      return { op: '^', a: b, b: unary() };
    }
    return b;
  };
  const unary = (): Node => {
    if (peek()?.t === '-') {
      p++;
      return { op: 'neg', a: unary() };
    }
    if (peek()?.t === '+') {
      p++;
      return unary();
    }
    return atom();
  };
  const atom = (): Node => {
    const k = peek();
    if (k === undefined) throw new Error('ends too early');
    if (k.t === 'num') {
      p++;
      return { num: k.v as number };
    }
    if (k.t === 'name') {
      p++;
      if (peek()?.t === '(') {
        p++;
        const name = k.v as string;
        const fn = FUNCS[name];
        if (fn === undefined) throw new Error('unknown function ' + name);
        const args = [expr()];
        while (peek()?.t === ',') {
          p++;
          args.push(expr());
        }
        take(')');
        if (fn.n > 0 && args.length !== fn.n) throw new Error(name + ' takes ' + fn.n + ' value');
        return { fn: name, args };
      }
      return { name: k.v as string };
    }
    if (k.t === '(') {
      p++;
      const inner = expr();
      take(')');
      return inner;
    }
    throw new Error('unexpected "' + k.t + '"');
  };
  const tree = expr();
  if (p < toks.length) throw new Error('unexpected text at ' + ((toks[p]?.at ?? 0) + 1));
  return tree;
}

export function evaluate(text: string, env: Record<string, number>): number {
  const ev = (n: Node): number => {
    if ('num' in n) return n.num;
    if ('name' in n) {
      if (n.name === 'pi') return Math.PI;
      const v = env[n.name];
      if (v === undefined) throw new Error('unknown parameter ' + n.name);
      return v;
    }
    if ('fn' in n) return (FUNCS[n.fn] as { f: (a: number[]) => number }).f(n.args.map(ev));
    if (n.op === 'neg') return -ev(n.a);
    const a = ev(n.a);
    const b = ev(n.b);
    if (n.op === '+') return a + b;
    if (n.op === '-') return a - b;
    if (n.op === '*') return a * b;
    if (n.op === '/') {
      if (b === 0) throw new Error('division by zero');
      return a / b;
    }
    return a ** b;
  };
  const v = ev(parse(text));
  if (!Number.isFinite(v)) throw new Error('not a finite number');
  return v;
}

/** True when text is just a plain number. */
export function isPlain(text: string): boolean {
  return /^\s*-?(\d+(\.\d+)?|\.\d+)([eE][-+]?\d+)?\s*$/.test(text);
}

/** A stored numeric value (number or {"expr"}) as editable text. */
export function asText(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (v !== null && typeof v === 'object' && 'expr' in v && typeof (v as { expr: unknown }).expr === 'string') return (v as { expr: string }).expr;
  if (typeof v === 'string') return v;
  return '';
}

/** Editable text back to a stored value: a plain number, or {"expr"}. */
export function fromText(text: string): number | { expr: string } | null {
  const t = text.trim();
  if (t === '') return null;
  if (isPlain(t)) return Number(t);
  return { expr: t };
}

/** The number a stored value resolves to, or null when it cannot be evaluated. */
export function valueOf(v: unknown, env: Record<string, number>): number | null {
  if (typeof v === 'number') return v;
  const t = asText(v);
  if (t === '') return null;
  try {
    return evaluate(t, env);
  } catch {
    return null;
  }
}
