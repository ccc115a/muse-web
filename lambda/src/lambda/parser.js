// 手寫 recursive descent parser：支援 λ / \ / lambda，數字糖，# 註解
import { Var, Abs, App } from './ast.js';
import { churchNumeral } from './church_numeral.js';

export class ParseError extends Error {
  constructor(message, pos, line, col) {
    super(`${message}（位置 ${line}:${col}）`);
    this.name = 'ParseError';
    this.pos = pos;
    this.line = line;
    this.col = col;
  }
}

const LAMBDA = 'λ';

export function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const push = (t) => toks.push(t);
  while (i < src.length) {
    const c = src[i];
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') { i++; col++; }
      continue;
    }
    if (c === '\n') { i++; line++; col = 1; continue; }
    if (/\s/.test(c)) { i++; col++; continue; }
    if (c === LAMBDA || c === '\\') { push({ t: 'lam', line, col }); i++; col++; continue; }
    if (c === '.') { push({ t: 'dot', line, col }); i++; col++; continue; }
    if (c === '(') { push({ t: 'lparen', line, col }); i++; col++; continue; }
    if (c === ')') { push({ t: 'rparen', line, col }); i++; col++; continue; }
    if (c === '=') { push({ t: 'eq', line, col }); i++; col++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      push({ t: 'num', value: src.slice(i, j), line, col });
      col += j - i; i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_']/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === 'lambda') push({ t: 'lam', line, col });
      else push({ t: 'var', value: word, line, col });
      col += j - i; i = j; continue;
    }
    throw new ParseError(`無法識別的字元 '${c}'`, i, line, col);
  }
  push({ t: 'eof', line, col });
  return toks;
}

class P {
  constructor(toks) { this.toks = toks; this.i = 0; }
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  expect(kind) {
    const t = this.next();
    if (t.t !== kind) throw new ParseError(`期望 '${kind}'，但得到 '${t.t}'`, 0, t.line, t.col);
    return t;
  }
}

// expr := abs | app
// abs  := lam var+ '.' expr
// app  := atom+
// atom := var | num | '(' expr ')'
function parseExpr(p) {
  if (p.peek().t === 'lam') return parseAbs(p);
  return parseApp(p);
}

function parseAbs(p) {
  p.expect('lam');
  const params = [];
  while (p.peek().t === 'var') params.push(p.next().value);
  if (params.length === 0) {
    const t = p.peek();
    throw new ParseError('λ 後面至少要有一個變數', 0, t.line, t.col);
  }
  p.expect('dot');
  let body = parseExpr(p);
  // λx y. M  === λx.λy.M
  for (let k = params.length - 1; k >= 0; k--) body = Abs(params[k], body);
  return body;
}

function parseApp(p) {
  const atoms = [];
  while (true) {
    const t = p.peek();
    if (t.t === 'var') { atoms.push(Var(p.next().value)); }
    else if (t.t === 'num') { atoms.push(churchNumeral(parseInt(p.next().value, 10))); }
    else if (t.t === 'lparen') {
      p.next();
      // 允許空括號檢查
      if (p.peek().t === 'rparen') {
        const c = p.peek();
        throw new ParseError('空括號', 0, c.line, c.col);
      }
      atoms.push(parseExpr(p));
      p.expect('rparen');
    } else break;
  }
  if (atoms.length === 0) {
    const t = p.peek();
    throw new ParseError('這裡需要一個運算式', 0, t.line, t.col);
  }
  let e = atoms[0];
  for (let k = 1; k < atoms.length; k++) e = App(e, atoms[k]);
  return e;
}

/**
 * 解析完整程式：多行，每行可以是 `NAME = expr` 或單純 expr。
 * 回傳 { defs: Map(name->AST 依序), mains: AST[] }。
 * 最後一個 main 當作要化簡的目標；若無 main 則目標為 null。
 */
export function parseProgram(src) {
  const lines = splitTopLevelLines(src);
  const defs = new Map();
  const mains = [];
  for (const ln of lines) {
    if (ln.trim() === '') continue;
    const eqAt = findTopLevelEq(ln);
    if (eqAt >= 0) {
      const name = ln.slice(0, eqAt).trim();
      const rhs = ln.slice(eqAt + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_']*$/.test(name)) {
        // 不是合法定義，當一般 expr 解析（會報錯）
        mains.push(parseSingleExpr(ln));
        continue;
      }
      if (defs.has(name)) throw new Error(`重複定義：${name}`);
      defs.set(name, parseSingleExpr(rhs));
    } else {
      mains.push(parseSingleExpr(ln));
    }
  }
  return { defs, mains };
}

function splitTopLevelLines(src) {
  // 依換行切即可（括號可跨行也沒關係：先合併到括號平衡為止）
  const raw = src.split('\n');
  const out = [];
  let buf = '';
  let depth = 0;
  for (const r of raw) {
    buf += (buf ? '\n' : '') + r;
    for (const ch of r) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
    }
    if (depth <= 0) { out.push(buf); buf = ''; }
  }
  if (buf.trim() !== '') out.push(buf);
  return out;
}

function findTopLevelEq(line) {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '=' && depth === 0 && !line.startsWith('#')) return i;
  }
  return -1;
}

export function parseSingleExpr(src) {
  const toks = tokenize(src);
  const p = new P(toks);
  const e = parseExpr(p);
  if (p.peek().t !== 'eof') {
    const t = p.peek();
    throw new ParseError('運算式後面有多餘的 token', 0, t.line, t.col);
  }
  return e;
}
