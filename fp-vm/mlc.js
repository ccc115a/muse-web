#!/usr/bin/env node
'use strict';
/*
 * mlc.js  —  迷你 ML  ->  LBC v1 中間碼 (經 Scheme 核心，用 lispc.js 編譯)
 *
 * 用法:  node mlc.js prog.ml [-o prog.fbc]      (-o - 輸出到 stdout)
 *        node mlc.js prog.ml --scheme            只印 Scheme 核心，方便除錯
 *        node fpvm.js prog.fbc
 *
 * 流程:  *.ml --(parser)--> AST --(desugar)--> Scheme --(lispc.js)--> LBC
 * 詳見 _doc/plan1.1.md。型別全部擦除，不做型別檢查。
 *
 * ── 語法 ──
 *  prog  := 項目 (";" 項目)* [";"]              -- 註解以 -- 開頭
 *  項目  := datatype NAME = Ctor (of T (* T)*)? (| Ctor (of ...)?)*
 *          | let NAME pat* = expr               頂層定義
 *          | letrec NAME pat* = expr             頂層遞迴定義
 *          | expr
 *  expr  := \pat. expr | fun pat* -> expr
 *          | match expr with [|] pat -> expr (| pat -> expr)*
 *          | let pat = expr in expr
 *          | if c then a else b
 *          | e = e | e <> e | e != e | e == e | e < e | ... (見 LEVELS)
 *          | f a b (curried 應用) | (expr) | (e1, e2[, e3]) | [e, ...] | () | 原子
 *  pat   := _ | x | 數字 | "字串" | true | false | nil | [] | Ctor | Ctor pat ...
 *          | p1 :: p2 | (p1, p2) | [p1, ...] | (pat)
 *
 * ── 編碼 ──
 *  ML list = LBC 原生 list ([] = '()，:: = cons)。
 *  自訂 Ctor: nullary = 'Ctor；n>0 = (list 'Ctor v0 v1...)。
 *  (a,b) = (list 'Pair a b)，(a,b,c) = (list 'Triple a b c)。
 *  match 編成 cond/if + car/cdr，缺 else 補 (error "Match_failure")。
 */
const fs = require('fs');
const lispc = require('./lispc.js');

/* ─────────── Lexer ─────────── */
const KEYWORDS = new Set(['datatype', 'match', 'with', 'fun', 'let', 'letrec', 'in',
  'if', 'then', 'else', 'true', 'false', 'nil', 'of']);
const SECTION_OPS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '@']);

function tokenize(src) {
  const toks = []; let i = 0, line = 1;
  const push = (k, v) => toks.push({ k, v, line });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"') {
      let s = ''; i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') { i++; const e = src[i]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; }
        else { if (src[i] === '\n') line++; s += src[i]; }
        i++;
      }
      if (i >= src.length) throw new Error(`第 ${line} 行: 字串沒有結尾的引號`);
      i++; push('str', s); continue;
    }
    const rest = src.slice(i);
    let m;
    if (c === "'") {  // 型別變數 'a（of 子句用，忽略內容）
      m = /^'[A-Za-z_][A-Za-z0-9_']*/.exec(rest);
      if (!m) throw new Error(`第 ${line} 行: 無法辨識的字元 "'"`);
      push('id', m[0]); i += m[0].length; continue;
    }
    if ((m = /^\d+(\.\d+)?/.exec(rest))) { push('num', Number(m[0])); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_][A-Za-z0-9_']*/.exec(rest))) {
      push(KEYWORDS.has(m[0]) ? 'kw' : 'id', m[0]); i += m[0].length; continue;
    }
    if (c === '\\' || c === 'λ') { push('lam'); i++; continue; }
    const three = rest.slice(0, 3);
    const two = rest.slice(0, 2);
    if (two === '->') { push('arrow'); i += 2; continue; }
    if (['::', '==', '!=', '<>', '<=', '>=', '&&', '||'].includes(two)) { push('op', two); i += 2; continue; }
    if ('+-*/%<>=@.,;()[]|_:'.includes(c)) { push('op', c); i++; continue; }
    throw new Error(`第 ${line} 行: 無法辨識的字元 "${c}"`);
  }
  return toks;
}

