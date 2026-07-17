"""
Craft Sheets formula engine.

A small, dependency-free spreadsheet evaluator. It parses cell contents that
begin with ``=`` as formulas and evaluates them with:

  - cell references (``A1``) and ranges (``A1:B5``)
  - arithmetic operators ``+ - * / ^`` with parentheses and unary minus
  - string concatenation with ``&``
  - comparison operators ``= <> < <= > >=`` (return booleans)
  - functions: SUM, AVERAGE/AVG, MIN, MAX, COUNT, COUNTA, PRODUCT, ROUND,
    ABS, SQRT, POWER, MOD, MEDIAN, IF, AND, OR, NOT, CONCAT/CONCATENATE, LEN

Evaluation is memoized and detects circular references. Errors are reported
per cell using Excel-style codes (``#DIV/0!``, ``#CIRC!``, ``#NAME?`` …).

The module is pure (no DB, no FastAPI). ``evaluate_sheet`` is the entry point.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class FormulaError(Exception):
    """Raised during evaluation. ``code`` is an Excel-style error string."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ErrorValue:
    """A cell value that is an error (so it can propagate through references)."""

    __slots__ = ("code",)

    def __init__(self, code: str):
        self.code = code

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"ErrorValue({self.code})"


# ---------------------------------------------------------------------------
# A1 reference helpers
# ---------------------------------------------------------------------------

_REF_RE = re.compile(r"^([A-Z]+)([0-9]+)$")


def column_letter(index: int) -> str:
    """0-based column index -> spreadsheet letters. 0 -> 'A', 26 -> 'AA'."""
    if index < 0:
        raise ValueError("column index must be >= 0")
    letters = ""
    n = index + 1
    while n > 0:
        n, rem = divmod(n - 1, 26)
        letters = chr(ord("A") + rem) + letters
    return letters


def letter_to_index(letters: str) -> int:
    """Spreadsheet letters -> 0-based column index. 'A' -> 0, 'AA' -> 26."""
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n - 1


def parse_ref(ref: str) -> Tuple[int, int]:
    """'B3' -> (col_index=1, row_index=2). Both 0-based. Raises on bad ref."""
    m = _REF_RE.match(ref.upper())
    if not m:
        raise FormulaError("#REF!")
    col = letter_to_index(m.group(1))
    row = int(m.group(2)) - 1
    if row < 0:
        raise FormulaError("#REF!")
    return col, row


# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(
    r"""
      \s+                                   # whitespace (skipped)
    | (?P<number>\d+\.\d+|\.\d+|\d+)        # number
    | (?P<string>"(?:[^"\\]|\\.)*")         # double-quoted string
    | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)     # identifier (func or cell letters part)
    | (?P<op><=|>=|<>|[-+*/^()&,:<>=])        # operators / punctuation
    """,
    re.VERBOSE,
)


class Token:
    __slots__ = ("kind", "value")

    def __init__(self, kind: str, value: str):
        self.kind = kind
        self.value = value


def tokenize(text: str) -> List[Token]:
    tokens: List[Token] = []
    pos = 0
    while pos < len(text):
        m = _TOKEN_RE.match(text, pos)
        if not m or m.end() == pos:
            raise FormulaError("#ERROR!")
        pos = m.end()
        if m.lastgroup is None:
            continue  # whitespace
        kind = m.lastgroup
        value = m.group()
        tokens.append(Token(kind, value))
    tokens.append(Token("eof", ""))
    return tokens


# ---------------------------------------------------------------------------
# AST nodes
# ---------------------------------------------------------------------------

class Node:
    pass


class Num(Node):
    def __init__(self, value: float):
        self.value = value


class Str(Node):
    def __init__(self, value: str):
        self.value = value


class CellRef(Node):
    def __init__(self, ref: str):
        self.ref = ref.upper()


class RangeRef(Node):
    def __init__(self, start: str, end: str):
        self.start = start.upper()
        self.end = end.upper()

    def refs(self) -> List[str]:
        c1, r1 = parse_ref(self.start)
        c2, r2 = parse_ref(self.end)
        lo_c, hi_c = sorted((c1, c2))
        lo_r, hi_r = sorted((r1, r2))
        out: List[str] = []
        for r in range(lo_r, hi_r + 1):
            for c in range(lo_c, hi_c + 1):
                out.append(f"{column_letter(c)}{r + 1}")
        return out


