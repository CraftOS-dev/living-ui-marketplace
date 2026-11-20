/// <reference path="../pb_data/types.d.ts" />
/**
 * Craft Sheets formula engine — server-side port for agent operations.
 *
 * PORT OF: frontend/src/app/services/formula.ts (the engine the View runs in
 * the browser on every sheet read/write, via apiAdapter.withValues()). It must
 * stay behaviour-identical to that file: same grammar, same coercions, same
 * error codes, same 10-decimal output rounding. Any change to formula.ts must be
 * mirrored here (the parity test compares both on a shared corpus).
 *
 * Differences are only those needed to run in PocketBase's goja JSVM:
 *   - the sticky, named-group TOKEN_RE is replaced by an equivalent hand-written
 *     scanner (same alternation order, ECMAScript whitespace set);
 *   - replaceAll -> split/join; [...s].length -> explicit code-point count;
 *   - trim / lower-case use explicit ECMAScript / ASCII helpers so goja's Go
 *     string functions cannot change a result;
 *   - Math.min(...xs) -> pairwise Math.min (same NaN / -0 behaviour);
 *   - a recursion-depth guard stands in for V8's stack overflow (which formula.ts
 *     turns into #ERROR!), so a very long reference chain cannot exhaust the
 *     server's stack.
 * No require() in here: the evaluator is a hot path.
 */

/* ------------------------------------------------------------------ errors */

/** formula.ts `class FormulaError` (an error code that becomes a cell error). */
function FormulaError(code) {
  this.code = code;
}

/** formula.ts `class ErrorValue` (an error value that propagates through refs). */
function ErrorValue(code) {
  this.code = code;
}

/** Stand-in for V8's RangeError on stack overflow: NOT a FormulaError. */
function DepthExceeded() {
  this.message = 'Maximum call stack size exceeded';
}

/* Deepest nested cell evaluation allowed. In V8 (Node 24) formula.ts overflows
 * its stack after ~3,400 cells of a plain `=A2+1` chain (~800 when each link
 * goes through a function such as SUM); browsers vary. Past it the cell is
 * #ERROR!, as with the browser's stack overflow. */
var MAX_DEPTH = 3400;

/* -------------------------------------------------------- string helpers */

/** ECMAScript WhiteSpace + LineTerminator (what String.prototype.trim and \s use). */
function isEsSpace(c) {
  return (
    c === 0x09 || c === 0x0a || c === 0x0b || c === 0x0c || c === 0x0d || c === 0x20 ||
    c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 ||
    c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff
  );
}

/** String.prototype.trim with the ECMAScript whitespace set. */
function esTrim(s) {
  var a = 0;
  var b = s.length;
  while (a < b && isEsSpace(s.charCodeAt(a))) a++;
  while (b > a && isEsSpace(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

var NON_ASCII = /[^\x00-\x7f]/;
/** Does s contain a UTF-16 unit in [lo, hi]? (cheaper than a regex test in goja) */
function hasCharIn(s, lo, hi) {
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= lo && c <= hi) return true;
  }
  return false;
}

/**
 * Lower-case for comparisons against ASCII words ("true", "inf", ...). JS's
 * toLowerCase() maps a string to one of those words only from ASCII letters,
 * so an ASCII-only fold gives the same equality results on any runtime.
 */
function asciiLower(s) {
  if (!hasCharIn(s, 65, 90)) return s;
  if (!NON_ASCII.test(s)) return s.toLowerCase(); // identical on ASCII
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s.charAt(i);
  }
  return out;
}

/** ASCII upper-case (refs and identifiers are ASCII by the grammar). */
function asciiUpper(s) {
  if (!hasCharIn(s, 97, 122)) return s;
  if (!NON_ASCII.test(s)) return s.toUpperCase(); // identical on ASCII
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    out += c >= 97 && c <= 122 ? String.fromCharCode(c - 32) : s.charAt(i);
  }
  return out;
}

