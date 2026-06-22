"""Unit tests for the spreadsheet formula engine (backend/formula.py)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from formula import (  # noqa: E402
    column_letter,
    letter_to_index,
    parse_ref,
    evaluate_sheet,
)


def _cols(n):
    return [{"name": column_letter(i), "type": "text", "width": 100} for i in range(n)]


def _eval(cells, cols=6, rows=20):
    return evaluate_sheet(_cols(cols), rows, cells)


# --- reference helpers ------------------------------------------------------

def test_column_letter():
    assert column_letter(0) == "A"
    assert column_letter(25) == "Z"
    assert column_letter(26) == "AA"
    assert column_letter(27) == "AB"


def test_letter_roundtrip():
    for i in (0, 1, 25, 26, 51, 700):
        assert letter_to_index(column_letter(i)) == i


def test_parse_ref():
    assert parse_ref("A1") == (0, 0)
    assert parse_ref("B3") == (1, 2)
    assert parse_ref("AA10") == (26, 9)


# --- literals ---------------------------------------------------------------

def test_number_literal():
    out = _eval({"A1": {"raw": "42"}})
    assert out["values"]["A1"] == 42


def test_float_literal():
    out = _eval({"A1": {"raw": "3.5"}})
    assert out["values"]["A1"] == 3.5


def test_text_literal():
    out = _eval({"A1": {"raw": "hello"}})
    assert out["values"]["A1"] == "hello"


def test_empty_cells_omitted():
    out = _eval({"A1": {"raw": ""}, "B1": {"raw": "x"}})
    assert "A1" not in out["values"]
    assert out["values"]["B1"] == "x"


def test_plain_string_cells_supported():
    """cells may map directly to a raw string, not just {raw: ...}."""
    out = _eval({"A1": "7", "A2": "=A1*2"})
    assert out["values"]["A2"] == 14


# --- arithmetic -------------------------------------------------------------

def test_basic_arithmetic():
    out = _eval({"A1": {"raw": "=2+3*4"}})
    assert out["values"]["A1"] == 14


def test_parentheses():
    out = _eval({"A1": {"raw": "=(2+3)*4"}})
    assert out["values"]["A1"] == 20


def test_power_right_associative():
    out = _eval({"A1": {"raw": "=2^3^2"}})  # 2^(3^2) = 512
    assert out["values"]["A1"] == 512


def test_unary_minus():
    out = _eval({"A1": {"raw": "=-5+2"}})
    assert out["values"]["A1"] == -3


def test_cell_reference():
    out = _eval({"A1": {"raw": "10"}, "B1": {"raw": "=A1+5"}})
    assert out["values"]["B1"] == 15


def test_chained_references():
    out = _eval({"A1": {"raw": "2"}, "A2": {"raw": "=A1*3"}, "A3": {"raw": "=A2+1"}})
    assert out["values"]["A3"] == 7


def test_division_by_zero():
    out = _eval({"A1": {"raw": "=1/0"}})
    assert out["values"]["A1"] == "#DIV/0!"
    assert out["errors"]["A1"] == "#DIV/0!"


def test_empty_ref_is_zero():
    out = _eval({"A1": {"raw": "=B1+5"}})  # B1 empty
    assert out["values"]["A1"] == 5


# --- functions --------------------------------------------------------------

def test_sum_range():
    cells = {"A1": {"raw": "1"}, "A2": {"raw": "2"}, "A3": {"raw": "3"}, "A4": {"raw": "=SUM(A1:A3)"}}
    out = _eval(cells)
    assert out["values"]["A4"] == 6


def test_sum_ignores_text():
    cells = {"A1": {"raw": "1"}, "A2": {"raw": "hi"}, "A3": {"raw": "4"}, "A4": {"raw": "=SUM(A1:A3)"}}
    out = _eval(cells)
    assert out["values"]["A4"] == 5


def test_average():
    cells = {"A1": {"raw": "2"}, "A2": {"raw": "4"}, "A3": {"raw": "=AVERAGE(A1:A2)"}}
    out = _eval(cells)
    assert out["values"]["A3"] == 3


def test_min_max():
    cells = {
        "A1": {"raw": "5"}, "A2": {"raw": "1"}, "A3": {"raw": "9"},
        "B1": {"raw": "=MIN(A1:A3)"}, "B2": {"raw": "=MAX(A1:A3)"},
    }
    out = _eval(cells)
    assert out["values"]["B1"] == 1
    assert out["values"]["B2"] == 9


def test_count_vs_counta():
    cells = {
        "A1": {"raw": "5"}, "A2": {"raw": "text"}, "A3": {"raw": "3"},
        "B1": {"raw": "=COUNT(A1:A3)"}, "B2": {"raw": "=COUNTA(A1:A3)"},
    }
    out = _eval(cells)
    assert out["values"]["B1"] == 2  # numeric only
    assert out["values"]["B2"] == 3  # non-empty


def test_product_round_abs():
    cells = {
        "A1": {"raw": "=PRODUCT(2,3,4)"},
        "A2": {"raw": "=ROUND(3.14159, 2)"},
        "A3": {"raw": "=ABS(-7)"},
    }
    out = _eval(cells)
    assert out["values"]["A1"] == 24
    assert out["values"]["A2"] == 3.14
    assert out["values"]["A3"] == 7


def test_nested_functions():
    cells = {"A1": {"raw": "4"}, "A2": {"raw": "=SQRT(POWER(A1,2))"}}
    out = _eval(cells)
    assert out["values"]["A2"] == 4


def test_if_function():
    cells = {"A1": {"raw": "10"}, "A2": {"raw": '=IF(A1>5,"big","small")'}}
    out = _eval(cells)
    assert out["values"]["A2"] == "big"


def test_and_or_not():
    cells = {
        "A1": {"raw": "=IF(AND(1>0, 2>1), 1, 0)"},
        "A2": {"raw": "=IF(OR(1>2, 2>1), 1, 0)"},
        "A3": {"raw": "=IF(NOT(1>2), 1, 0)"},
    }
    out = _eval(cells)
    assert out["values"]["A1"] == 1
    assert out["values"]["A2"] == 1
    assert out["values"]["A3"] == 1


def test_concat_and_amp():
    cells = {
        "A1": {"raw": "foo"}, "B1": {"raw": "bar"},
        "C1": {"raw": "=CONCAT(A1, B1)"},
        "C2": {"raw": '=A1 & "-" & B1'},
    }
    out = _eval(cells)
    assert out["values"]["C1"] == "foobar"
    assert out["values"]["C2"] == "foo-bar"


def test_mod_median_len():
    cells = {
        "A1": {"raw": "=MOD(10,3)"},
        "A2": {"raw": "=MEDIAN(1,2,3,4)"},
        "A3": {"raw": '=LEN("hello")'},
    }
    out = _eval(cells)
    assert out["values"]["A1"] == 1
    assert out["values"]["A2"] == 2.5
    assert out["values"]["A3"] == 5


# --- errors -----------------------------------------------------------------

def test_circular_reference():
    cells = {"A1": {"raw": "=B1"}, "B1": {"raw": "=A1"}}
    out = _eval(cells)
    assert out["values"]["A1"] == "#CIRC!"
    assert out["errors"]["A1"] == "#CIRC!"


def test_self_reference():
    out = _eval({"A1": {"raw": "=A1+1"}})
    assert out["values"]["A1"] == "#CIRC!"


def test_unknown_function():
    out = _eval({"A1": {"raw": "=BOGUS(1)"}})
    assert out["values"]["A1"] == "#NAME?"


def test_value_error_on_text_arithmetic():
    cells = {"A1": {"raw": "hello"}, "A2": {"raw": "=A1+1"}}
    out = _eval(cells)
    assert out["values"]["A2"] == "#VALUE!"


def test_error_propagates_through_reference():
    cells = {"A1": {"raw": "=1/0"}, "A2": {"raw": "=A1+1"}}
    out = _eval(cells)
    assert out["values"]["A2"] == "#DIV/0!"


def test_syntax_error():
    out = _eval({"A1": {"raw": "=1+"}})
    assert out["values"]["A1"] == "#ERROR!"


def test_comparison_operators():
    cells = {"A1": {"raw": "=IF(5>=5, 1, 0)"}, "A2": {"raw": "=IF(3<>3, 1, 0)"}}
    out = _eval(cells)
    assert out["values"]["A1"] == 1
    assert out["values"]["A2"] == 0


def test_boolean_literals():
    out = _eval({"A1": {"raw": "=IF(TRUE, 10, 20)"}})
    assert out["values"]["A1"] == 10