class Unary(Node):
    def __init__(self, op: str, operand: Node):
        self.op = op
        self.operand = operand


class BinOp(Node):
    def __init__(self, op: str, left: Node, right: Node):
        self.op = op
        self.left = left
        self.right = right


class FuncCall(Node):
    def __init__(self, name: str, args: List[Node]):
        self.name = name.upper()
        self.args = args


# ---------------------------------------------------------------------------
# Parser (recursive descent)
# ---------------------------------------------------------------------------

class Parser:
    def __init__(self, tokens: List[Token]):
        self.tokens = tokens
        self.i = 0

    def peek(self) -> Token:
        return self.tokens[self.i]

    def advance(self) -> Token:
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def expect(self, value: str) -> Token:
        tok = self.peek()
        if tok.value != value:
            raise FormulaError("#ERROR!")
        return self.advance()

    def parse(self) -> Node:
        node = self.parse_comparison()
        if self.peek().kind != "eof":
            raise FormulaError("#ERROR!")
        return node

    def parse_comparison(self) -> Node:
        node = self.parse_concat()
        while self.peek().value in ("=", "<>", "<", "<=", ">", ">="):
            op = self.advance().value
            node = BinOp(op, node, self.parse_concat())
        return node

    def parse_concat(self) -> Node:
        node = self.parse_add()
        while self.peek().value == "&":
            self.advance()
            node = BinOp("&", node, self.parse_add())
        return node

    def parse_add(self) -> Node:
        node = self.parse_mul()
        while self.peek().value in ("+", "-"):
            op = self.advance().value
            node = BinOp(op, node, self.parse_mul())
        return node

    def parse_mul(self) -> Node:
        node = self.parse_unary()
        while self.peek().value in ("*", "/"):
            op = self.advance().value
            node = BinOp(op, node, self.parse_unary())
        return node

    def parse_unary(self) -> Node:
        tok = self.peek()
        if tok.value in ("+", "-"):
            self.advance()
            return Unary(tok.value, self.parse_unary())
        return self.parse_power()

    def parse_power(self) -> Node:
        base = self.parse_primary()
        if self.peek().value == "^":
            self.advance()
            # right-associative
            return BinOp("^", base, self.parse_unary())
        return base

    def parse_primary(self) -> Node:
        tok = self.peek()

        if tok.kind == "number":
            self.advance()
            return Num(float(tok.value))

        if tok.kind == "string":
            self.advance()
            return Str(_unquote(tok.value))

        if tok.value == "(":
            self.advance()
            node = self.parse_comparison()
            self.expect(")")
            return node

        if tok.kind == "ident":
            ident = self.advance().value
            # Function call?
            if self.peek().value == "(":
                self.advance()
                args: List[Node] = []
                if self.peek().value != ")":
                    args.append(self.parse_argument())
                    while self.peek().value == ",":
                        self.advance()
                        args.append(self.parse_argument())
                self.expect(")")
                return FuncCall(ident, args)
            # Boolean literals
            upper = ident.upper()
            if upper in ("TRUE", "FALSE"):
                return Num(1.0 if upper == "TRUE" else 0.0)
            # Otherwise it must be a cell reference like A1 (letters then digits)
            return self._cell_or_range(ident)

        raise FormulaError("#ERROR!")

    def parse_argument(self) -> Node:
        """An argument may be a range (A1:B2) or any expression."""
        return self.parse_comparison()

    def _cell_or_range(self, ident: str) -> Node:
        if not _REF_RE.match(ident.upper()):
            # bare name that is not a cell ref and not a known boolean -> #NAME?
            raise FormulaError("#NAME?")
        if self.peek().value == ":":
            self.advance()
            end = self.peek()
            if end.kind != "ident" or not _REF_RE.match(end.value.upper()):
                raise FormulaError("#REF!")
            self.advance()
            return RangeRef(ident, end.value)
        return CellRef(ident)