/** [...s].length — number of code points (surrogate pairs count once). */
function codePointLength(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/* ------------------------------------------------------ A1 reference helpers */

var REF_RE = /^([A-Z]+)([0-9]+)$/;

/** formula.ts columnLetter: 0-based column index -> letters. 0 -> 'A', 26 -> 'AA'. */
function columnLetter(index) {
  if (index < 0) {
    throw new Error('column index must be >= 0');
  }
  var letters = '';
  var n = index + 1;
  while (n > 0) {
    var rem = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    letters = String.fromCharCode(65 + rem) + letters;
  }
  return letters;
}

/** formula.ts letterToIndex. */
function letterToIndex(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 65 + 1);
  }
  return n - 1;
}

/** formula.ts parseRef: 'B3' -> [1, 2]. Throws #REF! on a bad ref. */
function parseRef(ref) {
  var m = REF_RE.exec(asciiUpper(ref));
  if (!m) {
    throw new FormulaError('#REF!');
  }
  var col = letterToIndex(m[1]);
  var row = parseInt(m[2], 10) - 1;
  if (row < 0) {
    throw new FormulaError('#REF!');
  }
  return [col, row];
}

/* ----------------------------------------------------------------- tokenizer */

function isDigit(c) {
  return c >= 48 && c <= 57;
}
function isIdentStart(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}
function isIdentPart(c) {
  return isIdentStart(c) || isDigit(c);
}
/** Characters JS regex `.` does not match. */
function isLineTerminator(c) {
  return c === 0x0a || c === 0x0d || c === 0x2028 || c === 0x2029;
}

var SINGLE_OPS = '-+*/^()&,:<>=';

/**
 * formula.ts tokenize(). Equivalent to the sticky regex
 *   \s+ | (?<number>\d+\.\d+|\.\d+|\d+) | (?<string>"(?:[^"\\]|\\.)*")
 *       | (?<ident>[A-Za-z_][A-Za-z0-9_]*) | (?<op><=|>=|<>|[-+*\/^()&,:<>=])
 * tried in that order at each position; no match -> #ERROR!.
 */
function tokenize(text) {
  var tokens = [];
  var pos = 0;
  var n = text.length;
  while (pos < n) {
    var c = text.charCodeAt(pos);
    // \s+
    if (isEsSpace(c)) {
      while (pos < n && isEsSpace(text.charCodeAt(pos))) pos++;
      continue;
    }
    // number: \d+\.\d+ | \.\d+ | \d+
    if (isDigit(c)) {
      var p = pos;
      while (p < n && isDigit(text.charCodeAt(p))) p++;
      if (p < n && text.charCodeAt(p) === 46 && p + 1 < n && isDigit(text.charCodeAt(p + 1))) {
        var q = p + 1;
        while (q < n && isDigit(text.charCodeAt(q))) q++;
        tokens.push({ kind: 'number', value: text.slice(pos, q) });
        pos = q;
      } else {
        tokens.push({ kind: 'number', value: text.slice(pos, p) });
        pos = p;
      }
      continue;
    }
    if (c === 46) {
      if (pos + 1 < n && isDigit(text.charCodeAt(pos + 1))) {
        var r = pos + 1;
        while (r < n && isDigit(text.charCodeAt(r))) r++;
        tokens.push({ kind: 'number', value: text.slice(pos, r) });
        pos = r;
        continue;
      }
      throw new FormulaError('#ERROR!');
    }
    // string: "(?:[^"\\]|\\.)*"
    if (c === 34) {
      var s = pos + 1;
      var closed = -1;
      while (s < n) {
        var sc = text.charCodeAt(s);
        if (sc === 34) {
          closed = s;
          break;
        }
        if (sc === 92) {
          if (s + 1 < n && !isLineTerminator(text.charCodeAt(s + 1))) {
            s += 2;
            continue;
          }
          break; // `\` + end / line terminator: the string alternative fails
        }
        s++;
      }
      if (closed < 0) throw new FormulaError('#ERROR!');
      tokens.push({ kind: 'string', value: text.slice(pos, closed + 1) });
      pos = closed + 1;
      continue;
    }
    // ident
    if (isIdentStart(c)) {
      var t = pos + 1;
      while (t < n && isIdentPart(text.charCodeAt(t))) t++;
      tokens.push({ kind: 'ident', value: text.slice(pos, t) });
      pos = t;
      continue;
    }
    // op: <= >= <> then single characters
    if (pos + 1 < n) {
      var two = text.slice(pos, pos + 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        tokens.push({ kind: 'op', value: two });
        pos += 2;
        continue;
      }
    }
    if (SINGLE_OPS.indexOf(text.charAt(pos)) >= 0) {
      tokens.push({ kind: 'op', value: text.charAt(pos) });
      pos += 1;
      continue;
    }
    throw new FormulaError('#ERROR!');
  }
  tokens.push({ kind: 'eof', value: '' });
  return tokens;
}

