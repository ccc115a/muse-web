#!/usr/bin/env node
'use strict';
/*
 * leanc.js  —  微型 Lean  ->  LBC v1 中間碼 (經 mlc AST + Desugar)
 *
 * 用法:  node leanc.js prog.lean [-o prog.lbc]      (-o - 輸出到 stdout)
 *        node leanc.js prog.lean --scheme            只印 Scheme 核心，方便除錯
 *        node lispvm.js prog.lbc
 *
 * 流程:  *.lean --(parser)--> mlc AST --(mlc Desugar)--> Scheme --(lispc)--> LBC
 * 詳見 _doc/plan2.0.md。型別全部擦除；Prop/證明項不存在。
 *
 * ── micro-Lean v1 範圍 ──
 *  inductive (非依賴) / def (單體 + 多方程式) / abbrev / #eval
 *  match (可選 h : 前綴) / if (可選 h :) / let x := e; body / fun / do
 *  Nat 字面量一律 BigInt；/ = 截斷除法；- = 截斷減法；do 取 direct-style IO
 *  不做: structure/class/instance/theorem/tactic/Nat.succ pattern/#[]/'c'/字串插值
 */
const fs = require('fs');
const lispc = require('./lispc.js');
const mlc = require('./mlc.js');

/* ─────────── Lexer ─────────── */
const KEYWORDS = new Set(['inductive', 'def', 'abbrev', 'match', 'with', 'if', 'then', 'else',
  'let', 'fun', 'do', 'return', 'deriving', 'where', 'by',
  'import', 'open', 'namespace', 'section', 'end', 'variable', 'universe',
  'instance', 'class', 'structure', 'theorem', 'lemma', 'example',
  'true', 'false']);
const TOPKW = new Set(['inductive', 'def', 'abbrev', 'import', 'open', 'namespace', 'section',
  'end', 'variable', 'universe']);
const PROOFKW = new Set(['instance', 'class', 'structure', 'theorem', 'lemma', 'example']);
const RESERVED_VAR = new Set(['nil', 'true', 'false', 'by', 'where']);

function tokenize(src) {
  const toks = []; let i = 0, line = 1, lineStart = 0, tokCol = 0;
  const push = (k, v) => toks.push({ k, v, line, col: tokCol });
  const isIdStart = c => /[A-Za-z_]/.test(c || '');
  const isIdChar = c => /[A-Za-z0-9_']/.test(c || '') || c === '?' || c === '!';   // head? / get!
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { push('nl'); line++; i++; lineStart = i; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '-') {                       // /- -/ 可巢狀
      let d = 0; i += 2;
      while (i < src.length) {
        if (src[i] === '\n') { line++; lineStart = i + 1; }
        if (src[i] === '/' && src[i + 1] === '-') { d++; i += 2; continue; }
        if (src[i] === '-' && src[i + 1] === '/') { i += 2; if (d === 0) break; d--; continue; }
        i++;
      }
      continue;
    }
    tokCol = i - lineStart;
    if (c === '"') {
      let s = ''; i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') { i++; const e = src[i]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e; }
        else { if (src[i] === '\n') { line++; lineStart = i + 1; } s += src[i]; }
        i++;
      }
      if (i >= src.length) throw new Error(`第 ${line} 行: 字串沒有結尾的引號`);
      i++; push('str', s); continue;
    }
    const rest = src.slice(i);
    let m;
    if ((m = /^\d+\.\d+/.exec(rest))) { push('num', Number(m[0])); i += m[0].length; continue; }
    if ((m = /^\d+/.exec(rest))) { push('num', BigInt(m[0])); i += m[0].length; continue; }
    if (c === '#' && isIdStart(src[i + 1])) {
      let j = i + 1; while (isIdChar(src[j])) j++;
      push('directive', src.slice(i, j)); i = j; continue;
    }
    if (c === '.' && isIdStart(src[i + 1])) {                    // .cons 前綴點名
      let j = i + 1; while (isIdChar(src[j]) || (src[j] === '.' && isIdStart(src[j + 1]))) j++;
      push('id', src.slice(i, j)); i = j; continue;
    }
    if (isIdStart(c)) {
      let j = i; while (isIdChar(src[j]) || (src[j] === '.' && isIdStart(src[j + 1]))) j++;
      const w = src.slice(i, j); i = j;
      push(KEYWORDS.has(w) ? 'kw' : 'id', KEYWORDS.has(w) ? w : w); continue;
    }
    if (rest.startsWith('←') || rest.startsWith('<-')) { push('larrow'); i += rest.startsWith('←') ? 1 : 2; continue; }
    if (rest.startsWith('→') || rest.startsWith('->')) { push('arrow'); i += rest.startsWith('→') ? 1 : 2; continue; }
    if (rest.startsWith(':=')) { push('op', ':='); i += 2; continue; }
    if (rest.startsWith('=>')) { push('op', '=>'); i += 2; continue; }
    const two = rest.slice(0, 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '::'].includes(two)) { push('op', two); i += 2; continue; }
    if ('+-*/%<>=|;,()[]:_.'.includes(c)) { push('op', c); i++; continue; }
    throw new Error(`第 ${line} 行: 無法辨識的字元 "${c}"`);
  }
  return toks;
}