/* ─────────── AST ─────────── */
const num = v => ({ t: 'num', v });
const vr = name => ({ t: 'var', name });
const lam = (param, body) => ({ t: 'lam', param, body });

const LEVELS = [
  { ops: ['||'] }, { ops: ['&&'] },
  { ops: ['=', '==', '!=', '<>', '<', '>', '<=', '>='] },
  { ops: ['::', '@'], right: true },
  { ops: ['+', '-'] }, { ops: ['*', '/', '%'] },
];

class Parser {
  constructor(toks) { this.t = toks; this.p = 0; }
  peek() { return this.t[this.p]; }
  next() { return this.t[this.p++]; }
  isOp(v) { const t = this.peek(); return !!t && t.k === 'op' && t.v === v; }
  isKw(v) { const t = this.peek(); return !!t && t.k === 'kw' && t.v === v; }
  isArrow() { const t = this.peek(); return !!t && t.k === 'arrow'; }
  err(msg) {
    const t = this.peek();
    throw new Error(t ? `第 ${t.line} 行: ${msg}` : `${msg} (已到檔案結尾)`);
  }
  expectOp(v) { if (!this.isOp(v)) this.err(`需要 "${v}"`); return this.next(); }
  expectKw(v) { if (!this.isKw(v)) this.err(`需要 "${v}"`); return this.next(); }
  expectId() { const t = this.peek(); if (!t || t.k !== 'id') this.err('需要識別字'); return this.next().v; }

  parseProgram() {
    const items = [];
    while (this.peek()) {
      if (this.isOp(';')) { this.next(); continue; }
      items.push(this.parseItem());
      if (this.peek() && !this.isOp(';')) this.err('缺少 ";"');
    }
    return items;
  }

  parseItem() {
    if (this.isKw('datatype')) return this.parseDatatype();
    if (this.isKw('let') || this.isKw('letrec')) {
      const saved = this.p, rec = this.next().v === 'letrec';
      const name = this.expectId();
      const params = [];
      while (this.peek() && (this.peek().k === 'id' || this.peek().v === '_' || this.isOp('(') || this.isOp('['))) {
        params.push(this.parsePattern());
        if (this.isOp('=')) break;
      }
      if (!this.isOp('=')) { this.p = saved; return { t: 'expr', e: this.parseExpr() }; }
      this.next();
      const val = params.reduceRight((b, p) => ({ t: 'lam', param: p, body: b }), this.parseExpr());
      if (this.isKw('in')) { this.p = saved; return { t: 'expr', e: this.parseExpr() }; }  // 其實是 let...in 運算式
      if (['apply', 'throw', 'quote', 'lambda', 'begin', 'cond', 'and', 'or',
           'when', 'unless', 'define', 'set!'].includes(name))
        this.err(`"${name}" 為保留字，不可定義 (特殊形)`);
      return { t: 'def', name, val, rec };
    }
    return { t: 'expr', e: this.parseExpr() };
  }
  isOpAhead(v) {
    const t = this.t[this.p + 1];
    return !!t && t.k === 'op' && t.v === v;
  }

  parseDatatype() {
    this.expectKw('datatype');
    const name = this.expectId();
    this.expectOp('=');
    const ctors = [];
    for (;;) {
      const cname = this.expectId();
      let arity = 0;
      if (this.isKw('of')) {
        this.next();
        arity = 1;
        let depth = 0;
        while (this.peek() && !(depth === 0 && (this.isOp('|') || this.isOp(';')))) {
          if (this.isOp('(')) depth++;
          if (this.isOp(')')) depth--;
          if (depth === 0 && this.isOp('*')) arity++;
          this.next();
          if (!this.peek()) break;
        }
      }
      ctors.push({ name: cname, arity });
      if (this.isOp('|')) { this.next(); continue; }
      break;
    }
    return { t: 'datatype', name, ctors };
  }