var EOF = { kind: 'eof', value: '' };

/** formula.ts rangeRefs. */
function rangeRefs(node) {
  var a = parseRef(node.start);
  var b = parseRef(node.end);
  var loC = Math.min(a[0], b[0]);
  var hiC = Math.max(a[0], b[0]);
  var loR = Math.min(a[1], b[1]);
  var hiR = Math.max(a[1], b[1]);
  var out = [];
  for (var r = loR; r <= hiR; r++) {
    for (var c = loC; c <= hiC; c++) {
      out.push(columnLetter(c) + (r + 1));
    }
  }
  return out;
}

/* -------------------------------------------------------------------- parser */

var COMPARISON_OPS = ['=', '<>', '<', '<=', '>', '>='];

/** formula.ts class Parser (recursive descent). */
function Parser(tokens) {
  this.tokens = tokens;
  this.i = 0;
}
Parser.prototype.peek = function () {
  var t = this.tokens[this.i];
  return t !== undefined ? t : EOF;
};
Parser.prototype.advance = function () {
  var t = this.peek();
  this.i += 1;
  return t;
};
Parser.prototype.expect = function (value) {
  if (this.peek().value !== value) {
    throw new FormulaError('#ERROR!');
  }
  return this.advance();
};
Parser.prototype.parse = function () {
  var node = this.parseComparison();
  if (this.peek().kind !== 'eof') {
    throw new FormulaError('#ERROR!');
  }
  return node;
};
Parser.prototype.parseComparison = function () {
  var node = this.parseConcat();
  while (COMPARISON_OPS.indexOf(this.peek().value) >= 0) {
    var op = this.advance().value;
    node = { k: 'bin', op: op, left: node, right: this.parseConcat() };
  }
  return node;
};
Parser.prototype.parseConcat = function () {
  var node = this.parseAdd();
  while (this.peek().value === '&') {
    this.advance();
    node = { k: 'bin', op: '&', left: node, right: this.parseAdd() };
  }
  return node;
};
Parser.prototype.parseAdd = function () {
  var node = this.parseMul();
  while (this.peek().value === '+' || this.peek().value === '-') {
    var op = this.advance().value;
    node = { k: 'bin', op: op, left: node, right: this.parseMul() };
  }
  return node;
};
Parser.prototype.parseMul = function () {
  var node = this.parseUnary();
  while (this.peek().value === '*' || this.peek().value === '/') {
    var op = this.advance().value;
    node = { k: 'bin', op: op, left: node, right: this.parseUnary() };
  }
  return node;
};
Parser.prototype.parseUnary = function () {
  var tok = this.peek();
  if (tok.value === '+' || tok.value === '-') {
    this.advance();
    return { k: 'unary', op: tok.value, operand: this.parseUnary() };
  }
  return this.parsePower();
};
Parser.prototype.parsePower = function () {
  var base = this.parsePrimary();
  if (this.peek().value === '^') {
    this.advance();
    // right-associative
    return { k: 'bin', op: '^', left: base, right: this.parseUnary() };
  }
  return base;
};
Parser.prototype.parsePrimary = function () {
  var tok = this.peek();
  if (tok.kind === 'number') {
    this.advance();
    return { k: 'num', value: Number(tok.value) };
  }
  if (tok.kind === 'string') {
    this.advance();
    return { k: 'str', value: unquote(tok.value) };
  }
  if (tok.value === '(') {
    this.advance();
    var inner = this.parseComparison();
    this.expect(')');
    return inner;
  }
  if (tok.kind === 'ident') {
    var ident = this.advance().value;
    if (this.peek().value === '(') {
      this.advance();
      var args = [];
      if (this.peek().value !== ')') {
        args.push(this.parseArgument());
        while (this.peek().value === ',') {
          this.advance();
          args.push(this.parseArgument());
        }
      }
      this.expect(')');
      return { k: 'func', name: asciiUpper(ident), args: args };
    }
    var upper = asciiUpper(ident);
    if (upper === 'TRUE' || upper === 'FALSE') {
      return { k: 'num', value: upper === 'TRUE' ? 1.0 : 0.0 };
    }
    return this.cellOrRange(ident);
  }
  throw new FormulaError('#ERROR!');
};
Parser.prototype.parseArgument = function () {
  return this.parseComparison();
};
Parser.prototype.cellOrRange = function (ident) {
  if (!REF_RE.test(asciiUpper(ident))) {
    throw new FormulaError('#NAME?');
  }
  if (this.peek().value === ':') {
    this.advance();
    var end = this.peek();
    if (end.kind !== 'ident' || !REF_RE.test(asciiUpper(end.value))) {
      throw new FormulaError('#REF!');
    }
    this.advance();
    return { k: 'range', start: asciiUpper(ident), end: asciiUpper(end.value) };
  }
  return { k: 'cell', ref: asciiUpper(ident) };
};