def _unquote(literal: str) -> str:
    inner = literal[1:-1]
    return inner.replace('\\"', '"').replace("\\\\", "\\")


def parse_formula(text: str) -> Node:
    return Parser(tokenize(text)).parse()


# ---------------------------------------------------------------------------
# Evaluation context
# ---------------------------------------------------------------------------

class Context:
    """Holds raw cell content and evaluates lazily with cycle detection."""

    def __init__(self, raw_cells: Dict[str, str], num_cols: int, num_rows: int):
        self.raw = raw_cells
        self.num_cols = num_cols
        self.num_rows = num_rows
        self.cache: Dict[str, Any] = {}
        self.visiting: set = set()
        self.errors: Dict[str, str] = {}

    def cell_value(self, ref: str) -> Any:
        ref = ref.upper()
        if ref in self.cache:
            return self.cache[ref]
        if ref in self.visiting:
            raise FormulaError("#CIRC!")

        raw = self.raw.get(ref)
        if raw is None or raw == "":
            self.cache[ref] = None
            return None

        self.visiting.add(ref)
        try:
            if isinstance(raw, str) and raw.startswith("="):
                node = parse_formula(raw[1:])
                value: Any = evaluate(node, self)
            else:
                value = literal_value(raw)
        except FormulaError as exc:
            value = ErrorValue(exc.code)
            self.errors[ref] = exc.code
        except ZeroDivisionError:
            value = ErrorValue("#DIV/0!")
            self.errors[ref] = "#DIV/0!"
        except Exception:
            value = ErrorValue("#ERROR!")
            self.errors[ref] = "#ERROR!"
        finally:
            self.visiting.discard(ref)

        self.cache[ref] = value
        return value


def literal_value(raw: Any) -> Any:
    """Interpret a non-formula cell: number if numeric, bool for TRUE/FALSE, else string."""
    if isinstance(raw, (int, float)):
        return float(raw)
    if not isinstance(raw, str):
        return raw
    s = raw.strip()
    if s == "":
        return None
    low = s.lower()
    if low == "true":
        return True
    if low == "false":
        return False
    try:
        return float(s)
    except ValueError:
        return s


# ---------------------------------------------------------------------------
# Evaluator
# ---------------------------------------------------------------------------

def evaluate(node: Node, ctx: Context) -> Any:
    if isinstance(node, Num):
        return node.value
    if isinstance(node, Str):
        return node.value
    if isinstance(node, CellRef):
        val = ctx.cell_value(node.ref)
        if isinstance(val, ErrorValue):
            raise FormulaError(val.code)
        return val
    if isinstance(node, RangeRef):
        # A range used as a scalar is an error.
        raise FormulaError("#VALUE!")
    if isinstance(node, Unary):
        operand = _as_number(evaluate(node.operand, ctx))
        return -operand if node.op == "-" else operand
    if isinstance(node, BinOp):
        return _eval_binop(node, ctx)
    if isinstance(node, FuncCall):
        return _eval_func(node, ctx)
    raise FormulaError("#ERROR!")


def _eval_binop(node: BinOp, ctx: Context) -> Any:
    op = node.op

    if op == "&":
        return _as_text(evaluate(node.left, ctx)) + _as_text(evaluate(node.right, ctx))

    if op in ("=", "<>", "<", "<=", ">", ">="):
        left = evaluate(node.left, ctx)
        right = evaluate(node.right, ctx)
        return _compare(op, left, right)

    left = _as_number(evaluate(node.left, ctx))
    right = _as_number(evaluate(node.right, ctx))
    if op == "+":
        return left + right
    if op == "-":
        return left - right
    if op == "*":
        return left * right
    if op == "/":
        if right == 0:
            raise FormulaError("#DIV/0!")
        return left / right
    if op == "^":
        try:
            return float(left ** right)
        except (ValueError, OverflowError):
            raise FormulaError("#NUM!")
    raise FormulaError("#ERROR!")