  parseExpr() {
    const t = this.peek();
    if (!t) this.err('運算式不完整');
    if (t.k === 'lam') {
      this.next();
      const p = this.parsePattern();
      this.expectOp('.');
      return { t: 'lam', param: p, body: this.parseExpr() };
    }
    if (this.isKw('fun')) {
      this.next();
      const params = [];
      while (!this.isArrow()) {
        if (!this.peek()) this.err('fun 缺少 ->');
        params.push(this.parsePattern());
      }
      this.next();
      return params.reduceRight((b, p) => ({ t: 'lam', param: p, body: b }), this.parseExpr());
    }
    if (this.isKw('let') || this.isKw('letrec')) {
      const rec = this.next().v === 'letrec';
      const pat = this.parsePattern();
      // 函式簡寫: let f x y = e (不含 in 的話由 parseItem 處理，這裡一定有 in)
      const extra = [];
      while (!this.isOp('=') && !this.isArrow()) {
        if (!this.peek()) this.err('let 缺少 =');
        if (this.isKw('in')) break;
        extra.push(this.parsePattern());
      }
      this.expectOp('=');
      // 需分辨 let x = e in body：先解析 val 到 in 為止
      const valStart = this.p;
      const val = this.parseExpr();
      if (!this.isKw('in')) this.err('let 缺少 in');
      this.next();
      const body = this.parseExpr();
      const fullVal = extra.reduceRight((b, p) => ({ t: 'lam', param: p, body: b }), val);
      void valStart;
      return { t: rec ? 'letrec' : 'let', pat, val: fullVal, body };
    }
    if (this.isKw('match')) {
      this.next();
      const scrut = this.parseExpr();
      this.expectKw('with');
      if (this.isOp('|')) this.next();
      const clauses = [];
      clauses.push(this.parseClause());
      while (this.isOp('|')) { this.next(); clauses.push(this.parseClause()); }
      return { t: 'match', scrut, clauses };
    }
    if (this.isKw('if')) {
      this.next();
      const c = this.parseExpr(); this.expectKw('then');
      const a = this.parseExpr(); this.expectKw('else');
      return { t: 'if', c, a, b: this.parseExpr() };
    }
    return this.parseBin(0);
  }

  parseClause() {
    const pat = this.parsePattern();
    if (!this.isArrow()) this.err('match 子句需要 ->');
    this.next();
    return { pat, body: this.parseExpr() };
  }

  parseBin(lv) {
    if (lv >= LEVELS.length) return this.parseUnary();
    const L = LEVELS[lv];
    let left = this.parseBin(lv + 1);
    for (;;) {
      const t = this.peek();
      if (!(t && t.k === 'op' && L.ops.includes(t.v))) break;
      this.next();
      if (L.right) return { t: 'binop', op: t.v, l: left, r: this.parseBin(lv) };
      left = { t: 'binop', op: t.v, l: left, r: this.parseBin(lv + 1) };
    }
    return left;
  }

  parseUnary() {
    if (this.isOp('-')) {
      this.next();
      const e = this.parseApp();
      return e.t === 'num' ? num(-e.v) : { t: 'binop', op: '-', l: num(0), r: e };
    }
    const t = this.peek();
    if (t && (t.k === 'lam' || (t.k === 'kw' && ['fun', 'let', 'letrec', 'match', 'if'].includes(t.v))))
      return this.parseExpr();
    return this.parseApp();
  }

  startsAtom() {
    const t = this.peek();
    if (!t) return false;
    if (['num', 'str', 'id'].includes(t.k)) return true;
    if (t.k === 'kw') return ['true', 'false', 'nil'].includes(t.v);
    return t.k === 'op' && (t.v === '(' || t.v === '[');
  }

  parseApp() {
    let f = this.parseAtom();
    while (this.startsAtom()) f = { t: 'app', f, a: this.parseAtom() };
    return f;
  }