/** formula.ts unquote (replaceAll -> split/join, same order). */
function unquote(literal) {
  var inner = literal.slice(1, -1);
  return inner.split('\\"').join('"').split('\\\\').join('\\');
}

function parseFormula(text) {
  return new Parser(tokenize(text)).parse();
}

/* --------------------------------------------- Python-compatible float() */

var PYFLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** formula.ts pyFloat: emulates Python float(str); null where Python raises. */
function pyFloat(raw) {
  var s = esTrim(raw);
  if (s === '') {
    return null;
  }
  var body = s.length <= 9 ? asciiLower(s) : s;
  var sign = 1;
  if (body.charAt(0) === '+') {
    body = body.slice(1);
  } else if (body.charAt(0) === '-') {
    sign = -1;
    body = body.slice(1);
  }
  if (body === 'inf' || body === 'infinity') {
    return sign * Infinity;
  }
  if (body === 'nan') {
    return NaN;
  }
  if (PYFLOAT_RE.test(s)) {
    return Number(s);
  }
  return null;
}

/* -------------------------------------------------------- evaluation context */

/** formula.ts class Context: memoized, cycle-detecting cell evaluation. */
function Context(rawCells) {
  this.raw = rawCells;
  this.cache = new Map();
  this.visiting = new Set();
  this.errors = {};
  this.depth = 0;
}
Context.prototype.cellValue = function (refIn) {
  var ref = asciiUpper(refIn);
  var cached = this.cache.get(ref);
  if (cached !== undefined || this.cache.has(ref)) {
    return cached;
  }
  if (this.visiting.has(ref)) {
    throw new FormulaError('#CIRC!');
  }
  var raw = Object.prototype.hasOwnProperty.call(this.raw, ref) ? this.raw[ref] : undefined;
  if (raw === undefined || raw === '') {
    this.cache.set(ref, null);
    return null;
  }

  this.visiting.add(ref);
  this.depth += 1;
  var value;
  try {
    if (this.depth > MAX_DEPTH) throw new DepthExceeded();
    if (raw.charAt(0) === '=') {
      var node = parseFormula(raw.slice(1));
      value = evaluate(node, this);
    } else {
      value = literalValue(raw);
    }
  } catch (exc) {
    if (exc instanceof FormulaError) {
      value = new ErrorValue(exc.code);
      this.errors[ref] = exc.code;
    } else {
      value = new ErrorValue('#ERROR!');
      this.errors[ref] = '#ERROR!';
    }
  } finally {
    this.visiting.delete(ref);
    this.depth -= 1;
  }

  this.cache.set(ref, value);
  return value;
};

/** formula.ts literalValue: number if numeric, bool for TRUE/FALSE, else string. */
function literalValue(raw) {
  var s = esTrim(raw);
  if (s === '') {
    return null;
  }
  var low = s.length === 4 || s.length === 5 ? asciiLower(s) : s;
  if (low === 'true') {
    return true;
  }
  if (low === 'false') {
    return false;
  }
  var n = pyFloat(s);
  if (n !== null) {
    return n;
  }
  return raw;
}

/* ------------------------------------------------------------------ evaluator */

