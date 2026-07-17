/**
 * Safe arithmetic expression evaluator.
 *
 * Deliberately hand-written (tokenizer + recursive-descent parser) instead of
 * `eval`/`Function` on raw user input, which would allow arbitrary JS execution.
 *
 * Grammar (precedence high -> low): parens/functions, `^` (right-assoc),
 * unary `-`, `*` `/`, `+` `-`.
 */

export class CalculatorError extends Error {}

type TokenType = 'number' | 'ident' | 'op' | 'end'

interface Token {
  type: TokenType
  value: string
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (/\s/.test(ch)) {
      i++
      continue
    }

    if (/[0-9.]/.test(ch)) {
      let j = i
      let sawDot = false
      while (j < input.length && /[0-9.]/.test(input[j])) {
        if (input[j] === '.') {
          if (sawDot) break
          sawDot = true
        }
        j++
      }
      const raw = input.slice(i, j)
      if (raw === '.' || raw === '') throw new CalculatorError('Invalid number')
      tokens.push({ type: 'number', value: raw })
      i = j
      continue
    }

    if (/[a-zA-Z]/.test(ch)) {
      let j = i
      while (j < input.length && /[a-zA-Z]/.test(input[j])) j++
      tokens.push({ type: 'ident', value: input.slice(i, j) })
      i = j
      continue
    }

    if ('+-*/^()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }

    throw new CalculatorError(`Unexpected character "${ch}"`)
  }

  tokens.push({ type: 'end', value: '' })
  return tokens
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
}

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: (x) => {
    if (x < 0) throw new CalculatorError('Cannot take square root of a negative number')
    return Math.sqrt(x)
  },
  log: (x) => {
    if (x <= 0) throw new CalculatorError('Logarithm of non-positive number')
    return Math.log10(x)
  },
  ln: (x) => {
    if (x <= 0) throw new CalculatorError('Logarithm of non-positive number')
    return Math.log(x)
  },
}

class Parser {
  private pos = 0

  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private next(): Token {
    return this.tokens[this.pos++]
  }

  private expectOp(op: string): void {
    const t = this.next()
    if (t.type !== 'op' || t.value !== op) {
      throw new CalculatorError(`Expected "${op}"`)
    }
  }

  parse(): number {
    const result = this.parseAddSub()
    if (this.peek().type !== 'end') {
      throw new CalculatorError('Unexpected input after expression')
    }
    return result
  }

  private parseAddSub(): number {
    let value = this.parseMulDiv()
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value
      const rhs = this.parseMulDiv()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  private parseMulDiv(): number {
    let value = this.parseUnary()
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value
      const rhs = this.parseUnary()
      if (op === '/') {
        if (rhs === 0) throw new CalculatorError('Division by zero')
        value = value / rhs
      } else {
        value = value * rhs
      }
    }
    return value
  }

  private parseUnary(): number {
    if (this.peek().type === 'op' && this.peek().value === '-') {
      this.next()
      return -this.parseUnary()
    }
    if (this.peek().type === 'op' && this.peek().value === '+') {
      this.next()
      return this.parseUnary()
    }
    return this.parsePower()
  }

  private parsePower(): number {
    const base = this.parseAtom()
    if (this.peek().type === 'op' && this.peek().value === '^') {
      this.next()
      const exponent = this.parseUnary() // right-associative
      return Math.pow(base, exponent)
    }
    return base
  }

  private parseAtom(): number {
    const t = this.peek()

    if (t.type === 'number') {
      this.next()
      return parseFloat(t.value)
    }

    if (t.type === 'op' && t.value === '(') {
      this.next()
      const value = this.parseAddSub()
      this.expectOp(')')
      return value
    }

    if (t.type === 'ident') {
      this.next()
      const name = t.value.toLowerCase()
      if (name in FUNCTIONS) {
        this.expectOp('(')
        const arg = this.parseAddSub()
        this.expectOp(')')
        return FUNCTIONS[name](arg)
      }
      if (name in CONSTANTS) {
        return CONSTANTS[name]
      }
      throw new CalculatorError(`Unknown identifier "${t.value}"`)
    }

    throw new CalculatorError('Invalid expression')
  }
}

export function evaluateExpression(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new CalculatorError('Enter an expression')
  }
  const tokens = tokenize(trimmed)
  const parser = new Parser(tokens)
  const result = parser.parse()
  if (!Number.isFinite(result)) {
    throw new CalculatorError('Invalid result')
  }
  return result
}

/** Trims floating-point noise (e.g. 0.1 + 0.2) into a display-friendly string. */
export function formatResult(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(12)))
}