  parseAtom() {
    const t = this.next();
    if (!t) this.err('運算式不完整');
    if (t.k === 'num') return num(t.v);
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'id') return vr(t.v);
    if (t.k === 'kw') {
      if (t.v === 'true') return { t: 'bool', v: true };
      if (t.v === 'false') return { t: 'bool', v: false };
      if (t.v === 'nil') return { t: 'nil' };
    }
    if (t.k === 'op') {
      if (t.v === '(') {
        if (this.isOp(')')) { this.next(); return { t: 'nil' }; }  // () 單位兼空串列
        const o = this.peek();
        if (o && o.k === 'op' && SECTION_OPS.has(o.v) && this.t[this.p + 1] && this.t[this.p + 1].v === ')' && this.t[this.p + 1].k === 'op') {
          this.p += 2; return vr(o.v);
        }
        const e = this.parseExpr();
        if (this.isOp(',')) {  // tuple
          const items = [e];
          while (this.isOp(',')) { this.next(); items.push(this.parseExpr()); }
          this.expectOp(')');
          return { t: 'tuple', items };
        }
        this.expectOp(')');
        return e;
      }
      if (t.v === '[') {
        const items = [];
        if (!this.isOp(']')) { items.push(this.parseExpr()); while (this.isOp(',')) { this.next(); items.push(this.parseExpr()); } }
        this.expectOp(']');
        return items.reduceRight((acc, x) => ({ t: 'binop', op: '::', l: x, r: acc }), { t: 'nil' });
      }
    }
    this.p--; this.err('無法解析的運算式');
  }

  /* ── pattern ── */
  parsePattern() { return this.parsePatCons(); }

  parsePatCons() {
    let left = this.parsePatApp();
    if (this.isOp('::')) {
      this.next();
      return { p: 'cons', h: left, t: this.parsePatCons() };
    }
    return left;
  }

  parsePatApp() {
    const t = this.peek();
    // Ctor p1 p2 ...：大寫開頭的 id 後接原子 pattern
    if (t && t.k === 'id' && /^[A-Z]/.test(t.v)) {
      this.next();
      const args = [];
      while (this.startsPatAtom()) args.push(this.parsePatAtom());
      return args.length ? { p: 'ctor', name: t.v, args } : { p: 'ctor', name: t.v, args: [] };
    }
    return this.parsePatAtom();
  }

  startsPatAtom() {
    const t = this.peek();
    if (!t) return false;
    if (['num', 'str', 'id'].includes(t.k)) return true;
    if (t.k === 'kw') return ['true', 'false', 'nil'].includes(t.v);
    if (t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '_')) return true;
    return false;
  }

  parsePatAtom() {
    const t = this.next();
    if (!t) this.err('pattern 不完整');
    if (t.k === 'id') {
      if (t.v === '_') return { p: 'wild' };
      if (/^[A-Z]/.test(t.v)) return { p: 'ctor', name: t.v, args: [] };
      return { p: 'var', name: t.v };
    }
    if (t.k === 'num') return { p: 'const', v: t.v };
    if (t.k === 'str') return { p: 'str', v: t.v };
    if (t.k === 'kw') {
      if (t.v === 'true') return { p: 'const', v: true };
      if (t.v === 'false') return { p: 'const', v: false };
      if (t.v === 'nil') return { p: 'nil' };
    }
    if (t.k === 'op') {
      if (t.v === '_') return { p: 'wild' };
      if (t.v === '(') {
        if (this.peek() && this.peek().k === 'op' && this.peek().v === ')') { this.next(); return { p: 'nil' }; }
        const a = this.parsePattern();
        if (this.peek() && this.peek().k === 'op' && this.peek().v === ',') {
          const items = [a];
          while (this.isOp(',')) { this.next(); items.push(this.parsePattern()); }
          this.expectOp(')');
          return { p: 'tuple', items };
        }
        this.expectOp(')');
        return a;
      }
      if (t.v === '[') {
        if (this.isOp(']')) { this.next(); return { p: 'nil' }; }
        const items = [this.parsePattern()];
        while (this.isOp(',')) { this.next(); items.push(this.parsePattern()); }
        this.expectOp(']');
        return items.reduceRight((acc, x) => ({ p: 'cons', h: x, t: acc }), { p: 'nil' });
      }
    }
    this.p--; this.err('無法解析的 pattern');
  }
}

