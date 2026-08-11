// MXD data platform — safe formula engine (roadmap §34-36). NO eval / new
// Function / arbitrary JS. A hand-written tokenizer + Pratt parser produces a
// bounded AST; the evaluator is non-Turing-complete (no loops, no recursion into
// other formulas at eval time — dependency order is resolved outside) and hard-
// bounded on AST depth and evaluation steps. A malformed or overflowing formula
// yields a FormulaError, never a thrown crash that could take down a table.

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

const MAX_DEPTH = 32;
const MAX_STEPS = 10_000;
const MAX_EXPR_LEN = 4_000;
// Bounds the SIZE of a string result (not just the number of eval steps), so a
// short expression like CONCAT({bigTextField}, {bigTextField}, ...) can't
// materialize a huge string per record.
const MAX_STRING_LEN = 50_000;

function boundStr(s: string): string {
  if (s.length > MAX_STRING_LEN) {
    throw new FormulaError('formula string result too large');
  }
  return s;
}

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'field'; v: string } // {fieldId}
  | { t: 'ident'; v: string } // function names / TRUE/FALSE
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' };

function tokenize(src: string): Tok[] {
  if (src.length > MAX_EXPR_LEN) {
    throw new FormulaError('formula too long');
  }
  const toks: Tok[] = [];
  let i = 0;
  const ops = ['<=', '>=', '!=', '==', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '='];
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '(') { toks.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rparen' }); i++; continue; }
    if (c === ',') { toks.push({ t: 'comma' }); i++; continue; }
    if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new FormulaError('unterminated field reference');
      toks.push({ t: 'field', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else {
          s += src[j];
          j++;
        }
      }
      if (j >= src.length) throw new FormulaError('unterminated string');
      toks.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new FormulaError('invalid number');
      toks.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: 'ident', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    const one = src.slice(i, i + 1);
    if (ops.includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if (ops.includes(one)) { toks.push({ t: 'op', v: one }); i += 1; continue; }
    throw new FormulaError(`unexpected character: ${c}`);
  }
  return toks;
}

// AST
type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'field'; id: string }
  | { k: 'unary'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

const BINDING: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
};

class Parser {
  private pos = 0;
  private depth = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }

  parse(): Node {
    const n = this.expr(0);
    if (this.pos !== this.toks.length) throw new FormulaError('trailing tokens');
    return n;
  }

  private guardDepth() {
    if (++this.depth > MAX_DEPTH) throw new FormulaError('formula too deeply nested');
  }

  private expr(minBind: number): Node {
    this.guardDepth();
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op') break;
      const bind = BINDING[t.v];
      if (bind === undefined || bind < minBind) break;
      this.next();
      const right = this.expr(bind + 1);
      left = { k: 'bin', op: t.v, a: left, b: right };
    }
    this.depth--;
    return left;
  }

  private unary(): Node {
    // Depth-guard unary chains too (a long `- - - ...` or `NOT NOT ...` run
    // recurses here without going through expr()); otherwise MAX_DEPTH is
    // bypassed and a crafted expression can blow the stack.
    this.guardDepth();
    try {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '-' || t.v === '+')) {
        this.next();
        return { k: 'unary', op: t.v, a: this.unary() };
      }
      if (t && t.t === 'ident' && (t.v === 'NOT' || t.v === 'not')) {
        this.next();
        return { k: 'unary', op: '!', a: this.unary() };
      }
      return this.primary();
    } finally {
      this.depth--;
    }
  }

  private primary(): Node {
    const t = this.next();
    if (!t) throw new FormulaError('unexpected end of formula');
    switch (t.t) {
      case 'num': return { k: 'num', v: t.v };
      case 'str': return { k: 'str', v: t.v };
      case 'field': return { k: 'field', id: t.v };
      case 'lparen': {
        const n = this.expr(0);
        const close = this.next();
        if (!close || close.t !== 'rparen') throw new FormulaError('missing )');
        return n;
      }
      case 'ident': {
        const up = t.v.toUpperCase();
        if (up === 'TRUE') return { k: 'bool', v: true };
        if (up === 'FALSE') return { k: 'bool', v: false };
        // function call
        const lp = this.next();
        if (!lp || lp.t !== 'lparen') throw new FormulaError(`expected ( after ${t.v}`);
        const args: Node[] = [];
        if (this.peek()?.t !== 'rparen') {
          for (;;) {
            args.push(this.expr(0));
            const sep = this.peek();
            if (sep?.t === 'comma') { this.next(); continue; }
            break;
          }
        }
        const close = this.next();
        if (!close || close.t !== 'rparen') throw new FormulaError('missing ) in call');
        return { k: 'call', name: up, args };
      }
      default:
        throw new FormulaError('unexpected token');
    }
  }
}

