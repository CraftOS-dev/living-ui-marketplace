/**
 * Craft Sheets formula engine (TypeScript port of backend/formula.py).
 *
 * A small, dependency-free spreadsheet evaluator. It parses cell contents that
 * begin with `=` as formulas and evaluates them with:
 *
 *   - cell references (`A1`) and ranges (`A1:B5`)
 *   - arithmetic operators `+ - * / ^` with parentheses and unary minus
 *   - string concatenation with `&`
 *   - comparison operators `= <> < <= > >=` (return booleans)
 *   - functions: SUM, AVERAGE/AVG, MIN, MAX, COUNT, COUNTA, PRODUCT, ROUND,
 *     ABS, SQRT, POWER, MOD, MEDIAN, IF, AND, OR, NOT, CONCAT/CONCATENATE, LEN
 *
 * Evaluation is memoized and detects circular references. Errors are reported
 * per cell using Excel-style codes (`#DIV/0!`, `#CIRC!`, `#NAME?` …).
 *
 * This is a faithful, behaviour-identical port of the Python engine.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class FormulaError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** A cell value that is an error (so it can propagate through references). */
class ErrorValue {
  readonly code: string;
  constructor(code: string) {
    this.code = code;
  }
}

type CellValue = number | string | boolean | null | ErrorValue;

// ---------------------------------------------------------------------------
// A1 reference helpers
// ---------------------------------------------------------------------------

const REF_RE = /^([A-Z]+)([0-9]+)$/;

/** 0-based column index -> spreadsheet letters. 0 -> 'A', 26 -> 'AA'. */
export function columnLetter(index: number): string {
  if (index < 0) {
    throw new Error("column index must be >= 0");
  }
  let letters = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    letters = String.fromCharCode(65 + rem) + letters;
  }
  return letters;
}

/** Spreadsheet letters -> 0-based column index. 'A' -> 0, 'AA' -> 26. */
function letterToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 65 + 1);
  }
  return n - 1;
}

/** 'B3' -> [col_index=1, row_index=2]. Both 0-based. Throws on bad ref. */
function parseRef(ref: string): [number, number] {
  const m = REF_RE.exec(ref.toUpperCase());
  if (!m) {
    throw new FormulaError("#REF!");
  }
  const col = letterToIndex(m[1]!);
  const row = parseInt(m[2]!, 10) - 1;
  if (row < 0) {
    throw new FormulaError("#REF!");
  }
  return [col, row];
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface Token {
  kind: string;
  value: string;
}

const EOF: Token = { kind: "eof", value: "" };

const TOKEN_RE =
  /\s+|(?<number>\d+\.\d+|\.\d+|\d+)|(?<string>"(?:[^"\\]|\\.)*")|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op><=|>=|<>|[-+*\/^()&,:<>=])/y;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < text.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(text);
    if (!m || m.index !== pos || m[0].length === 0) {
      throw new FormulaError("#ERROR!");
    }
    pos = TOKEN_RE.lastIndex;
    const groups = m.groups;
    if (!groups) {
      continue; // whitespace
    }
    if (groups["number"] !== undefined) {
      tokens.push({ kind: "number", value: groups["number"] });
    } else if (groups["string"] !== undefined) {
      tokens.push({ kind: "string", value: groups["string"] });
    } else if (groups["ident"] !== undefined) {
      tokens.push({ kind: "ident", value: groups["ident"] });
    } else if (groups["op"] !== undefined) {
      tokens.push({ kind: "op", value: groups["op"] });
    }
    // else: whitespace -> skip
  }
  tokens.push({ kind: "eof", value: "" });
  return tokens;
}

// ---------------------------------------------------------------------------
// AST nodes
// ---------------------------------------------------------------------------

type Node =
  | { k: "num"; value: number }
  | { k: "str"; value: string }
  | { k: "cell"; ref: string }
  | { k: "range"; start: string; end: string }
  | { k: "unary"; op: string; operand: Node }
  | { k: "bin"; op: string; left: Node; right: Node }
  | { k: "func"; name: string; args: Node[] };