/* ─────────── Desugar: ML AST -> Scheme ───────────
 * Scheme 以 JS 值表示: string=符號, number, boolean, SStr=字串, Array=list。
 */
class SStr { constructor(v) { this.v = v; } }
let gid = 0;
const tmp = (p = 'm') => `__${p}${gid++}`;

const BINOP = {
  '+': '+', '-': '-', '*': '*', '/': '/', '%': 'modulo',
  '<': '<', '>': '>', '<=': '<=', '>=': '>=',
  '=': 'equal?', '==': 'equal?', '::': 'cons', '@': 'append',
};

/* LBC 原語表: ML 層名稱 -> arity（`list` 為多變元）。使用者函式一律 curried
 * (nested 單參數 lambda)，原語則保持多參數直接呼叫。 */
const PRIM_ARITY = new Map(Object.entries({
  '+': 2, '-': 2, '*': 2, '/': 2, 'modulo': 2, 'quotient': 2, 'remainder': 2,
  'min': 2, 'max': 2, '=': 2, '<': 2, '>': 2, '<=': 2, '>=': 2,
  'equal?': 2, 'eq?': 2, 'cons': 2, 'append': 2,
  'abs': 1, 'not': 1, 'car': 1, 'cdr': 1, 'length': 1, 'reverse': 1,
  'null?': 1, 'pair?': 1, 'number?': 1, 'string?': 1, 'symbol?': 1,
  'zero?': 1, 'even?': 1, 'odd?': 1, 'display': 1, 'write': 1, 'newline': 1, 'error': 1,
  'string-append': 2,
  'array-get': 2, 'array-set': 3, 'array-push': 2, 'array-size': 1, 'array?': 1,
  'string-ref': 2, 'substring': 3,
  'bit-and': 2, 'bit-or': 2, 'bit-xor': 2,
}));
const VARIADIC = new Set(['list']);

class Desugar {
  constructor() { this.ctors = new Map(); this.globals = new Set(); this.pre = []; }
  collect(items) {
    for (const it of items) {
      if (it.t === 'datatype') for (const c of it.ctors) {
        if (this.ctors.has(c.name)) throw new Error(`重複的建構子 ${c.name}`);
        this.ctors.set(c.name, c.arity);
        this.globals.add(c.name);
      }
      if (it.t === 'def') this.globals.add(it.name);
    }
    // tuple 內建視為 arity 固定 ctor（不需 define，直接展開）
  }
  isCtor(name) { return this.ctors.has(name); }

  emitCtors() {
    const out = [];
    for (const [name, arity] of this.ctors) {
      if (arity === 0) out.push(['define', name, ['quote', name]]);
      else {
        const ps = Array.from({ length: arity }, (_, i) => `__a${i}`);
        let body = ['list', ['quote', name], ...ps];
        for (let i = arity - 1; i >= 0; i--) body = ['lambda', [ps[i]], body];
        out.push(['define', name, body]);
      }
    }
    return out;
  }