// Collect the field ids a compiled formula depends on (for the dependency graph
// + cycle detection, done by the caller).
export function formulaDependencies(expression: string): string[] {
  const ast = new Parser(tokenize(expression)).parse();
  const deps = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === 'field') deps.add(n.id);
    else if (n.k === 'unary') walk(n.a);
    else if (n.k === 'bin') { walk(n.a); walk(n.b); }
    else if (n.k === 'call') n.args.forEach(walk);
  };
  walk(ast);
  return [...deps];
}

export interface CompiledFormula {
  evaluate(fields: Record<string, unknown>): unknown;
  dependencies: string[];
}

// Parse once; evaluate many (per record). Evaluation is step-bounded.
export function compileFormula(expression: string): CompiledFormula {
  const ast = new Parser(tokenize(expression)).parse();
  const deps: string[] = [];
  const seen = new Set<string>();
  const collect = (n: Node) => {
    if (n.k === 'field') { if (!seen.has(n.id)) { seen.add(n.id); deps.push(n.id); } }
    else if (n.k === 'unary') collect(n.a);
    else if (n.k === 'bin') { collect(n.a); collect(n.b); }
    else if (n.k === 'call') n.args.forEach(collect);
  };
  collect(ast);

  return {
    dependencies: deps,
    evaluate(fieldValues: Record<string, unknown>): unknown {
      let steps = 0;
      const ev = (n: Node): unknown => {
        if (++steps > MAX_STEPS) throw new FormulaError('formula evaluation too complex');
        switch (n.k) {
          case 'num': return n.v;
          case 'str': return n.v;
          case 'bool': return n.v;
          case 'field': return fieldValues[n.id] ?? null;
          case 'unary': {
            const a = ev(n.a);
            if (n.op === '!') return !truthy(a);
            const num = toNum(a);
            return n.op === '-' ? -num : num;
          }
          case 'bin': return binop(n.op, () => ev(n.a), () => ev(n.b));
          case 'call': return callFn(n.name, n.args.map(ev));
        }
      };
      return ev(ast);
    },
  };
}

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  return true;
}
function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new FormulaError('expected a number');
  return n;
}
function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

function binop(op: string, la: () => unknown, lb: () => unknown): unknown {
  // short-circuit boolean ops
  if (op === '&&') return truthy(la()) ? truthy(lb()) : false;
  if (op === '||') return truthy(la()) ? true : truthy(lb());
  const a = la();
  const b = lb();
  switch (op) {
    case '+':
      return typeof a === 'string' || typeof b === 'string'
        ? boundStr(toStr(a) + toStr(b))
        : toNum(a) + toNum(b);
    case '-': return toNum(a) - toNum(b);
    case '*': return toNum(a) * toNum(b);
    case '/': {
      const d = toNum(b);
      if (d === 0) throw new FormulaError('division by zero');
      return toNum(a) / d;
    }
    case '%': {
      const d = toNum(b);
      if (d === 0) throw new FormulaError('modulo by zero');
      return toNum(a) % d;
    }
    case '==':
    case '=': return eq(a, b);
    case '!=': return !eq(a, b);
    case '<': return cmp(a, b) < 0;
    case '>': return cmp(a, b) > 0;
    case '<=': return cmp(a, b) <= 0;
    case '>=': return cmp(a, b) >= 0;
    default: throw new FormulaError(`unknown operator ${op}`);
  }
}
function eq(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    return toNum(a ?? 0) === toNum(b ?? 0);
  }
  return toStr(a) === toStr(b);
}
function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' || typeof b === 'number') {
    const x = toNum(a);
    const y = toNum(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = toStr(a);
  const y = toStr(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function callFn(name: string, args: unknown[]): unknown {
  switch (name) {
    case 'IF':
      if (args.length < 2) throw new FormulaError('IF needs at least 2 args');
      return truthy(args[0]) ? args[1] : (args[2] ?? null);
    case 'AND': return args.every(truthy);
    case 'OR': return args.some(truthy);
    case 'NOT': return !truthy(args[0]);
    case 'CONCAT': return boundStr(args.map(toStr).join(''));
    case 'UPPER': return toStr(args[0]).toUpperCase();
    case 'LOWER': return toStr(args[0]).toLowerCase();
    case 'LEN': return toStr(args[0]).length;
    case 'TRIM': return toStr(args[0]).trim();
    case 'ABS': return Math.abs(toNum(args[0]));
    case 'ROUND': {
      const f = 10 ** (args[1] != null ? toNum(args[1]) : 0);
      return Math.round(toNum(args[0]) * f) / f;
    }
    case 'MIN': return Math.min(...args.map(toNum));
    case 'MAX': return Math.max(...args.map(toNum));
    case 'SUM': return args.map(toNum).reduce((a, b) => a + b, 0);
    case 'FLOOR': return Math.floor(toNum(args[0]));
    case 'CEIL': return Math.ceil(toNum(args[0]));
    case 'COALESCE': return args.find((a) => a != null) ?? null;
    default: throw new FormulaError(`unknown function ${name}`);
  }
}
