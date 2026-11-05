/**
 * Read PocketBase hook sources without executing them: find every
 * `routerAdd(method, path, handler, ...)` call and return its arguments as
 * source text, so a handler can be re-registered verbatim under another path.
 *
 * A small scanner rather than a regex: handler bodies contain template literals
 * (`${__hooks}`), nested parentheses, strings with parentheses in them, and
 * comments, and a route is only reusable if its handler text is cut exactly.
 */

/** Index just past the string/template/comment starting at `i`, or -1 if none starts there. */
function skipLiteral(src, i) {
  const c = src[i];
  if (c === "/" && src[i + 1] === "/") {
    const nl = src.indexOf("\n", i);
    return nl < 0 ? src.length : nl;
  }
  if (c === "/" && src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    return end < 0 ? src.length : end + 2;
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== c) {
      if (src[j] === "\\") j++;
      j++;
    }
    return j + 1;
  }
  if (c === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== "`") {
      if (src[j] === "\\") {
        j += 2;
        continue;
      }
      if (src[j] === "$" && src[j + 1] === "{") {
        j = skipBalanced(src, j + 1, "{", "}");
        continue;
      }
      j++;
    }
    return j + 1;
  }
  if (c === "/" && regexMayStart(src, i)) {
    let j = i + 1;
    let inClass = false;
    while (j < src.length && src[j] !== "\n") {
      const d = src[j];
      if (d === "\\") j++;
      else if (d === "[") inClass = true;
      else if (d === "]") inClass = false;
      else if (d === "/" && !inClass) {
        j++;
        while (j < src.length && /[a-z]/i.test(src[j])) j++;
        return j;
      }
      j++;
    }
    // No closing slash on this line: a division after all.
  }
  return -1;
}

/**
 * Can a `/` at `i` open a regex literal (`/[",\n]/.test(s)`) rather than divide?
 * It can after an operator, an opening bracket, a separator or a keyword such
 * as `return`; after a name, a number or a closing bracket it divides. A quote
 * inside a regex read as a string start would desynchronise the whole scan.
 */
function regexMayStart(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (k < 0) return true;
  const p = src[k];
  if ("(,=:[!&|?{};+-*%<>~^".includes(p)) return true;
  if (!/[\w$]/.test(p)) return false;
  let s = k;
  while (s > 0 && /[\w$]/.test(src[s - 1])) s--;
  return /^(?:return|typeof|case|in|of|delete|void|throw|new|else|yield|await)$/.test(src.slice(s, k + 1));
}

/** From an opening bracket at `i`, the index just past its matching close. */
function skipBalanced(src, i, open, close) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const lit = skipLiteral(src, j);
    if (lit >= 0) {
      j = lit;
      continue;
    }
    const c = src[j];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return src.length;
}

/** Split the argument list between `(` at `start` and its `)` into top-level argument texts. */
function splitArgs(src, start) {
  const end = skipBalanced(src, start, "(", ")");
  const inner = src.slice(start + 1, end - 1);
  const args = [];
  let depth = 0;
  let from = 0;
  let j = 0;
  while (j < inner.length) {
    const lit = skipLiteral(inner, j);
    if (lit >= 0) {
      j = lit;
      continue;
    }
    const c = inner[j];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      args.push(inner.slice(from, j).trim());
      from = j + 1;
    }
    j++;
  }
  const last = inner.slice(from).trim();
  if (last !== "") args.push(last);
  return { args, end };
}

function stringValue(text) {
  const t = text.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("`") && t.endsWith("`") && !t.includes("${"))) {
    return t.slice(1, -1);
  }
  return null;
}

/** Every routerAdd(...) in `src`: { method, path, handler, middlewares, at }. */
export function routesIn(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const lit = skipLiteral(src, i);
    if (lit >= 0) {
      i = lit;
      continue;
    }
    if (src.startsWith("routerAdd", i) && !/[\w$.]/.test(src[i - 1] ?? "")) {
      let j = i + "routerAdd".length;
      while (/\s/.test(src[j])) j++;
      if (src[j] === "(") {
        const { args, end } = splitArgs(src, j);
        const method = stringValue(args[0] ?? "");
        const path = stringValue(args[1] ?? "");
        if (method && path && args[2]) {
          out.push({ method: method.toUpperCase(), path, handler: args[2], middlewares: args.slice(3), at: i });
        }
        i = end;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** The body text of `function <name>(...) { ... }` in a module source, or null. */
export function functionBody(src, name) {
  const re = new RegExp(`function\\s+${name.replace(/[$]/g, "\\$")}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  const brace = src.indexOf("{", m.index);
  if (brace < 0) return null;
  const end = skipBalanced(src, brace, "{", "}");
  return src.slice(brace, end);
}
