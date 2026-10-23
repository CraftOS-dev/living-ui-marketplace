/// <reference path="../pb_data/types.d.ts" />
/**
 * Parameter expressions: a small formal grammar, parsed, never pattern-matched.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := power (('*' | '/') power)*
 *   power  := unary ('^' unary)?
 *   unary  := '-' unary | atom
 *   atom   := number | name | name '(' expr (',' expr)* ')' | '(' expr ')'
 *
 * Names are parameters of the same part, or the constant `pi`. Functions:
 * min, max, abs, round, floor, ceil, sqrt, sin, cos, tan, asin, acos, atan
 * (angles in degrees). Millimetres and degrees throughout; no unit suffixes.
 */

const FUNCS = {
  min: { n: -1, f: (a) => Math.min.apply(null, a) },
  max: { n: -1, f: (a) => Math.max.apply(null, a) },
  abs: { n: 1, f: (a) => Math.abs(a[0]) },
  round: { n: 1, f: (a) => Math.round(a[0]) },
  floor: { n: 1, f: (a) => Math.floor(a[0]) },
  ceil: { n: 1, f: (a) => Math.ceil(a[0]) },
  sqrt: { n: 1, f: (a) => Math.sqrt(a[0]) },
  sin: { n: 1, f: (a) => Math.sin((a[0] * Math.PI) / 180) },
  cos: { n: 1, f: (a) => Math.cos((a[0] * Math.PI) / 180) },
  tan: { n: 1, f: (a) => Math.tan((a[0] * Math.PI) / 180) },
  asin: { n: 1, f: (a) => (Math.asin(a[0]) * 180) / Math.PI },
  acos: { n: 1, f: (a) => (Math.acos(a[0]) * 180) / Math.PI },
  atan: { n: 1, f: (a) => (Math.atan(a[0]) * 180) / Math.PI },
};

function exprError(message) {
  const err = new Error(message);
  err.exprError = true;
  return err;
}

function isDigit(c) {
  return c >= '0' && c <= '9';
}

function isIdentStart(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdent(c) {
  return isIdentStart(c) || isDigit(c);
}

function tokenize(text) {
  const s = String(text);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(s.charAt(i + 1)))) {
      let j = i;
      while (j < s.length && (isDigit(s.charAt(j)) || s.charAt(j) === '.')) j++;
      if (j < s.length && (s.charAt(j) === 'e' || s.charAt(j) === 'E')) {
        let k = j + 1;
        if (s.charAt(k) === '+' || s.charAt(k) === '-') k++;
        if (isDigit(s.charAt(k))) {
          j = k;
          while (j < s.length && isDigit(s.charAt(j))) j++;
        }
      }
      const raw = s.slice(i, j);
      const n = Number(raw);
      if (!isFinite(n)) throw exprError('"' + raw + '" is not a number');
      out.push({ t: 'num', v: n, at: i });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < s.length && isIdent(s.charAt(j))) j++;
      out.push({ t: 'name', v: s.slice(i, j), at: i });
      i = j;
      continue;
    }
    if ('+-*/^(),'.indexOf(c) >= 0) {
      out.push({ t: c, at: i });
      i++;
      continue;
    }
    throw exprError('unexpected "' + c + '" at position ' + (i + 1));
  }
  return out;
}