function evaluate(node, ctx) {
  switch (node.k) {
    case 'num':
      return node.value;
    case 'str':
      return node.value;
    case 'cell': {
      var val = ctx.cellValue(node.ref);
      if (val instanceof ErrorValue) {
        throw new FormulaError(val.code);
      }
      return val;
    }
    case 'range':
      throw new FormulaError('#VALUE!');
    case 'unary': {
      var operand = asNumber(evaluate(node.operand, ctx));
      return node.op === '-' ? -operand : operand;
    }
    case 'bin':
      return evalBinop(node, ctx);
    case 'func':
      return evalFunc(node, ctx);
  }
  throw new FormulaError('#ERROR!');
}

function evalBinop(node, ctx) {
  var op = node.op;
  if (op === '&') {
    return asText(evaluate(node.left, ctx)) + asText(evaluate(node.right, ctx));
  }
  if (COMPARISON_OPS.indexOf(op) >= 0) {
    var l = evaluate(node.left, ctx);
    var r = evaluate(node.right, ctx);
    return compare(op, l, r);
  }
  var left = asNumber(evaluate(node.left, ctx));
  var right = asNumber(evaluate(node.right, ctx));
  if (op === '+') return left + right;
  if (op === '-') return left - right;
  if (op === '*') return left * right;
  if (op === '/') {
    if (right === 0) {
      throw new FormulaError('#DIV/0!');
    }
    return left / right;
  }
  if (op === '^') return powChecked(left, right);
  throw new FormulaError('#ERROR!');
}

/** formula.ts powChecked. */
function powChecked(base, exp) {
  if (base === 0 && exp < 0) {
    throw new FormulaError('#DIV/0!');
  }
  var r = Math.pow(base, exp);
  if (!isFinite(r)) {
    throw new FormulaError('#NUM!');
  }
  return r;
}

/** formula.ts compare: numeric when both look numeric, else text. */
function compare(op, left, right) {
  var ln = maybeNumber(left);
  var rn = maybeNumber(right);
  var a;
  var b;
  if (ln !== null && rn !== null) {
    a = ln;
    b = rn;
  } else {
    a = asText(left);
    b = asText(right);
  }
  switch (op) {
    case '=':
      return a === b;
    case '<>':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
  }
  throw new FormulaError('#ERROR!');
}

/* ----- value coercion ----- */

function asNumber(value) {
  if (value instanceof ErrorValue) {
    throw new FormulaError(value.code);
  }
  if (value === null) return 0.0;
  if (typeof value === 'boolean') return value ? 1.0 : 0.0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    var n = pyFloat(value);
    if (n === null) {
      throw new FormulaError('#VALUE!');
    }
    return n;
  }
  throw new FormulaError('#VALUE!');
}

function maybeNumber(value) {
  if (typeof value === 'string' && esTrim(value) === '') {
    return null;
  }
  try {
    return asNumber(value);
  } catch (exc) {
    if (exc instanceof FormulaError) {
      return null;
    }
    throw exc;
  }
}

function asText(value) {
  if (value instanceof ErrorValue) {
    throw new FormulaError(value.code);
  }
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return formatNumber(value);
  return value;
}

function asBool(value) {
  if (value instanceof ErrorValue) {
    throw new FormulaError(value.code);
  }
  if (typeof value === 'boolean') return value;
  if (value === null) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    var low = asciiLower(esTrim(value));
    if (low === 'true') return true;
    if (low === 'false' || low === '') return false;
    return true;
  }
  return Boolean(value);
}

/* ----- functions ----- */

function collectNumbers(args, ctx) {
  var nums = [];
  for (var a = 0; a < args.length; a++) {
    var arg = args[a];
    if (arg.k === 'range') {
      var refs = rangeRefs(arg);
      for (var i = 0; i < refs.length; i++) {
        var val = ctx.cellValue(refs[i]);
        if (val instanceof ErrorValue) {
          throw new FormulaError(val.code);
        }
        var n = numberOrSkip(val);
        if (n !== null) nums.push(n);
      }
    } else {
      var v = evaluate(arg, ctx);
      var m = numberOrSkip(v);
      if (m !== null) nums.push(m);
    }
  }
  return nums;
}

function numberOrSkip(value) {
  if (value instanceof ErrorValue) {
    throw new FormulaError(value.code);
  }
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? 1.0 : 0.0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    var s = esTrim(value);
    if (s === '') return null;
    return pyFloat(s);
  }
  return null;
}