/* ─────────── Parser (產 mlc AST) ─────────── */
const num = v => ({ t: 'num', v });
const vr = name => ({ t: 'var', name });
const strip = dotted => {                                        // NatList.cons / .cons -> cons
  const s = dotted.split('.').filter(x => x.length);
  if (!s.length) throw new Error(`錯誤的名稱 "${dotted}"`);
  return s[s.length - 1];
};
const C = n => 'ctor/' + n;                                      // 建構子內部名 (避開 nil 等保留字)
let gid = 0;
const tmp = (p = 'l') => `__lean${p}${gid++}`;

const LEVELS = [
  { ops: ['||'] }, { ops: ['&&'] },
  { ops: ['=', '==', '!=', '<', '>', '<=', '>='] },
  { ops: ['::'], right: true },
  { ops: ['+', '-'] }, { ops: ['*', '/', '%'] },
];

class Parser {
  constructor(toks, ctorSet = new Set()) { this.t = toks; this.p = 0; this.ctorSet = ctorSet; this.lastLine = 1; this.appBaseCol = null; }
  peek(skipNL = true) {
    let q = this.p;
    if (skipNL) while (this.t[q] && this.t[q].k === 'nl') q++;
    return this.t[q];
  }
  next(skipNL = true) {
    if (skipNL) while (this.t[this.p] && this.t[this.p].k === 'nl') this.p++;
    const t = this.t[this.p++];
    if (t) this.lastLine = t.line;
    return t;
  }
  raw() { return this.t[this.p]; }                               // 含 nl (do 專用)
  isOp(v) { const t = this.peek(); return !!t && t.k === 'op' && t.v === v; }
  isKw(v) { const t = this.peek(); return !!t && t.k === 'kw' && t.v === v; }
  isArrow() { const t = this.peek(); return !!t && (t.k === 'arrow' || (t.k === 'op' && t.v === '=>')); }
  err(msg) {
    const t = this.peek(false);
    throw new Error(t ? `第 ${t.line} 行: ${msg}` : `${msg} (已到檔案結尾)`);
  }
  expectOp(v) { if (!this.isOp(v)) this.err(`需要 "${v}"`); return this.next(); }
  expectId() { const t = this.peek(); if (!t || t.k !== 'id') this.err('需要識別字'); return this.next().v; }
  checkVar(name) { if (RESERVED_VAR.has(name)) this.err(`"${name}" 不可為變數名`); return name; }