function parse(text) {
  const toks = tokenize(text);
  if (toks.length === 0) throw exprError('the expression is empty');
  let p = 0;
  const peek = () => toks[p];
  const take = (t) => {
    const k = toks[p];
    if (k === undefined || k.t !== t) throw exprError('expected "' + t + '"' + (k ? ' at position ' + (k.at + 1) : ' at the end'));
    p++;
    return k;
  };
  function expr() {
    let node = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = toks[p++].t;
      node = { op: op, a: node, b: term() };
    }
    return node;
  }
  function term() {
    let node = power();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = toks[p++].t;
      node = { op: op, a: node, b: power() };
    }
    return node;
  }
  function power() {
    const base = unary();
    if (peek() && peek().t === '^') {
      p++;
      return { op: '^', a: base, b: unary() };
    }
    return base;
  }
  function unary() {
    if (peek() && peek().t === '-') {
      p++;
      return { op: 'neg', a: unary() };
    }
    if (peek() && peek().t === '+') {
      p++;
      return unary();
    }
    return atom();
  }
  function atom() {
    const k = peek();
    if (k === undefined) throw exprError('the expression ends too early');
    if (k.t === 'num') {
      p++;
      return { num: k.v };
    }
    if (k.t === 'name') {
      p++;
      if (peek() && peek().t === '(') {
        p++;
        const fn = FUNCS[k.v];
        if (fn === undefined) throw exprError('unknown function "' + k.v + '"; functions: ' + Object.keys(FUNCS).join(', '));
        const args = [expr()];
        while (peek() && peek().t === ',') {
          p++;
          args.push(expr());
        }
        take(')');
        if (fn.n > 0 && args.length !== fn.n) throw exprError(k.v + ' takes ' + fn.n + ' value' + (fn.n === 1 ? '' : 's'));
        return { fn: k.v, args: args };
      }
      return { name: k.v };
    }
    if (k.t === '(') {
      p++;
      const inner = expr();
      take(')');
      return inner;
    }
    throw exprError('unexpected "' + k.t + '" at position ' + (k.at + 1));
  }
  const tree = expr();
  if (p < toks.length) throw exprError('unexpected "' + (toks[p].t === 'name' || toks[p].t === 'num' ? toks[p].v : toks[p].t) + '" at position ' + (toks[p].at + 1));
  return tree;
}

/** The parameter names an expression uses (pi excluded). */
function names(text) {
  const out = [];
  const walk = (n) => {
    if (n.name !== undefined) {
      if (n.name !== 'pi' && out.indexOf(n.name) < 0) out.push(n.name);
    } else if (n.fn !== undefined) {
      for (const a of n.args) walk(a);
    } else if (n.op !== undefined) {
      walk(n.a);
      if (n.b !== undefined) walk(n.b);
    }
  };
  walk(parse(text));
  return out;
}

/** Evaluate with `env` (name -> number). Throws exprError on unknown names or non-finite results. */
function evaluate(text, env) {
  const tree = typeof text === 'string' ? parse(text) : text;
  const ev = (n) => {
    if (n.num !== undefined) return n.num;
    if (n.name !== undefined) {
      if (n.name === 'pi') return Math.PI;
      if (!Object.prototype.hasOwnProperty.call(env, n.name)) throw exprError('unknown parameter "' + n.name + '"');
      return env[n.name];
    }
    if (n.fn !== undefined) return FUNCS[n.fn].f(n.args.map(ev));
    const a = ev(n.a);
    if (n.op === 'neg') return -a;
    const b = ev(n.b);
    if (n.op === '+') return a + b;
    if (n.op === '-') return a - b;
    if (n.op === '*') return a * b;
    if (n.op === '/') {
      if (b === 0) throw exprError('division by zero');
      return a / b;
    }
    return Math.pow(a, b);
  };
  const v = ev(tree);
  if (!isFinite(v)) throw exprError('the result is not a finite number');
  return v;
}

/** The same expression with parameter `from` renamed to `to` (token by token, nothing else changes). */
function rename(text, from, to) {
  const s = String(text);
  const toks = tokenize(s);
  let out = '';
  let pos = 0;
  for (const k of toks) {
    if (k.t === 'name' && k.v === from) {
      const after = toks[toks.indexOf(k) + 1];
      if (after !== undefined && after.t === '(') continue;
      out += s.slice(pos, k.at) + to;
      pos = k.at + from.length;
    }
  }
  return out + s.slice(pos);
}

/** True when text is just a plain number. */
function isPlain(text) {
  const toks = tokenize(text);
  return (toks.length === 1 && toks[0].t === 'num') || (toks.length === 2 && toks[0].t === '-' && toks[1].t === 'num');
}

module.exports = { parse: parse, names: names, evaluate: evaluate, isPlain: isPlain, rename: rename, FUNCS: Object.keys(FUNCS) };