function countNonempty(args, ctx) {
  var count = 0;
  for (var a = 0; a < args.length; a++) {
    var arg = args[a];
    if (arg.k === 'range') {
      var refs = rangeRefs(arg);
      for (var i = 0; i < refs.length; i++) {
        var val = ctx.cellValue(refs[i]);
        if (val !== null && !(typeof val === 'string' && val === '')) count += 1;
      }
    } else {
      var v = evaluate(arg, ctx);
      if (v !== null && !(typeof v === 'string' && v === '')) count += 1;
    }
  }
  return count;
}

function sum(nums) {
  var acc = 0;
  for (var i = 0; i < nums.length; i++) acc = acc + nums[i];
  return acc;
}
function minOf(nums) {
  var m = nums[0];
  for (var i = 1; i < nums.length; i++) m = Math.min(m, nums[i]);
  return Math.min(m); // Math.min(x) normalises like Math.min(...[x])
}
function maxOf(nums) {
  var m = nums[0];
  for (var i = 1; i < nums.length; i++) m = Math.max(m, nums[i]);
  return Math.max(m);
}

function evalFunc(node, ctx) {
  var name = node.name;
  var args = node.args;
  var nums;
  if (name === 'SUM') {
    return sum(collectNumbers(args, ctx));
  }
  if (name === 'AVERAGE' || name === 'AVG') {
    nums = collectNumbers(args, ctx);
    if (nums.length === 0) throw new FormulaError('#DIV/0!');
    return sum(nums) / nums.length;
  }
  if (name === 'MIN') {
    nums = collectNumbers(args, ctx);
    return nums.length ? minOf(nums) : 0.0;
  }
  if (name === 'MAX') {
    nums = collectNumbers(args, ctx);
    return nums.length ? maxOf(nums) : 0.0;
  }
  if (name === 'COUNT') {
    return collectNumbers(args, ctx).length;
  }
  if (name === 'COUNTA') {
    return countNonempty(args, ctx);
  }
  if (name === 'PRODUCT') {
    nums = collectNumbers(args, ctx);
    if (nums.length === 0) return 0.0;
    var result = 1.0;
    for (var i = 0; i < nums.length; i++) result *= nums[i];
    return result;
  }
  if (name === 'MEDIAN') {
    nums = collectNumbers(args, ctx).slice().sort(function (a, b) {
      return a - b;
    });
    if (nums.length === 0) throw new FormulaError('#NUM!');
    var mid = Math.floor(nums.length / 2);
    if (nums.length % 2) return nums[mid];
    return (nums[mid - 1] + nums[mid]) / 2;
  }
  if (name === 'ROUND') {
    requireArgs(args, 1, 2);
    var value = asNumber(evaluate(args[0], ctx));
    var digits = args.length > 1 ? Math.trunc(asNumber(evaluate(args[1], ctx))) : 0;
    var factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }
  if (name === 'ABS') {
    requireArgs(args, 1, 1);
    return Math.abs(asNumber(evaluate(args[0], ctx)));
  }
  if (name === 'SQRT') {
    requireArgs(args, 1, 1);
    var sv = asNumber(evaluate(args[0], ctx));
    if (sv < 0) throw new FormulaError('#NUM!');
    return Math.pow(sv, 0.5);
  }
  if (name === 'POWER') {
    requireArgs(args, 2, 2);
    var base = asNumber(evaluate(args[0], ctx));
    var exp = asNumber(evaluate(args[1], ctx));
    return powChecked(base, exp);
  }
  if (name === 'MOD') {
    requireArgs(args, 2, 2);
    var x = asNumber(evaluate(args[0], ctx));
    var y = asNumber(evaluate(args[1], ctx));
    if (y === 0) throw new FormulaError('#DIV/0!');
    // Python modulo: result takes the sign of the divisor.
    return x - y * Math.floor(x / y);
  }
  if (name === 'LEN') {
    requireArgs(args, 1, 1);
    return codePointLength(asText(evaluate(args[0], ctx)));
  }
  if (name === 'CONCAT' || name === 'CONCATENATE') {
    var parts = [];
    for (var a = 0; a < args.length; a++) {
      var arg = args[a];
      if (arg.k === 'range') {
        var refs = rangeRefs(arg);
        for (var j = 0; j < refs.length; j++) parts.push(asText(ctx.cellValue(refs[j])));
      } else {
        parts.push(asText(evaluate(arg, ctx)));
      }
    }
    return parts.join('');
  }
  if (name === 'IF') {
    requireArgs(args, 2, 3);
    var cond = asBool(evaluate(args[0], ctx));
    if (cond) return evaluate(args[1], ctx);
    if (args.length > 2) return evaluate(args[2], ctx);
    return false;
  }
  if (name === 'AND') {
    var andVals = boolArgs(args, ctx);
    if (!andVals.length) return true;
    for (var k = 0; k < andVals.length; k++) if (!andVals[k]) return false;
    return true;
  }
  if (name === 'OR') {
    var orVals = boolArgs(args, ctx);
    if (!orVals.length) return false;
    for (var o = 0; o < orVals.length; o++) if (orVals[o]) return true;
    return false;
  }
  if (name === 'NOT') {
    requireArgs(args, 1, 1);
    return !asBool(evaluate(args[0], ctx));
  }
  throw new FormulaError('#NAME?');
}