  parseProgram() {
    const items = [
      { t: 'def', name: 'println', rec: false,                                    // 前導: IO 列印
        val: { t: 'lam', param: { p: 'var', name: 'x' }, body: { t: 'begin', items: [
          { t: 'app', f: vr('display'), a: vr('x') },
          { t: 'app', f: vr('newline'), a: { t: 'nil' } } ] } } },
      { t: 'def', name: 'print', rec: false,
        val: { t: 'lam', param: { p: 'var', name: 'x' }, body: { t: 'app', f: vr('display'), a: vr('x') } } },
    ];
    while (this.peek()) items.push(...this.parseItem());
    return items;
  }

  parseItem() {
    const t = this.peek();
    if (t.k === 'directive') {
      if (t.v !== '#eval') this.err(`不支援 ${t.v} (只有 #eval)`);
      this.next();
      const e = this.parseExpr();
      return [{ t: 'expr', e: { t: 'app', f: vr('display'), a: e } },
              { t: 'expr', e: { t: 'app', f: vr('newline'), a: { t: 'nil' } } }];
    }
    if (t.k === 'kw') {
      if (t.v === 'inductive') return [this.parseInductive()];
      if (t.v === 'def' || t.v === 'abbrev') return [this.parseDef()];
      if (TOPKW.has(t.v)) { this.next(); this.skipLine(); return []; }   // import/open/... no-op
      if (PROOFKW.has(t.v)) this.err(`"${t.v}" 不在 micro-Lean 範圍 (證明已擦除，無需寫出)`);
      this.err(`頂層需要 inductive / def / #eval (遇到 "${t.v}")`);
    }
    return [{ t: 'expr', e: this.parseExpr() }];
  }

  skipLine() { while (this.raw() && this.raw().k !== 'nl') this.p++; }
  skipTypeTo(...terms) {                                         // 跳過型別註記 (深度感知，不消耗終止符)
    const isTerm = t => (t.k === 'op' && terms.includes(t.v)) || (t.k === 'arrow' && terms.includes('->'));
    let depth = 0;
    for (;;) {
      const t = this.peek(false);
      if (!t) this.err('型別註記不完整');
      if (t.k === 'nl') { this.p++; continue; }
      if (depth === 0 && isTerm(t)) return;
      if (t.k === 'op' && (t.v === '(' || t.v === '[')) depth++;
      if (t.k === 'op' && (t.v === ')' || t.v === ']')) {
        if (depth === 0) this.err('型別註記括號不平衡');
        depth--;
      }
      this.p++;
    }
  }

  parseInductive() {
    this.next();                                                 // inductive
    const name = strip(this.expectId());
    const ctors = [];
    for (;;) {
      if (!this.isOp('|')) break;
      this.next();
      const cn = strip(this.expectId());
      if (cn === 'true' || cn === 'false') this.err(`建構子不可叫 ${cn} (與布林字面量衝突)`);
      let arity = 0;
      while (this.isOp('(')) {                                   // (T) 群計數，內容忽略
        let depth = 0;
        do {
          const t = this.next(false);
          if (!t) this.err('inductive 欄位不完整');
          if (t.k === 'op' && t.v === '(') depth++;
          if (t.k === 'op' && t.v === ')') depth--;
        } while (depth > 0);
        arity++;
      }
      if (this.isOp(':')) {                                      // : Type 跳過 (單行)
        this.next();
        let depth = 0;
        while (this.raw() && this.raw().k !== 'nl') {
          const t = this.raw();
          if (t.k === 'op' && (t.v === '(' || t.v === '[')) depth++;
          if (t.k === 'op' && (t.v === ')' || t.v === ']')) depth--;
          if (depth === 0 && t.k === 'op' && t.v === '|') break;
          this.p++;
        }
      }
      ctors.push({ name: C(cn), arity });
    }
    if (this.isKw('deriving')) { this.next(); while (this.peek() && this.peek().k === 'id') this.next(); }
    return { t: 'datatype', name, ctors };
  }