def _compare(op: str, left: Any, right: Any) -> bool:
    # Numeric comparison when both look numeric; else string comparison.
    ln, rn = _maybe_number(left), _maybe_number(right)
    if ln is not None and rn is not None:
        a, b = ln, rn
    else:
        a, b = _as_text(left), _as_text(right)
    if op == "=":
        return a == b
    if op == "<>":
        return a != b
    if op == "<":
        return a < b
    if op == "<=":
        return a <= b
    if op == ">":
        return a > b
    if op == ">=":
        return a >= b
    raise FormulaError("#ERROR!")


# ----- value coercion -------------------------------------------------------

def _as_number(value: Any) -> float:
    if isinstance(value, ErrorValue):
        raise FormulaError(value.code)
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip()
        try:
            return float(s)
        except ValueError:
            raise FormulaError("#VALUE!")
    raise FormulaError("#VALUE!")


def _maybe_number(value: Any) -> Optional[float]:
    try:
        if isinstance(value, str) and value.strip() == "":
            return None
        return _as_number(value)
    except FormulaError:
        return None


def _as_text(value: Any) -> str:
    if isinstance(value, ErrorValue):
        raise FormulaError(value.code)
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float):
        return _format_number(value)
    return str(value)


def _as_bool(value: Any) -> bool:
    if isinstance(value, ErrorValue):
        raise FormulaError(value.code)
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        low = value.strip().lower()
        if low == "true":
            return True
        if low == "false" or low == "":
            return False
        return True
    return bool(value)


# ----- functions ------------------------------------------------------------

def _collect_numbers(args: List[Node], ctx: Context) -> List[float]:
    """Flatten args (expanding ranges) into numeric values, skipping blanks/text."""
    nums: List[float] = []
    for arg in args:
        if isinstance(arg, RangeRef):
            for ref in arg.refs():
                val = ctx.cell_value(ref)
                if isinstance(val, ErrorValue):
                    raise FormulaError(val.code)
                n = _number_or_skip(val)
                if n is not None:
                    nums.append(n)
        else:
            val = evaluate(arg, ctx)
            n = _number_or_skip(val)
            if n is not None:
                nums.append(n)
    return nums


def _number_or_skip(value: Any) -> Optional[float]:
    if isinstance(value, ErrorValue):
        raise FormulaError(value.code)
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def _count_nonempty(args: List[Node], ctx: Context) -> int:
    count = 0
    for arg in args:
        if isinstance(arg, RangeRef):
            for ref in arg.refs():
                val = ctx.cell_value(ref)
                if val is not None and not (isinstance(val, str) and val == ""):
                    count += 1
        else:
            val = evaluate(arg, ctx)
            if val is not None and not (isinstance(val, str) and val == ""):
                count += 1
    return count