function boolArgs(args, ctx) {
  var out = [];
  for (var a = 0; a < args.length; a++) {
    var arg = args[a];
    if (arg.k === 'range') {
      var refs = rangeRefs(arg);
      for (var i = 0; i < refs.length; i++) {
        var val = ctx.cellValue(refs[i]);
        if (val !== null && !(typeof val === 'string' && esTrim(val) === '')) {
          out.push(asBool(val));
        }
      }
    } else {
      out.push(asBool(evaluate(arg, ctx)));
    }
  }
  return out;
}

function requireArgs(args, lo, hi) {
  if (!(lo <= args.length && args.length <= hi)) {
    throw new FormulaError('#VALUE!');
  }
}

/* ------------------------------------------------- formatting + public API */

/** formula.ts formatNumber (text form of a number inside & / CONCAT / LEN). */
function formatNumber(value) {
  if (value !== value || value === Infinity || value === -Infinity) {
    return '#NUM!';
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 1e10) / 1e10);
}

/** formula.ts toJsonValue. */
function toJsonValue(value) {
  if (value instanceof ErrorValue) return value.code;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value !== value || value === Infinity || value === -Infinity) return '#NUM!';
    if (Number.isInteger(value)) return value;
    return Math.round(value * 1e10) / 1e10;
  }
  return value === null ? '' : value;
}

/**
 * formula.ts evaluateSheet(columns, numRows, cells) -> { values, errors }.
 * `cells` maps an A1 ref to a raw string or a { raw } object. Iteration order is
 * the cells object's key order (the JSON the record stores), as in the browser.
 */
function evaluateSheet(columns, numRows, cells) {
  var rawCells = {};
  var src = cells || {};
  var keys = Object.keys(src);
  for (var i = 0; i < keys.length; i++) {
    var ref = keys[i];
    var cell = src[ref];
    var rawVal;
    if (cell !== null && typeof cell === 'object' && !Array.isArray(cell)) {
      rawVal = cell['raw'];
      if (rawVal === undefined) rawVal = '';
    } else {
      rawVal = cell;
    }
    if (rawVal === null || rawVal === undefined) rawVal = '';
    var raw;
    if (typeof rawVal === 'string') raw = rawVal;
    else if (typeof rawVal === 'boolean') raw = rawVal ? 'True' : 'False';
    else raw = String(rawVal);
    rawCells[asciiUpper(String(ref))] = raw;
  }

  var ctx = new Context(rawCells);
  var values = {};
  var rkeys = Object.keys(rawCells);
  for (var j = 0; j < rkeys.length; j++) {
    var r = rkeys[j];
    if (rawCells[r] === '') continue;
    var val = ctx.cellValue(r);
    if (val === null) continue;
    values[r] = toJsonValue(val);
  }
  var errors = {};
  var ekeys = Object.keys(ctx.errors);
  for (var k = 0; k < ekeys.length; k++) errors[ekeys[k]] = ctx.errors[ekeys[k]];
  return { values: values, errors: errors };
}

module.exports = {
  evaluateSheet: evaluateSheet,
  columnLetter: columnLetter,
  esTrim: esTrim,
  asciiLower: asciiLower,
  MAX_DEPTH: MAX_DEPTH,
};