function rangeRefs(node: { start: string; end: string }): string[] {
  const [c1, r1] = parseRef(node.start);
  const [c2, r2] = parseRef(node.end);
  const loC = Math.min(c1, c2);
  const hiC = Math.max(c1, c2);
  const loR = Math.min(r1, r2);
  const hiR = Math.max(r1, r2);
  const out: string[] = [];
  for (let r = loR; r <= hiR; r++) {
    for (let c = loC; c <= hiC; c++) {
      out.push(`${columnLetter(c)}${r + 1}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[];
  private i = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    const t = this.tokens[this.i];
    return t !== undefined ? t : EOF;
  }

  private advance(): Token {
    const t = this.peek();
    this.i += 1;
    return t;
  }

  private expect(value: string): Token {
    if (this.peek().value !== value) {
      throw new FormulaError("#ERROR!");
    }
    return this.advance();
  }

  parse(): Node {
    const node = this.parseComparison();
    if (this.peek().kind !== "eof") {
      throw new FormulaError("#ERROR!");
    }
    return node;
  }

  private parseComparison(): Node {
    let node = this.parseConcat();
    while (["=", "<>", "<", "<=", ">", ">="].includes(this.peek().value)) {
      const op = this.advance().value;
      node = { k: "bin", op, left: node, right: this.parseConcat() };
    }
    return node;
  }

  private parseConcat(): Node {
    let node = this.parseAdd();
    while (this.peek().value === "&") {
      this.advance();
      node = { k: "bin", op: "&", left: node, right: this.parseAdd() };
    }
    return node;
  }

  private parseAdd(): Node {
    let node = this.parseMul();
    while (this.peek().value === "+" || this.peek().value === "-") {
      const op = this.advance().value;
      node = { k: "bin", op, left: node, right: this.parseMul() };
    }
    return node;
  }

  private parseMul(): Node {
    let node = this.parseUnary();
    while (this.peek().value === "*" || this.peek().value === "/") {
      const op = this.advance().value;
      node = { k: "bin", op, left: node, right: this.parseUnary() };
    }
    return node;
  }

  private parseUnary(): Node {
    const tok = this.peek();
    if (tok.value === "+" || tok.value === "-") {
      this.advance();
      return { k: "unary", op: tok.value, operand: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePrimary();
    if (this.peek().value === "^") {
      this.advance();
      // right-associative
      return { k: "bin", op: "^", left: base, right: this.parseUnary() };
    }
    return base;
  }

  private parsePrimary(): Node {
    const tok = this.peek();

    if (tok.kind === "number") {
      this.advance();
      return { k: "num", value: Number(tok.value) };
    }

    if (tok.kind === "string") {
      this.advance();
      return { k: "str", value: unquote(tok.value) };
    }

    if (tok.value === "(") {
      this.advance();
      const node = this.parseComparison();
      this.expect(")");
      return node;
    }

    if (tok.kind === "ident") {
      const ident = this.advance().value;
      // Function call?
      if (this.peek().value === "(") {
        this.advance();
        const args: Node[] = [];
        if (this.peek().value !== ")") {
          args.push(this.parseArgument());
          while (this.peek().value === ",") {
            this.advance();
            args.push(this.parseArgument());
          }
        }
        this.expect(")");
        return { k: "func", name: ident.toUpperCase(), args };
      }
      // Boolean literals
      const upper = ident.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") {
        return { k: "num", value: upper === "TRUE" ? 1.0 : 0.0 };
      }
      // Otherwise it must be a cell reference like A1 (letters then digits)
      return this.cellOrRange(ident);
    }

    throw new FormulaError("#ERROR!");
  }

  private parseArgument(): Node {
    // An argument may be a range (A1:B2) or any expression.
    return this.parseComparison();
  }

  private cellOrRange(ident: string): Node {
    if (!REF_RE.test(ident.toUpperCase())) {
      // bare name that is not a cell ref and not a known boolean -> #NAME?
      throw new FormulaError("#NAME?");
    }
    if (this.peek().value === ":") {
      this.advance();
      const end = this.peek();
      if (end.kind !== "ident" || !REF_RE.test(end.value.toUpperCase())) {
        throw new FormulaError("#REF!");
      }
      this.advance();
      return { k: "range", start: ident.toUpperCase(), end: end.value.toUpperCase() };
    }
    return { k: "cell", ref: ident.toUpperCase() };
  }
}

function unquote(literal: string): string {
  const inner = literal.slice(1, -1);
  return inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

function parseFormula(text: string): Node {
  return new Parser(tokenize(text)).parse();
}

// ---------------------------------------------------------------------------
// Python-compatible number parsing
// ---------------------------------------------------------------------------

/** Emulates Python float(str). Returns null when Python would raise ValueError. */
function pyFloat(raw: string): number | null {
  const s = raw.trim();
  if (s === "") {
    return null;
  }
  let body = s.toLowerCase();
  let sign = 1;
  if (body[0] === "+") {
    body = body.slice(1);
  } else if (body[0] === "-") {
    sign = -1;
    body = body.slice(1);
  }
  if (body === "inf" || body === "infinity") {
    return sign * Infinity;
  }
  if (body === "nan") {
    return NaN;
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
    return Number(s);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Evaluation context
// ---------------------------------------------------------------------------

class Context {
  private raw: Record<string, string>;
  private cache: Map<string, CellValue> = new Map();
  private visiting: Set<string> = new Set();
  errors: Record<string, string> = {};

  constructor(rawCells: Record<string, string>) {
    this.raw = rawCells;
  }

  cellValue(refIn: string): CellValue {
    const ref = refIn.toUpperCase();
    const cached = this.cache.get(ref);
    if (cached !== undefined || this.cache.has(ref)) {
      return cached as CellValue;
    }
    if (this.visiting.has(ref)) {
      throw new FormulaError("#CIRC!");
    }

    const raw = this.raw[ref];
    if (raw === undefined || raw === "") {
      this.cache.set(ref, null);
      return null;
    }

    this.visiting.add(ref);
    let value: CellValue;
    try {
      if (raw.startsWith("=")) {
        const node = parseFormula(raw.slice(1));
        value = evaluate(node, this);
      } else {
        value = literalValue(raw);
      }
    } catch (exc) {
      if (exc instanceof FormulaError) {
        value = new ErrorValue(exc.code);
        this.errors[ref] = exc.code;
      } else {
        value = new ErrorValue("#ERROR!");
        this.errors[ref] = "#ERROR!";
      }
    } finally {
      this.visiting.delete(ref);
    }

    this.cache.set(ref, value);
    return value;
  }
}

/** Interpret a non-formula cell: number if numeric, bool for TRUE/FALSE, else string. */
function literalValue(raw: string): CellValue {
  const s = raw.trim();
  if (s === "") {
    return null;
  }
  const low = s.toLowerCase();
  if (low === "true") {
    return true;
  }
  if (low === "false") {
    return false;
  }
  const n = pyFloat(s);
  if (n !== null) {
    return n;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function evaluate(node: Node, ctx: Context): CellValue {
  switch (node.k) {
    case "num":
      return node.value;
    case "str":
      return node.value;
    case "cell": {
      const val = ctx.cellValue(node.ref);
      if (val instanceof ErrorValue) {
        throw new FormulaError(val.code);
      }
      return val;
    }
    case "range":
      // A range used as a scalar is an error.
      throw new FormulaError("#VALUE!");
    case "unary": {
      const operand = asNumber(evaluate(node.operand, ctx));
      return node.op === "-" ? -operand : operand;
    }
    case "bin":
      return evalBinop(node, ctx);
    case "func":
      return evalFunc(node, ctx);
  }
}

function evalBinop(node: { op: string; left: Node; right: Node }, ctx: Context): CellValue {
  const op = node.op;

  if (op === "&") {
    return asText(evaluate(node.left, ctx)) + asText(evaluate(node.right, ctx));
  }

  if (["=", "<>", "<", "<=", ">", ">="].includes(op)) {
    const left = evaluate(node.left, ctx);
    const right = evaluate(node.right, ctx);
    return compare(op, left, right);
  }

  const left = asNumber(evaluate(node.left, ctx));
  const right = asNumber(evaluate(node.right, ctx));
  if (op === "+") {
    return left + right;
  }
  if (op === "-") {
    return left - right;
  }
  if (op === "*") {
    return left * right;
  }
  if (op === "/") {
    if (right === 0) {
      throw new FormulaError("#DIV/0!");
    }
    return left / right;
  }
  if (op === "^") {
    return powChecked(left, right);
  }
  throw new FormulaError("#ERROR!");
}

/** float ** float with Python-ish error handling: domain/overflow -> #NUM!, 0**neg -> #DIV/0!. */
function powChecked(base: number, exp: number): number {
  if (base === 0 && exp < 0) {
    throw new FormulaError("#DIV/0!");
  }
  const r = Math.pow(base, exp);
  if (!Number.isFinite(r)) {
    // NaN (e.g. negative base, fractional exponent) or overflow -> Infinity
    throw new FormulaError("#NUM!");
  }
  return r;
}

function compare(op: string, left: CellValue, right: CellValue): boolean {
  // Numeric comparison when both look numeric; else string comparison.
  const ln = maybeNumber(left);
  const rn = maybeNumber(right);
  let a: number | string;
  let b: number | string;
  if (ln !== null && rn !== null) {
    a = ln;
    b = rn;
  } else {
    a = asText(left);
    b = asText(right);
  }
  switch (op) {
    case "=":
      return a === b;
    case "<>":
      return a !== b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
  }
  throw new FormulaError("#ERROR!");
}

// ----- value coercion -------------------------------------------------------

function asNumber(value: CellValue): number {
  if (value instanceof ErrorValue) {
    throw new FormulaError(value.code);
  }
  if (value === null) {
    return 0.0;
  }
  if (typeof value === "boolean") {
    return value ? 1.0 : 0.0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const n = pyFloat(value);
    if (n === null) {
      throw new FormulaError("#VALUE!");
    }
    return n;
  }
  throw new FormulaError("#VALUE!");
}

function maybeNumber(value: CellValue): number | null {
  if (typeof value === "string" && value.trim() === "") {
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

function asText(value: CellValue): string {
  if (value instanceof ErrorValue) {
    throw new FormulaError(value.code);
  }
  if (value === null) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    return formatNumber(value);
  }
  return value;
}

function asBool(value: CellValue): boolean {
  if (value instanceof ErrorValue) {
    throw new FormulaError(value.code);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === null) {
    return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const low = value.trim().toLowerCase();
    if (low === "true") {
      return true;
    }
    if (low === "false" || low === "") {
      return false;
    }
    return true;
  }
  return Boolean(value);
}

// ----- functions ------------------------------------------------------------

function collectNumbers(args: Node[], ctx: Context): number[] {
  const nums: number[] = [];
  for (const arg of args) {
    if (arg.k === "range") {
      for (const ref of rangeRefs(arg)) {
        const val = ctx.cellValue(ref);
        if (val instanceof ErrorValue) {
          throw new FormulaError(val.code);
        }
        const n = numberOrSkip(val);
        if (n !== null) {
          nums.push(n);
        }
      }
    } else {
      const val = evaluate(arg, ctx);
      const n = numberOrSkip(val);
      if (n !== null) {
        nums.push(n);
      }
    }
  }
  return nums;
}

function numberOrSkip(value: CellValue): number | null {
  if (value instanceof ErrorValue) {
    throw new FormulaError(value.code);
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? 1.0 : 0.0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "") {
      return null;
    }
    const n = pyFloat(s);
    return n; // pyFloat returns null on parse failure (skip)
  }
  return null;
}

function countNonempty(args: Node[], ctx: Context): number {
  let count = 0;
  for (const arg of args) {
    if (arg.k === "range") {
      for (const ref of rangeRefs(arg)) {
        const val = ctx.cellValue(ref);
        if (val !== null && !(typeof val === "string" && val === "")) {
          count += 1;
        }
      }
    } else {
      const val = evaluate(arg, ctx);
      if (val !== null && !(typeof val === "string" && val === "")) {
        count += 1;
      }
    }
  }
  return count;
}

function evalFunc(node: { name: string; args: Node[] }, ctx: Context): CellValue {
  const name = node.name;
  const args = node.args;

  if (name === "SUM") {
    return collectNumbers(args, ctx).reduce((a, b) => a + b, 0);
  }
  if (name === "AVERAGE" || name === "AVG") {
    const nums = collectNumbers(args, ctx);
    if (nums.length === 0) {
      throw new FormulaError("#DIV/0!");
    }
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }
  if (name === "MIN") {
    const nums = collectNumbers(args, ctx);
    return nums.length ? Math.min(...nums) : 0.0;
  }
  if (name === "MAX") {
    const nums = collectNumbers(args, ctx);
    return nums.length ? Math.max(...nums) : 0.0;
  }
  if (name === "COUNT") {
    return collectNumbers(args, ctx).length;
  }
  if (name === "COUNTA") {
    return countNonempty(args, ctx);
  }
  if (name === "PRODUCT") {
    const nums = collectNumbers(args, ctx);
    if (nums.length === 0) {
      return 0.0;
    }
    let result = 1.0;
    for (const n of nums) {
      result *= n;
    }
    return result;
  }
  if (name === "MEDIAN") {
    const nums = collectNumbers(args, ctx).slice().sort((a, b) => a - b);
    if (nums.length === 0) {
      throw new FormulaError("#NUM!");
    }
    const mid = Math.floor(nums.length / 2);
    if (nums.length % 2) {
      return nums[mid]!;
    }
    return (nums[mid - 1]! + nums[mid]!) / 2;
  }
  if (name === "ROUND") {
    requireArgs(args, 1, 2);
    const value = asNumber(evaluate(args[0]!, ctx));
    const digits = args.length > 1 ? Math.trunc(asNumber(evaluate(args[1]!, ctx))) : 0;
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }
  if (name === "ABS") {
    requireArgs(args, 1, 1);
    return Math.abs(asNumber(evaluate(args[0]!, ctx)));
  }
  if (name === "SQRT") {
    requireArgs(args, 1, 1);
    const value = asNumber(evaluate(args[0]!, ctx));
    if (value < 0) {
      throw new FormulaError("#NUM!");
    }
    return Math.pow(value, 0.5);
  }
  if (name === "POWER") {
    requireArgs(args, 2, 2);
    const base = asNumber(evaluate(args[0]!, ctx));
    const exp = asNumber(evaluate(args[1]!, ctx));
    return powChecked(base, exp);
  }
  if (name === "MOD") {
    requireArgs(args, 2, 2);
    const a = asNumber(evaluate(args[0]!, ctx));
    const b = asNumber(evaluate(args[1]!, ctx));
    if (b === 0) {
      throw new FormulaError("#DIV/0!");
    }
    // Python modulo: result takes the sign of the divisor.
    return a - b * Math.floor(a / b);
  }
  if (name === "LEN") {
    requireArgs(args, 1, 1);
    return [...asText(evaluate(args[0]!, ctx))].length;
  }
  if (name === "CONCAT" || name === "CONCATENATE") {
    const parts: string[] = [];
    for (const arg of args) {
      if (arg.k === "range") {
        for (const ref of rangeRefs(arg)) {
          parts.push(asText(ctx.cellValue(ref)));
        }
      } else {
        parts.push(asText(evaluate(arg, ctx)));
      }
    }
    return parts.join("");
  }
  if (name === "IF") {
    requireArgs(args, 2, 3);
    const cond = asBool(evaluate(args[0]!, ctx));
    if (cond) {
      return evaluate(args[1]!, ctx);
    }
    if (args.length > 2) {
      return evaluate(args[2]!, ctx);
    }
    return false;
  }
  if (name === "AND") {
    const vals = boolArgs(args, ctx);
    return vals.length ? vals.every((v) => v) : true;
  }
  if (name === "OR") {
    const vals = boolArgs(args, ctx);
    return vals.length ? vals.some((v) => v) : false;
  }
  if (name === "NOT") {
    requireArgs(args, 1, 1);
    return !asBool(evaluate(args[0]!, ctx));
  }

  throw new FormulaError("#NAME?");
}

function boolArgs(args: Node[], ctx: Context): boolean[] {
  const out: boolean[] = [];
  for (const arg of args) {
    if (arg.k === "range") {
      for (const ref of rangeRefs(arg)) {
        const val = ctx.cellValue(ref);
        if (val !== null && !(typeof val === "string" && val.trim() === "")) {
          out.push(asBool(val));
        }
      }
    } else {
      out.push(asBool(evaluate(arg, ctx)));
    }
  }
  return out;
}

function requireArgs(args: Node[], lo: number, hi: number): void {
  if (!(lo <= args.length && args.length <= hi)) {
    throw new FormulaError("#VALUE!");
  }
}

// ---------------------------------------------------------------------------
// Display formatting + public API
// ---------------------------------------------------------------------------

function formatNumber(value: number): string {
  if (value !== value || value === Infinity || value === -Infinity) {
    return "#NUM!";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 1e10) / 1e10);
}

function toJsonValue(value: CellValue): number | string | boolean {
  if (value instanceof ErrorValue) {
    return value.code;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value !== value || value === Infinity || value === -Infinity) {
      return "#NUM!";
    }
    if (Number.isInteger(value)) {
      return value;
    }
    return Math.round(value * 1e10) / 1e10;
  }
  // null should have been filtered out by callers; coerce defensively to "".
  return value === null ? "" : value;
}

/**
 * Evaluate every cell in the sheet.
 *
 * `cells` maps an A1 ref to either a raw string or a `{ raw: ... }` object.
 * Returns `{ values: {ref: primitive}, errors: {ref: code} }` for every
 * non-empty cell.
 */
export function evaluateSheet(
  columns: Array<Record<string, unknown>>,
  numRows: number,
  cells: Record<string, unknown>,
): { values: Record<string, number | string | boolean>; errors: Record<string, string> } {
  void columns;
  void numRows;

  const rawCells: Record<string, string> = {};
  for (const [ref, cell] of Object.entries(cells || {})) {
    let rawVal: unknown;
    if (cell !== null && typeof cell === "object" && !Array.isArray(cell)) {
      rawVal = (cell as Record<string, unknown>)["raw"];
      if (rawVal === undefined) {
        rawVal = "";
      }
    } else {
      rawVal = cell;
    }
    if (rawVal === null || rawVal === undefined) {
      rawVal = "";
    }
    let raw: string;
    if (typeof rawVal === "string") {
      raw = rawVal;
    } else if (typeof rawVal === "boolean") {
      raw = rawVal ? "True" : "False";
    } else {
      raw = String(rawVal);
    }
    rawCells[String(ref).toUpperCase()] = raw;
  }

  const ctx = new Context(rawCells);

  const values: Record<string, number | string | boolean> = {};
  for (const [ref, raw] of Object.entries(rawCells)) {
    if (raw === "") {
      continue;
    }
    const val = ctx.cellValue(ref);
    if (val === null) {
      continue;
    }
    values[ref] = toJsonValue(val);
  }

  return { values, errors: { ...ctx.errors } };
}