def _eval_func(node: FuncCall, ctx: Context) -> Any:
    name = node.name
    args = node.args

    if name == "SUM":
        return sum(_collect_numbers(args, ctx))
    if name in ("AVERAGE", "AVG"):
        nums = _collect_numbers(args, ctx)
        if not nums:
            raise FormulaError("#DIV/0!")
        return sum(nums) / len(nums)
    if name == "MIN":
        nums = _collect_numbers(args, ctx)
        return min(nums) if nums else 0.0
    if name == "MAX":
        nums = _collect_numbers(args, ctx)
        return max(nums) if nums else 0.0
    if name == "COUNT":
        return float(len(_collect_numbers(args, ctx)))
    if name == "COUNTA":
        return float(_count_nonempty(args, ctx))
    if name == "PRODUCT":
        nums = _collect_numbers(args, ctx)
        result = 1.0
        for n in nums:
            result *= n
        return result if nums else 0.0
    if name == "MEDIAN":
        nums = sorted(_collect_numbers(args, ctx))
        if not nums:
            raise FormulaError("#NUM!")
        mid = len(nums) // 2
        if len(nums) % 2:
            return nums[mid]
        return (nums[mid - 1] + nums[mid]) / 2
    if name == "ROUND":
        _require_args(args, 1, 2)
        value = _as_number(evaluate(args[0], ctx))
        digits = int(_as_number(evaluate(args[1], ctx))) if len(args) > 1 else 0
        return float(round(value, digits))
    if name == "ABS":
        _require_args(args, 1, 1)
        return abs(_as_number(evaluate(args[0], ctx)))
    if name == "SQRT":
        _require_args(args, 1, 1)
        value = _as_number(evaluate(args[0], ctx))
        if value < 0:
            raise FormulaError("#NUM!")
        return value ** 0.5
    if name == "POWER":
        _require_args(args, 2, 2)
        base = _as_number(evaluate(args[0], ctx))
        exp = _as_number(evaluate(args[1], ctx))
        try:
            return float(base ** exp)
        except (ValueError, OverflowError):
            raise FormulaError("#NUM!")
    if name == "MOD":
        _require_args(args, 2, 2)
        a = _as_number(evaluate(args[0], ctx))
        b = _as_number(evaluate(args[1], ctx))
        if b == 0:
            raise FormulaError("#DIV/0!")
        return a % b
    if name == "LEN":
        _require_args(args, 1, 1)
        return float(len(_as_text(evaluate(args[0], ctx))))
    if name in ("CONCAT", "CONCATENATE"):
        parts: List[str] = []
        for arg in args:
            if isinstance(arg, RangeRef):
                for ref in arg.refs():
                    val = ctx.cell_value(ref)
                    parts.append(_as_text(val))
            else:
                parts.append(_as_text(evaluate(arg, ctx)))
        return "".join(parts)
    if name == "IF":
        _require_args(args, 2, 3)
        cond = _as_bool(evaluate(args[0], ctx))
        if cond:
            return evaluate(args[1], ctx)
        if len(args) > 2:
            return evaluate(args[2], ctx)
        return False
    if name == "AND":
        vals = _bool_args(args, ctx)
        return all(vals) if vals else True
    if name == "OR":
        vals = _bool_args(args, ctx)
        return any(vals) if vals else False
    if name == "NOT":
        _require_args(args, 1, 1)
        return not _as_bool(evaluate(args[0], ctx))

    raise FormulaError("#NAME?")


def _bool_args(args: List[Node], ctx: Context) -> List[bool]:
    out: List[bool] = []
    for arg in args:
        if isinstance(arg, RangeRef):
            for ref in arg.refs():
                val = ctx.cell_value(ref)
                if val is not None and not (isinstance(val, str) and val.strip() == ""):
                    out.append(_as_bool(val))
        else:
            out.append(_as_bool(evaluate(arg, ctx)))
    return out


def _require_args(args: List[Node], lo: int, hi: int) -> None:
    if not (lo <= len(args) <= hi):
        raise FormulaError("#VALUE!")


# ---------------------------------------------------------------------------
# Display formatting + public API
# ---------------------------------------------------------------------------

def _format_number(value: float) -> str:
    if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
        return "#NUM!"
    if float(value).is_integer():
        return str(int(value))
    return repr(round(value, 10))


def to_json_value(value: Any) -> Any:
    """Convert an evaluated value into a JSON-serializable primitive."""
    if isinstance(value, ErrorValue):
        return value.code
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return "#NUM!"
        if value.is_integer():
            return int(value)
        return round(value, 10)
    return value


def evaluate_sheet(
    columns: List[Dict[str, Any]],
    num_rows: int,
    cells: Dict[str, Any],
) -> Dict[str, Dict[str, Any]]:
    """
    Evaluate every cell in the sheet.

    ``cells`` maps an A1 ref to either a raw string or a ``{"raw": ...}`` dict.
    Returns ``{"values": {ref: primitive}, "errors": {ref: code}}`` for every
    non-empty cell.
    """
    raw_cells: Dict[str, str] = {}
    for ref, cell in (cells or {}).items():
        if isinstance(cell, dict):
            raw = cell.get("raw", "")
        else:
            raw = cell
        if raw is None:
            raw = ""
        raw_cells[str(ref).upper()] = raw if isinstance(raw, str) else str(raw)

    num_cols = len(columns or [])
    ctx = Context(raw_cells, num_cols, num_rows)

    values: Dict[str, Any] = {}
    for ref, raw in raw_cells.items():
        if raw == "":
            continue
        val = ctx.cell_value(ref)
        if val is None:
            continue
        values[ref] = to_json_value(val)

    return {"values": values, "errors": dict(ctx.errors)}