  ex(n) {
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return new SStr(n.v);
      case 'bool': return n.v;
      case 'nil': return ['quote', []];
      case 'var': return n.name;
      case 'tuple': {
        const tag = n.items.length === 2 ? 'Pair' : n.items.length === 3 ? 'Triple' : null;
        if (!tag) throw new Error('tuple 只支援 2 或 3 元');
        return ['list', ['quote', tag], ...n.items.map(x => this.ex(x))];
      }
      case 'binop': {
        if (n.op === '!=' || n.op === '<>') return ['not', ['equal?', this.ex(n.l), this.ex(n.r)]];
        if (n.op === '&&') return ['if', this.ex(n.l), this.ex(n.r), false];
        if (n.op === '||') { const g = tmp(); return ['let', [[g, this.ex(n.l)]], ['if', g, g, this.ex(n.r)]]; }
        const op = BINOP[n.op];
        if (!op) throw new Error('未知運算子 ' + n.op);
        return [op, this.ex(n.l), this.ex(n.r)];
      }
      case 'app': {
        const args = []; let h = n;
        while (h.t === 'app') { args.unshift(h.a); h = h.f; }
        const axs = args.map(a => this.ex(a));
        // LBC 原語(未被使用者遮蔽): 依 arity 直接呼叫 / eta 展開 / 逐段套用
        if (h.t === 'var' && !this.globals.has(h.name) &&
            (PRIM_ARITY.has(h.name) || VARIADIC.has(h.name))) {
          if (VARIADIC.has(h.name)) return [h.name, ...axs];
          const k = PRIM_ARITY.get(h.name);
          if (axs.length === k) return [h.name, ...axs];
          if (axs.length < k) {
            const ps = Array.from({ length: k - axs.length }, () => tmp('p'));
            let body = [h.name, ...axs, ...ps];
            for (let i = ps.length - 1; i >= 0; i--) body = ['lambda', [ps[i]], body];
            return body;
          }
          let node = [h.name, ...axs.slice(0, k)];
          for (const a of axs.slice(k)) node = [node, a];
          return node;
        }
        // 使用者函式一律 curried: f a b  =>  ((f a) b)
        return axs.reduce((f, a) => [f, a], this.ex(h));
      }
      case 'lam': return this.exLam(n.param, n.body);
      case 'if': return ['if', this.ex(n.c), this.ex(n.a), this.ex(n.b)];
      case 'begin': return ['begin', ...n.items.map(x => this.ex(x))];
      case 'call': return [this.ex(n.f), ...n.args.map(a => this.ex(a))];   // 直接多參呼叫 (給 prim 用；不可 curry)
      case 'apply': return ['apply', this.ex(n.f), this.ex(n.lst)];   // 動態套用 (lispc APPLY)
      case 'sym': return ['quote', n.name];                          // 符號字面量 (給 class/tag 用)
      case 'try': return ['try', this.ex(n.body), ['catch', n.var, this.ex(n.handler)]];
      case 'let': return this.exLet(n);
      case 'letrec': return this.exLetRec(n);
      case 'match': return this.exMatch(this.ex(n.scrut), n.clauses);
    }
    throw new Error('無法編譯的節點: ' + n.t);
  }

  exLam(param, body) {
    if (param.p === 'var' || param.p === 'wild') {
      const nm = param.p === 'var' ? param.name : tmp('u');
      return ['lambda', [nm], this.ex(body)];
    }
    // 複雜 pattern: \p. e  =>  (lambda (tmp) (match tmp with p -> e))
    const g = tmp('a');
    return ['lambda', [g], this.exMatch(g, [{ pat: param, body }])];
  }

  exLet(n) {
    if (n.pat.p === 'var') return ['let', [[n.pat.name, this.ex(n.val)]], this.ex(n.body)];
    if (n.pat.p === 'wild') return ['begin', this.ex(n.val), this.ex(n.body)];
    return this.exMatch(this.ex(n.val), [{ pat: n.pat, body: n.body }]);
  }

  exLetRec(n) {
    if (n.pat.p === 'var')
      return ['letrec', [[n.pat.name, this.ex(n.val)]], this.ex(n.body)];
    throw new Error('letrec 的 pattern 必須是變數');
  }

  /* match 編譯: scrut 已是 Scheme；每子句轉成 if 鏈，保持尾位置 */
  exMatch(scrut, clauses) {
    const g = tmp();
    let tail = ['error', new SStr('Match_failure')];
    let hasCatchAll = false;
    for (let i = clauses.length - 1; i >= 0; i--) {
      const { tests, binds } = this.patTests(clauses[i].pat, g);
      let body = this.ex(clauses[i].body);
      if (binds.length) body = ['let', binds, body];
      if (!tests.length) { tail = body; hasCatchAll = true; continue; }
      const test = tests.length === 1 ? tests[0] : ['and', ...tests];
      tail = ['if', test, body, tail];
    }
    void hasCatchAll;
    return ['let', [[g, scrut]], tail];
  }

  accessor(base, k) {  // ctor 第 k 個欄位 (0-based): (car (cdr ...)) k+1 次 cdr
    let e = base;
    for (let i = 0; i <= k; i++) e = ['cdr', e];
    return ['car', e];
  }

  patTests(p, v) {
    const tests = [], binds = [];
    const walk = (p, v) => {
      switch (p.p) {
        case 'wild': return;
        case 'var': binds.push([p.name, v]); return;
        case 'nil': tests.push(['null?', v]); return;
        case 'const':
          tests.push(['equal?', v, p.v]); return;
        case 'str':
          tests.push(['equal?', v, new SStr(p.v)]); return;
        case 'tuple': {
          const tag = p.items.length === 2 ? 'Pair' : p.items.length === 3 ? 'Triple' : null;
          if (!tag) throw new Error('tuple pattern 只支援 2 或 3 元');
          tests.push(['pair?', v], ['eq?', ['car', v], ['quote', tag]]);
          p.items.forEach((s, k) => walk(s, this.accessor(v, k)));
          return;
        }
        case 'cons':
          tests.push(['pair?', v]);
          walk(p.h, ['car', v]);
          walk(p.t, ['cdr', v]);
          return;
        case 'ctor': {
          const ar = p.args.length;
          if (ar === 0) {
            if (this.ctors.get(p.name) > 0) throw new Error(`建構子 ${p.name} 需要 ${this.ctors.get(p.name)} 個參數`);
            tests.push(['eq?', v, ['quote', p.name]]);
            return;
          }
          tests.push(['pair?', v], ['eq?', ['car', v], ['quote', p.name]]);
          p.args.forEach((s, k) => walk(s, this.accessor(v, k)));
          return;
        }
      }
      throw new Error('錯誤的 pattern');
    };
    walk(p, v);
    return { tests, binds };
  }

  show(x) {
    if (typeof x === 'bigint') return String(x) + 'N';   // lispc 讀成 BigInt
    if (typeof x === 'number') return String(x);
    if (typeof x === 'string') return x;
    if (x === true) return '#t';
    if (x === false) return '#f';
    if (x instanceof SStr) return JSON.stringify(x.v);
    if (Array.isArray(x)) return '(' + x.map(e => this.show(e)).join(' ') + ')';
    throw new Error('無法輸出 Scheme');
  }

  program(items) {
    gid = 0;
    this.collect(items);
    const out = [...this.emitCtors()];
    for (const it of items) {
      if (it.t === 'datatype') continue;
      if (it.t === 'def') {
        // 顶层 let f p1 p2 = e 已在 parse 包成 lam；直接 define
        out.push(['define', it.name, this.ex(it.val)]);
      } else out.push(this.ex(it.e));
    }
    return out.map(x => this.show(x)).join('\n') + '\n';
  }
}

function toScheme(src) {
  const items = new Parser(tokenize(src)).parseProgram();
  return new Desugar().program(items);
}
function compile(src) { return lispc.compile(toScheme(src)); }
module.exports = { compile, toScheme, Desugar };

/* ─────────── CLI ─────────── */
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('用法: node mlc.js prog.ml [-o prog.fbc] [--scheme]'); process.exit(1); }
  const input = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-o');
  const oi = args.indexOf('-o');
  const output = oi >= 0 ? args[oi + 1] : input.replace(/\.[^.]*$/, '') + '.fbc';
  try {
    const src = fs.readFileSync(input, 'utf8');
    if (args.includes('--scheme')) process.stdout.write(toScheme(src));
    else { const bc = compile(src); if (output === '-') process.stdout.write(bc); else { fs.writeFileSync(output, bc); console.error(`已編譯 ${input} -> ${output}`); } }
  } catch (e) { console.error('編譯錯誤: ' + e.message); process.exit(1); }
}