  parseBinders(explicit) {                                       // (x y : T) / {x} / [i]
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== 'op' || !['(', '{', '['].includes(t.v)) return;
      const open = this.next().v, close = open === '(' ? ')' : open === '{' ? '}' : ']';
      if (open !== '(') { let depth = 1; while (depth > 0) { const u = this.next(false); if (!u) this.err('binder 不完整'); if (u.k === 'op' && u.v === open) depth++; if (u.k === 'op' && u.v === close) depth--; } continue; }
      const names = [];
      for (;;) {                                                 // 收集名稱直到 : 或 )
        const u = this.peek();
        if (!u) this.err('binder 不完整');
        if (u.k === 'op' && u.v === ')') { this.next(); for (const n of names) explicit.push(n); break; }
        if (u.k === 'op' && u.v === ':') { this.next(); this.skipTypeTo(')'); this.expectOp(')'); for (const n of names) explicit.push(n); break; }
        if (u.k !== 'id') this.err('binder 需要參數名');
        const bn = strip(this.next().v);
        if (/^[A-Z]/.test(bn)) this.err(`函式參數須為變數 (不可用建構子 ${bn}；要用 match 或方程式)`);
        names.push(this.checkVar(bn));
      }
    }
  }

  parseDef() {
    this.next();                                                 // def / abbrev
    const name = strip(this.expectId());
    const explicit = [];
    this.parseBinders(explicit);
    if (this.isOp(':')) { this.next(); this.skipTypeTo(':=', '|'); }
    if (this.isOp('|')) return this.parseEquations(name, explicit);
    this.expectOp(':=');
    if (this.isKw('by')) this.err('tactic (by ...) 不支援');
    for (const p of explicit) if (this.knownCtor(p)) this.err(`參數名 "${p}" 與建構子衝突`);
    const body = this.parseExpr();
    if (this.isKw('where')) this.err('where 子句不支援');
    const val = explicit.reduceRight((b, p) => ({ t: 'lam', param: { p: 'var', name: p }, body: b }), body);
    return { t: 'def', name, val, rec: true };
  }

  parseEquations(name, explicit) {
    if (explicit.length) this.err('方程式與顯式參數不可並存 (二擇一)');
    const eqs = [];
    while (this.isOp('|')) {
      this.next();
      let t = this.peek();
      if (t && t.k === 'id' && strip(t.v) === name) this.next();  // 可選的函式名前綴
      const pats = [this.parsePattern()];
      while (this.isOp(',')) { this.next(); pats.push(this.parsePattern()); }
      if (this.startsPatAtom()) this.err('多參數方程式請用逗號分隔 (如 | .nil, ys => ...)');
      this.expectOp('=>');
      eqs.push({ pats, body: this.parseExpr() });
    }
    if (!eqs.length) this.err('多方程式需要至少一個 | 分支');
    const k = eqs[0].pats.length;
    eqs.forEach(e => { if (e.pats.length !== k) this.err('方程式參數個數不一致'); });
    const params = Array.from({ length: k }, () => tmp('p'));
    const scrut = k === 1 ? vr(params[0])
      : { t: 'tuple', items: params.map(p => vr(p)) };
    const clauses = eqs.map(e => ({
      pat: k === 1 ? e.pats[0] : { p: 'tuple', items: e.pats }, body: e.body }));
    const val = params.reduceRight((b, p) =>
      ({ t: 'lam', param: { p: 'var', name: p }, body: b }),
      { t: 'match', scrut, clauses });
    return { t: 'def', name, val, rec: true };
  }

  /* ── 運算式 ── */
  parseExpr() {
    const t = this.peek();
    if (!t) this.err('運算式不完整');
    if (t.k === 'kw' && t.v === 'fun') {
      this.next();
      const ps = [];
      while (!this.isArrow()) {
        if (!this.peek()) this.err('fun 缺少 =>');
        ps.push(this.parsePattern());
      }
      this.next();
      return ps.reduceRight((b, p) => ({ t: 'lam', param: p, body: b }), this.parseExpr());
    }
    if (t.k === 'kw' && t.v === 'match') {
      this.next();
      if (this.peek() && this.peek().k === 'id') {   // h : e (with 本身是 kw，不會誤判)
        const save = this.p;
        this.next();
        if (this.isOp(':')) { this.next(); } else this.p = save;
      }
      const parts = [this.parseExpr()];
      while (this.isOp(',')) { this.next(); parts.push(this.parseExpr()); }
      if (!this.isKw('with')) this.err('match 缺少 with');
      this.next();
      if (this.isOp('|')) this.next();
      const clauses = [this.parseArm()];
      while (this.isOp('|')) { this.next(); clauses.push(this.parseArm()); }
      const scrut = parts.length === 1 ? parts[0] : { t: 'tuple', items: parts };
      return { t: 'match', scrut, clauses };
    }
    if (t.k === 'kw' && t.v === 'if') {
      this.next();
      if (this.peek() && this.peek().k === 'id') {                               // h : c
        const save = this.p;
        this.next();
        if (this.isOp(':')) this.next(); else this.p = save;
      }
      const c = this.parseExpr();
      if (!(this.peek() && this.peek().k === 'kw' && this.peek().v === 'then')) this.err('if 缺少 then');
      this.next();
      const a = this.parseExpr();
      if (!(this.peek() && this.peek().k === 'kw' && this.peek().v === 'else')) this.err('if 缺少 else');
      this.next();
      return { t: 'if', c, a, b: this.parseExpr() };
    }
    if (t.k === 'kw' && t.v === 'let') {
      this.next();
      const nm = this.checkVar(strip(this.expectId()));
      this.expectOp(':=');
      const v = this.parseExpr();
      this.expectOp(';');
      return { t: 'let', pat: { p: 'var', name: nm }, val: v, body: this.parseExpr() };
    }
    if (t.k === 'kw' && t.v === 'do') return this.parseDo();
    if (t.k === 'kw' && t.v === 'return') { this.next(); return this.parseExpr(); }
    return this.parseBin(0);
  }

  parseArm() {
    const p = this.parsePattern();
    this.expectOp('=>');
    return { pat: p, body: this.parseExpr() };
  }

  parseDo() {
    this.next();                                                 // do
    const outerBase = this.appBaseCol;
    const acts = [];
    for (;;) {
      while (this.raw() && (this.raw().k === 'nl' || (this.raw().k === 'op' && this.raw().v === ';'))) this.p++;
      const t = this.raw();
      if (!t) break;
      if (t.k === 'op' && [')', ']', '}'].includes(t.v)) break;
      if (t.k === 'op' && t.v === '|') break;                    // match arm (外層接手)
      if (t.k === 'kw' && (TOPKW.has(t.v) || PROOFKW.has(t.v))) break;
      if (t.k === 'directive') break;
      this.appBaseCol = t.col;                                   // 並置跨行需比動作縮排深
      if (t.k === 'kw' && t.v === 'let') {                       // let x := e / let x ← e
        this.p++;
        const nm = this.checkVar(strip(this.expectId()));
        if (this.raw() && this.raw().k === 'op' && this.raw().v === ':=') this.p++;
        else if (this.raw() && this.raw().k === 'larrow') this.p++;
        else this.err('do- let 需要 := 或 ←');
        acts.push({ k: 'let', name: nm, val: this.parseExpr() });
        continue;
      }
      if (t.k === 'id') {                                        // x ← e ?
        let q = this.p + 1;
        while (this.t[q] && this.t[q].k === 'nl') q++;
        if (this.t[q] && this.t[q].k === 'larrow') {
          const nm = this.checkVar(strip(t.v));
          this.p = q + 1;
          acts.push({ k: 'let', name: nm, val: this.parseExpr() });
          continue;
        }
      }
      acts.push({ k: 'expr', val: this.parseExpr() });
    }
    if (!acts.length) this.err('do 需要至少一個動作');
    this.appBaseCol = outerBase;
    let body = acts[acts.length - 1].k === 'let'
      ? { t: 'app', f: vr('println'), a: { t: 'nil' } }          // 尾是 let: 補 unit
      : acts[acts.length - 1].val;
    for (let i = acts.length - 2; i >= 0; i--)
      body = acts[i].k === 'let'
        ? { t: 'let', pat: { p: 'var', name: acts[i].name }, val: acts[i].val, body }
        : { t: 'begin', items: [acts[i].val, body] };
    if (acts.length === 1 && acts[0].k === 'expr') return acts[0].val;
    return body;
  }

  natDiv(a, b) { return { t: 'app', f: { t: 'app', f: vr('quotient'), a }, a: b }; }
  natSub(a, b) {                                                 // Nat 截斷減法
    const x = tmp('s'), y = tmp('s');
    return { t: 'let', pat: { p: 'var', name: x }, val: a, body:
      { t: 'let', pat: { p: 'var', name: y }, val: b, body:
      { t: 'if', c: { t: 'binop', op: '<', l: vr(x), r: vr(y) },
        a: num(0n), b: { t: 'binop', op: '-', l: vr(x), r: vr(y) } } } };
  }

  parseBin(lv) {
    if (lv >= LEVELS.length) return this.parseUnary();
    const L = LEVELS[lv];
    let left = this.parseBin(lv + 1);
    for (;;) {
      const t = this.peek();
      if (!(t && t.k === 'op' && L.ops.includes(t.v))) break;
      this.next();
      const r = this.parseBin(L.right ? lv : lv + 1);
      if (t.v === '/') left = this.natDiv(left, r);
      else if (t.v === '-') left = this.natSub(left, r);
      else if (L.right) return { t: 'binop', op: t.v, l: left, r };
      else left = { t: 'binop', op: t.v, l: left, r };
    }
    return left;
  }

  parseUnary() {
    if (this.isOp('-')) {
      this.next();
      const e = this.parseApp();
      return e.t === 'num' && typeof e.v === 'bigint' ? num(-e.v) : this.natSub(num(0n), e);
    }
    const t = this.peek();
    if (t && t.k === 'kw' && ['fun', 'match', 'if', 'let', 'do', 'return'].includes(t.v)) return this.parseExpr();
    return this.parseApp();
  }

  startsAtom() {
    const t = this.peek();
    if (!t) return false;
    if (['num', 'str', 'id'].includes(t.k)) return true;
    if (t.k === 'kw') return ['true', 'false'].includes(t.v);
    return t.k === 'op' && (t.v === '(' || t.v === '[');
  }

  parseApp() {
    let f = this.parseAtom();
    for (;;) {
      if (!this.startsAtom()) break;
      const a = this.peek();
      // do-action 內的並置: 跨行需更深縮排，否則是下一個動作 (do 外不限)
      if (this.appBaseCol !== null && a.line > this.lastLine && !(a.col > this.appBaseCol)) break;
      f = { t: 'app', f, a: this.parseAtom() };
    }
    return f;
  }

  parseAtom() {
    const t = this.next();
    if (!t) this.err('運算式不完整');
    if (t.k === 'num') return num(t.v);
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'id') {
      const nm = strip(t.v);
      if (this.knownCtor(nm)) return vr(C(nm));
      if (/^[A-Z]/.test(nm)) this.err(`未知建構子 "${nm}" (inductive 宣告了嗎?)`);
      if (RESERVED_VAR.has(nm)) this.err(`"${t.v}" 不可為變數`);
      return vr(nm);
    }
    if (t.k === 'kw') {
      if (t.v === 'true') return { t: 'bool', v: true };
      if (t.v === 'false') return { t: 'bool', v: false };
    }
    if (t.k === 'op') {
      if (t.v === '(') {
        if (this.isOp(')')) { this.next(); return { t: 'nil' }; }
        const e = this.parseExpr();
        if (this.isOp(',')) {
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

  /* ── pattern (mlc 形狀) ── */
  parsePattern() { return this.parsePatCons(); }
  parsePatCons() {
    const left = this.parsePatApp();
    if (this.isOp('::')) { this.next(); return { p: 'cons', h: left, t: this.parsePatCons() }; }
    return left;
  }
  parsePatApp() {
    const t = this.peek();
    if (t && t.k === 'id') {
      const nm = strip(t.v);
      this.next();
      if (/^[A-Z]/.test(nm) || this.knownCtor(nm)) {
        if (!this.knownCtor(nm)) this.err(`未知建構子 "${nm}"`);
        const args = [];
        while (this.startsPatAtom()) args.push(this.parsePatAtom());
        return { p: 'ctor', name: C(nm), args };
      }
      if (nm === '_') return { p: 'wild' };
      if (RESERVED_VAR.has(nm)) this.err(`"${nm}" 不可為 pattern`);
      return { p: 'var', name: nm };
    }
    return this.parsePatAtom();
  }
  knownCtor(nm) { return this.ctorSet && this.ctorSet.has(C(nm)); }
  startsPatAtom() {
    const t = this.peek();
    if (!t) return false;
    if (['num', 'str', 'id'].includes(t.k)) return true;
    if (t.k === 'kw') return ['true', 'false'].includes(t.v);
    return t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '_');
  }
  parsePatAtom() {
    const t = this.next();
    if (!t) this.err('pattern 不完整');
    if (t.k === 'num') return typeof t.v === 'bigint' ? { p: 'const', v: t.v } : { p: 'const', v: t.v };
    if (t.k === 'str') return { p: 'str', v: t.v };
    if (t.k === 'id') {
      const nm = strip(t.v);
      if (nm === '_') return { p: 'wild' };
      if (/^[A-Z]/.test(nm) || this.knownCtor(nm)) return { p: 'ctor', name: C(nm), args: [] };
      if (RESERVED_VAR.has(nm)) this.err(`"${nm}" 不可為 pattern`);
      return { p: 'var', name: nm };
    }
    if (t.k === 'kw') {
      if (t.v === 'true') return { p: 'const', v: true };
      if (t.v === 'false') return { p: 'const', v: false };
    }
    if (t.k === 'op') {
      if (t.v === '_') return { p: 'wild' };
      if (t.v === '(') {
        if (this.isOp(')')) { this.next(); return { p: 'nil' }; }
        const a = this.parsePattern();
        if (this.isOp(',')) {
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

function prescanCtors(toks) {                                // 先掃 inductive 建構子名 (pattern 判別用)
  const set = new Set(); let inInd = false;
  const at = i => { while (i < toks.length && toks[i].k === 'nl') i++; return toks[i]; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'kw' && (TOPKW.has(t.v) || PROOFKW.has(t.v))) inInd = (t.v === 'inductive');
    else if (t.k === 'directive') inInd = false;
    else if (inInd && t.k === 'op' && t.v === '|') {
      let j = i + 1;
      while (toks[j] && toks[j].k === 'nl') j++;
      if (toks[j] && toks[j].k === 'id') set.add(C(strip(toks[j].v)));
    }
  }
  return { set, at };
}

function toScheme(src) {
  gid = 0;
  const toks = tokenize(src);
  const parser = new Parser(toks, prescanCtors(toks).set);
  return new mlc.Desugar().program(parser.parseProgram());
}
function compile(src) { return lispc.compile(toScheme(src)); }
module.exports = { compile, toScheme, tokenize };

/* ─────────── CLI ─────────── */
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('用法: node leanc.js prog.lean [-o prog.lbc] [--scheme]'); process.exit(1); }
  const input = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-o');
  const oi = args.indexOf('-o');
  const output = oi >= 0 ? args[oi + 1] : input.replace(/\.[^.]*$/, '') + '.lbc';
  try {
    const src = fs.readFileSync(input, 'utf8');
    if (args.includes('--scheme')) process.stdout.write(toScheme(src));
    else { const bc = compile(src); if (output === '-') process.stdout.write(bc); else { fs.writeFileSync(output, bc); console.error(`已編譯 ${input} -> ${output}`); } }
  } catch (e) { console.error('編譯錯誤: ' + e.message); process.exit(1); }
}
