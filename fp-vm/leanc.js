#!/usr/bin/env node
'use strict';
/*
 * leanc.js  —  微型 Lean  ->  LBC v1 中間碼 (經 mlc AST + Desugar)
 *
 * 用法:  node leanc.js prog.lean [-o prog.fbc]      (-o - 輸出到 stdout)
 *        node leanc.js prog.lean --scheme            只印 Scheme 核心，方便除錯
 *        node fpvm.js prog.fbc
 *
 * 流程:  *.lean --(parser)--> mlc AST --(mlc Desugar)--> Scheme --(lispc)--> LBC
 * 詳見 _doc/plan2.0.md。型別全部擦除；Prop/證明項不存在。
 *
 * ── micro-Lean v2.2 範圍 ──
 *  inductive (非依賴) / structure (降單 ctor + 投影) / class / instance / deriving BEq,Repr
 *  def (單體 + 多方程式) / abbrev / #eval
 *  match (可選 h : 前綴) / if (可選 h :) / let x := e; body / fun / do
 *  try BODY catch VAR => HANDLER / {...} 實例 / {p with ...} 更新 / #[...] array
 *  Nat 字面量一律 BigInt；/ = 截斷除法；- = 截斷減法；do 取 direct-style IO
 *  方法呼叫按執行期標籤分派 (首參數)；Nat/String/Bool 實例暫無；p.x 點記法不支援
 *  不做: theorem/tactic/Nat.succ pattern/'c'/字串插值/extends/具名遞迴實例
 */
const fs = require('fs');
const lispc = require('./lispc.js');
const mlc = require('./mlc.js');

/* ─────────── Lexer ─────────── */
const KEYWORDS = new Set(['inductive', 'structure', 'def', 'abbrev', 'match', 'with', 'if', 'then', 'else',
  'let', 'have', 'fun', 'do', 'return', 'try', 'catch', 'deriving', 'where', 'by',
  'import', 'open', 'namespace', 'section', 'end', 'variable', 'universe', 'mutual', 'set_option',
  'private', 'protected', 'unsafe', 'partial', 'noncomputable',
  'instance', 'class', 'theorem', 'lemma', 'example',
  'true', 'false']);
const MODIFIERS = new Set(['private', 'protected', 'unsafe', 'partial', 'noncomputable']);
const TOPKW = new Set(['inductive', 'structure', 'class', 'instance', 'def', 'abbrev', 'import', 'open', 'namespace', 'section',
  'end', 'variable', 'universe']);
const PROOFKW = new Set(['theorem', 'lemma', 'example']);
const RESERVED_VAR = new Set(['nil', 'true', 'false', 'by', 'where']);
// lispc 特殊形名: 定義了會被靜默劫持 (呼叫形狀撞特殊形)，直接禁止
const RESERVED_LISPC = new Set(['apply', 'throw', 'quote', 'lambda', 'begin',
  'cond', 'and', 'or', 'when', 'unless', 'define', 'set!']);

function tokenize(src) {
  const toks = []; let i = 0, line = 1, lineStart = 0, tokCol = 0;
  const push = (k, v) => toks.push({ k, v, line, col: tokCol });
  const isIdStart = c => c !== 'λ' && /[\p{L}_]/u.test(c || '');
  const isIdChar = c => (c !== 'λ' && /[\p{L}\p{Nd}_']/u.test(c || '')) || c === '?' || c === '!';   // head? / get!
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
    // 緊貼數字的負號: 前面是空白/開括號/運算子才算一元 (否則是減法；a-5 保持二元)
    if (c === '-' && /[0-9]/.test(src[i + 1] || '')) {
      const pc = i === 0 ? ' ' : src[i - 1];
      if (/[\s([{,;:|=+\-*/%<>&@~^]/.test(pc)) {
        const rest2 = src.slice(i + 1);
        let m2;
        if ((m2 = /^0[xX][0-9a-fA-F][0-9a-fA-F_]*/.exec(rest2))) { push('num', -BigInt('0x' + m2[0].slice(2).replace(/_/g, ''))); i += 1 + m2[0].length; continue; }
        if ((m2 = /^0[oO][0-7][0-7_]*/.exec(rest2))) { push('num', -BigInt('0o' + m2[0].slice(2).replace(/_/g, ''))); i += 1 + m2[0].length; continue; }
        if ((m2 = /^0[bB][01][01_]*/.exec(rest2))) { push('num', -BigInt('0b' + m2[0].slice(2).replace(/_/g, ''))); i += 1 + m2[0].length; continue; }
        if ((m2 = /^\d[\d_]*\.\d[\d_]*/.exec(rest2))) { push('num', -Number(m2[0].replace(/_/g, ''))); i += 1 + m2[0].length; continue; }
        if ((m2 = /^\d[\d_]*/.exec(rest2))) { push('num', -BigInt(m2[0].replace(/_/g, ''))); i += 1 + m2[0].length; continue; }
      }
    }
    if ((m = /^0[xX][0-9a-fA-F][0-9a-fA-F_]*/.exec(rest))) { push('num', BigInt('0x' + m[0].slice(2).replace(/_/g, ''))); i += m[0].length; continue; }
    if ((m = /^0[oO][0-7][0-7_]*/.exec(rest))) { push('num', BigInt('0o' + m[0].slice(2).replace(/_/g, ''))); i += m[0].length; continue; }
    if ((m = /^0[bB][01][01_]*/.exec(rest))) { push('num', BigInt('0b' + m[0].slice(2).replace(/_/g, ''))); i += m[0].length; continue; }
    if ((m = /^\d[\d_]*\.\d[\d_]*/.exec(rest))) { push('num', Number(m[0].replace(/_/g, ''))); i += m[0].length; continue; }
    if ((m = /^\d[\d_]*/.exec(rest))) { push('num', BigInt(m[0].replace(/_/g, ''))); i += m[0].length; continue; }
    if (c === '@') {                                             // @[attr] 跳過；@f 即 f
      if (src[i + 1] === '[') {
        let d = 0; i++;
        while (i < src.length) {
          if (src[i] === '[') d++;
          else if (src[i] === ']') { d--; if (d === 0) { i++; break; } }
          else if (src[i] === '\n') { line++; }
          else if (src[i] === '"') { i++; while (i < src.length && src[i] !== '"') { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; } }
          i++;
        }
        if (d > 0) throw new Error(`第 ${line} 行: @[...] 未閉合`);
        continue;
      }
      i++; continue;                                             // @f 的 @ 直接丟掉
    }
    if (c === "'") {                                             // 'a' '\n' '\u{1F600}'
      i++;
      let cp;
      if (src[i] === '\\') {
        i++; const e = src[i];
        if (e === 'u' && src[i + 1] === '{') {
          let j = i + 2, hex = '';
          while (src[j] !== '}') {
            if (j >= src.length || !/[0-9a-fA-F]/.test(src[j])) throw new Error(`第 ${line} 行: 錯誤的 \\u{...}`);
            hex += src[j]; j++;
          }
          cp = parseInt(hex, 16); i = j + 1;
        } else {
          cp = e === 'n' ? 10 : e === 't' ? 9 : e === 'r' ? 13 : e === '0' ? 0 :
               e === '\\' ? 92 : e === "'" ? 39 : e === '"' ? 34 : null;
          if (cp === null) throw new Error(`第 ${line} 行: 未知的跳脫 '\\${e}'`);
          i++;
        }
      } else {
        cp = src.codePointAt(i);
        if (cp === undefined) throw new Error(`第 ${line} 行: 空的字元字面量`);
        i += cp > 0xFFFF ? 2 : 1;
      }
      if (src[i] !== "'") throw new Error(`第 ${line} 行: 字元字面量須為單一字元`);
      i++; push('num', BigInt(cp)); continue;
    }
    if (c === '#' && src[i + 1] === '[') { push('arrayopen'); i += 2; continue; }   // #[...]
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
    if ('+-*/%<>=|;,()[]:{}_.'.includes(c)) { push('op', c); i++; continue; }
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
/* stdlib 函式引用的標準 ctor 標籤 (型別由用戶宣告，這裡只供解析) */
const BAKED_CTORS = ['ctor/none', 'ctor/some', 'ctor/ok', 'ctor/err', 'ctor/nil', 'ctor/cons'];
/* 方法名不可佔用的 prim 名 (否則呼叫被攔截改道，無聲劫持) */
const RESERVED_METHOD = new Set(['car', 'cdr', 'cadr', 'cddr', 'caddr', 'cons', 'list',
  'length', 'append', 'reverse', 'display', 'write', 'newline', 'error', 'apply',
  'vector', 'hash-map', 'array', 'not']);
// 連字號 prim 在 Lean 識別字寫不出來，用 Lean 本名別名 (Array.size 等)
const PRIM_ALIAS = new Map(Object.entries({
  'Array.size': 'array-size', 'Array.push': 'array-push', 'Array.get': 'array-get',
  'Array.set': 'array-set', 'Array.empty': 'array-empty',
  'Nat.toString': 'number->string', 'String.append': 'string-append', 'Symbol.toString': 'symbol->string',
  'Bit.and': 'bit-and', 'Bit.or': 'bit-or', 'Bit.xor': 'bit-xor',
  'String.get': 'string-ref', 'String.extract': 'substring', 'String.length': 'string-length',
  'Char.toNat': 'char->nat', 'Char.ofNat': 'nat->char',
  'IO.readLine': 'read-line', 'IO.getArgs': 'get-args', 'IO.exit': 'exit',
}));
let gid = 0;
const tmp = (p = 'l') => `__lean${p}${gid++}`;

const LEVELS = [
  { ops: ['||'] }, { ops: ['&&'] },
  { ops: ['=', '==', '!=', '<', '>', '<=', '>='] },
  { ops: ['::'], right: true },
  { ops: ['+', '-'] }, { ops: ['*', '/', '%'] },
];
const SECT_OPS = new Set(['+', '-', '*', '/', '%', '=', '==', '!=', '<', '>', '<=', '>=', '&&', '||', '::', '@']);

class Parser {
  constructor(toks, prescanned = null, opts = {}) {
    this.t = toks; this.p = 0;
    this.indCtors = (prescanned && prescanned.ind) || new Set();     // 'ctor/nil' (inductive，去點)
    this.structCtors = (prescanned && prescanned.struct) || new Set(); // 'ctor/Point.mk' (全名)
    this.structs = new Map();                                        // Struct -> [欄位] (解析期累積)
    this.projections = new Set();                                    // 'Point.x' 全名
    this.indTypes = new Map();                                       // Inductive -> [內部 ctor 名]
    this.classes = new Map();                                        // Class -> [方法] (宣告順序)
    this.methodOf = new Map();                                       // 方法 -> {cls, idx}
    this.defs = new Set();                                           // 已定義名 (碰撞檢查)
    this.instances = new Set();                                      // instance key (重複覆蓋警告)
    this.reservedDefs = opts.reservedDefs || null;                   // 內建 prelude 名 (禁止覆寫)
    this.allowDunder = !!opts.allowDunder;                           // 內建 prelude 才可定義 __ 名
    this.lastLine = 1; this.appBaseCol = null; this.doMonad = null; this.doBase = 0;
  }
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
  expectKw(v) { const t = this.peek(); if (!t || t.k !== 'kw' || t.v !== v) this.err(`需要 "${v}"`); return this.next(); }
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
    while (this.peek()) {
      const sk = this.peek();
      if (sk && sk.k === 'op' && sk.v === ';') { this.next(); continue; }   // 頂層容許多餘分號
      items.push(...this.parseItem());
    }
    return items;
  }

  parseItem() {
    let t = this.peek();
    if (t.k === 'directive') {
      if (t.v !== '#eval') this.err(`不支援 ${t.v} (只有 #eval)`);
      this.next();
      const e = this.parseExpr();
      return [{ t: 'expr', e: { t: 'app', f: vr('display'), a: e } },
              { t: 'expr', e: { t: 'app', f: vr('newline'), a: { t: 'nil' } } }];
    }
    if (t.k === 'kw') {
      while (this.peek() && this.peek().k === 'kw' && MODIFIERS.has(this.peek().v)) this.next();  // 修飾詞跳過
      t = this.peek();
      if (t.v === 'set_option') {                        // set_option k v [in cmd]
        let depth = 0;
        for (;;) {
          const u = this.next(false);
          if (!u || u.k === 'nl') break;
          if (u.v === 'in' && depth === 0) break;
          if (u.k === 'op' && (u.v === '(' || u.v === '[')) depth++;
          if (u.k === 'op' && (u.v === ')' || u.v === ']')) depth--;
        }
        return this.parseItem();
      }
      if (t.v === 'mutual') {                            // mutual ... end (本來就全域互遞迴)
        this.next();
        const out = [];
        for (;;) {
          while (this.raw() && this.raw().k === 'nl') this.p++;
          const u = this.raw();
          if (!u) this.err('mutual 缺少 end');
          if (u.k === 'kw' && u.v === 'end') {
            this.p++;
            if (this.peek() && this.peek().k === 'id') this.next();   // end Name?
            break;
          }
          out.push(...this.parseItem());
        }
        return out;
      }
      if (t.v === 'inductive') return this.parseInductive();
      if (t.v === 'structure') return this.parseStructure();
      if (t.v === 'class') { this.parseClass(); return []; }
      if (t.v === 'instance') return [this.parseInstance()];
      if (t.v === 'def' || t.v === 'abbrev') return [this.parseDef()];
      if (TOPKW.has(t.v)) {
        const kw = t.v;
        this.next();
        if (kw === 'import' || kw === 'open') {
          const u = this.peek();
          if (!u || u.k !== 'id') this.err(`${kw} 需要模組名`);
        }
        this.skipLine(); return [];                        // import/open/... no-op
      }
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
    if (this.isKw('where')) this.next();                         // inductive T where (可選)
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
    this.indTypes.set(name, ctors.map(c => c.name));
    const items = [{ t: 'datatype', name, ctors }];
    for (const dn of this.parseDeriving()) items.push(this.makeDerived(dn, ctors.map(c => c.name)));
    return items;
  }

  parseDeriving() {                                              // deriving A, B (無則空)
    if (!this.isKw('deriving')) return [];
    this.next();
    const out = [];
    for (;;) {
      while (this.raw() && this.raw().k === 'nl') this.p++;
      const t = this.raw();
      if (!t || t.k !== 'id') break;
      out.push(strip(this.next().v));
      while (this.raw() && this.raw().k === 'nl') this.p++;
      if (this.isOp(',')) { this.next(); continue; }
      break;
    }
    return out;
  }

  makeDerived(cls, tags) {                                       // deriving 實例 (BEq/Repr 標準實作)
    if (!this.classes.has(cls)) this.err(`deriving ${cls}: class 尚未宣告`);
    const methods = this.classes.get(cls);
    const impls = new Map();
    for (const m of methods) {
      if (m === 'beq' && cls === 'BEq') {
        const a = tmp('d'), b = tmp('d');
        impls.set(m, { t: 'lam', param: { p: 'var', name: a },
          body: { t: 'lam', param: { p: 'var', name: b },
            body: { t: 'binop', op: '=', l: vr(a), r: vr(b) } } });
      } else if (m === 'repr' && cls === 'Repr') {
        const x = tmp('d');
        impls.set(m, { t: 'lam', param: { p: 'var', name: x },
          body: { t: 'app', f: vr('__reprAny'), a: vr(x) } });
      } else this.err(`deriving ${cls}: 方法 "${m}" 需手寫 instance (只自動產生 beq/repr)`);
    }
    const key = cls + '|' + tags.join(',');
    if (this.instances.has(key)) console.error(`警告: 重複 instance ${cls} (${tags.map(t => t.replace(/^ctor\//, '')).join(', ')})，後者覆蓋前者`);
    this.instances.add(key);
    return { t: 'instance', cls, tags, methods, impls };
  }

  skipToLineEnd() {                                          // 跳過型別到行尾/分號 (深度感知)
    let depth = 0;
    for (;;) {
      const t = this.raw();
      if (!t) return;
      if ((t.k === 'nl' || (t.k === 'op' && t.v === ';')) && depth === 0) return;
      if (t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) depth++;
      if (t.k === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) depth--;
      this.p++;
    }
  }

  parseClass() {
    this.next();                                                 // class
    const t0 = this.peek();
    if (!t0 || t0.k !== 'id') this.err('class 需要名稱');
    const name = t0.v;                                           // 保持全名
    this.next();
    while (this.peek() && this.peek().k === 'op' && ['(', '{', '['].includes(this.peek().v)) {
      const open = this.next().v, close = open === '(' ? ')' : open === '{' ? '}' : ']';
      let depth = 1;
      while (depth > 0) {
        const u = this.next(false);
        if (!u) this.err('class 參數不完整');
        if (u.k === 'op' && u.v === open) depth++;
        if (u.k === 'op' && u.v === close) depth--;
      }
    }
    if (!this.isKw('where')) this.err('class 需要 where');
    this.next();
    const methods = [];
    for (;;) {
      while (this.raw() && (this.raw().k === 'nl' || (this.raw().k === 'op' && this.raw().v === ';'))) this.p++;
      const t = this.raw();
      if (!t || t.k !== 'id') break;
      let q = this.p + 1;
      if (!this.t[q] || this.t[q].k !== 'op' || this.t[q].v !== ':') break;
      const mn = strip(t.v);
      if (this.methodOf.has(mn)) this.err(`方法名 "${mn}" 重複`);
      if (this.defs.has(mn)) this.err(`方法名 "${mn}" 與 def 衝突`);
      if (RESERVED_METHOD.has(mn)) this.err(`方法名 "${mn}" 與 prim 衝突`);
      if (this.indCtors.has(C(mn))) this.err(`方法名 "${mn}" 與建構子衝突`);
      this.p++; this.p++;                                        // name :
      this.skipToLineEnd();
      this.methodOf.set(mn, { cls: name, idx: methods.length });
      methods.push(mn);
    }
    if (!methods.length) this.err(`class ${name} 需要至少一個方法`);
    this.classes.set(name, methods);
  }

  parseInstance() {
    this.next();                                                 // instance
    if (this.peek() && this.peek().k === 'id') {                 // 可選名 (忽略)
      let q = this.p + 1;
      if (this.t[q] && this.t[q].k === 'op' && this.t[q].v === ':') this.p++;
    }
    this.expectOp(':');
    const clsT = this.peek();
    if (!clsT || clsT.k !== 'id') this.err('instance 需要 : Class Type');
    const cls = clsT.v; this.next();
    const tyT = this.peek();
    if (!tyT || tyT.k !== 'id') this.err('instance 需要 : Class Type');
    const ty = tyT.v; this.next();
    if (!this.classes.has(cls)) this.err(`未知 class "${cls}" (請先宣告)`);
    const tags = this.typeTags(ty);
    if (!this.isKw('where')) this.err('instance 需要 where');
    this.next();
    const methods = this.classes.get(cls), seen = new Set(), impls = new Map();
    const outerBase = this.appBaseCol;
    for (;;) {
      while (this.raw() && (this.raw().k === 'nl' || (this.raw().k === 'op' && this.raw().v === ';'))) this.p++;
      const t = this.raw();
      if (!t) break;
      if (t.k === 'kw' && (TOPKW.has(t.v) || PROOFKW.has(t.v))) break;
      if (t.k === 'directive') break;
      if (t.k !== 'id' || !methods.includes(strip(t.v))) break;
      const mn = strip(t.v);
      if (seen.has(mn)) this.err(`方法 "${mn}" 重複實作`);
      seen.add(mn);
      this.p++;
      this.appBaseCol = t.col;
      const params = [];
      while (this.peek() && this.peek().k === 'id') {
        const pn = strip(this.next().v);
        if (/^\p{Lu}/u.test(pn)) this.err(`方法參數須為變數 (${pn})`);
        params.push(this.checkVar(pn));
      }
      if (this.isOp('(')) this.err(`方法 "${mn}" 的參數須為變數 (複雜 pattern 請用 match)`);
      if (!params.length) this.err(`方法 "${mn}" 需至少一個參數 (首參數為分派對象)`);
      this.expectOp(':=');
      const body = this.parseExpr();
      impls.set(mn, params.reduceRight((b, p) => ({ t: 'lam', param: { p: 'var', name: p }, body: b }), body));
    }
    this.appBaseCol = outerBase;
    const missing = methods.filter(m => !seen.has(m));
    if (missing.length) this.err(`instance 缺少方法實作: ${missing.join(', ')}`);
    const key = cls + '|' + tags.join(',');
    if (this.instances.has(key)) console.error(`警告: 重複 instance ${cls} (${tags.map(t => t.replace(/^ctor\//, '')).join(', ')})，後者覆蓋前者`);
    this.instances.add(key);
    return { t: 'instance', cls, ty, tags, methods, impls };
  }

  typeTags(ty) {                                                  // Type 名 -> 內部 ctor 標籤列
    if (this.structs.has(ty)) return [C(ty + '.mk')];
    const short = strip(ty);
    const found = [...this.indTypes.entries()].find(([n]) => n === ty || strip(n) === short);
    if (found) return found[1];
    const known = [...this.structs.keys(), ...this.indTypes.keys()];
    this.err(`未知型別 "${ty}" (請先宣告 inductive/structure` +
      (known.length ? `；已宣告: ${known.join(', ')}` : '') + ')');
  }

  parseStructure() {
    this.next();                                                 // structure
    const t0 = this.peek();
    if (!t0 || t0.k !== 'id') this.err('structure 需要名稱');
    const name = t0.v;                                           // 保持全名 (A.B 亦可)
    this.next();
    if (!this.isKw('where')) this.err('structure 需要 where');
    this.next();
    const fields = [];
    for (;;) {                                                   // 欄位行 (NL / ; 分隔)
      while (this.raw() && (this.raw().k === 'nl' || (this.raw().k === 'op' && this.raw().v === ';'))) this.p++;
      const t = this.raw();
      if (!t || t.k !== 'id') break;
      let q = this.p + 1;                                        // 同行 ':' 才算欄位
      if (!this.t[q] || this.t[q].k !== 'op' || this.t[q].v !== ':') break;
      const fn = strip(t.v);
      this.checkVar(fn);
      if (fields.includes(fn)) this.err(`重複欄位 "${fn}"`);
      fields.push(fn);
      this.p++; this.p++;                                        // name :
      let depth = 0;                                             // 跳過型別 (至換行/分號)
      while (this.raw() && !((this.raw().k === 'nl' || (this.raw().k === 'op' && this.raw().v === ';')) && depth === 0)) {
        const u = this.raw();
        if (u.k === 'op' && (u.v === '(' || u.v === '[' || u.v === '{')) depth++;
        if (u.k === 'op' && (u.v === ')' || u.v === ']' || u.v === '}')) depth--;
        this.p++;
      }
    }
    const mk = C(name + '.mk');
    this.structs.set(name, fields);
    this.structCtors.add(mk);
    fields.forEach(f => this.projections.add(name + '.' + f));
    const items = [{ t: 'datatype', name, ctors: [{ name: mk, arity: fields.length }] }];
    for (const dn of this.parseDeriving()) items.push(this.makeDerived(dn, [mk]));
    fields.forEach((f, i) => {                                   // 投影: match 取第 i 欄
      const p = tmp('s');
      const args = fields.map((g, j) => j === i ? { p: 'var', name: g } : { p: 'wild' });
      items.push({ t: 'def', name: name + '.' + f, rec: false,
        val: { t: 'lam', param: { p: 'var', name: p },
          body: { t: 'match', scrut: vr(p), clauses: [{ pat: { p: 'ctor', name: mk, args }, body: vr(f) }] } } });
    });
    return items;
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
        if (/^\p{Lu}/u.test(bn)) this.err(`函式參數須為變數 (不可用建構子 ${bn}；要用 match 或方程式)`);
        names.push(this.checkVar(bn));
      }
    }
  }

  parseDef() {
    this.next();                                                 // def / abbrev
    const name = this.expectId();                                // 保持全名 (UInt32.add 之類)
    if (RESERVED_LISPC.has(name)) this.err(`"${name}" 為保留字，不可定義 (lispc 特殊形)`);
    if (!this.allowDunder && name.startsWith('__')) this.err(`"${name}" 為保留前綴 (內建 prelude 專用)`);
    if (this.reservedDefs && this.reservedDefs.has(name)) this.err(`"${name}" 與內建 prelude 衝突`);
    if (this.methodOf.has(strip(name))) this.err(`"${name}" 與 typeclass 方法衝突`);
    if (this.defs.has(name)) this.err(`"${name}" 重複定義`);
    if (this.projections.has(name)) this.err(`"${name}" 與投影函式衝突`);
    if (name.includes('.') ? (this.structCtors.has(C(name)) || this.indCtors.has(C(strip(name))))
                           : this.indCtors.has(C(name))) this.err(`"${name}" 與建構子衝突`);
    this.defs.add(name);
    const explicit = [];
    this.parseBinders(explicit);
    if (this.isOp(':')) { this.next(); this.skipTypeTo(':=', '|'); }
    if (this.isOp('|')) return this.parseEquations(name, explicit);
    this.expectOp(':=');
    if (this.isKw('by')) this.err('tactic (by ...) 不支援');
    for (const p of explicit) if (this.indCtors.has(C(p))) this.err(`參數名 "${p}" 與建構子衝突`);
    const body = this.parseExpr();
    if (this.isKw('where')) this.err('where 子句不支援');
    const val = explicit.reduceRight((b, p) => ({ t: 'lam', param: { p: 'var', name: p }, body: b }), body);
    return { t: 'def', name, val, rec: true, nparams: explicit.length };
  }

  parseEquations(name, explicit) {
    if (explicit.length) this.err('方程式與顯式參數不可並存 (二擇一)');
    const eqs = [];
    while (this.isOp('|')) {
      this.next();
      let t = this.peek();
      if (t && t.k === 'id' && t.v === name) this.next();  // 可選的函式名前綴 (全名比對)
      if (!this.startsPatAtom()) this.err('方程式缺少 pattern');
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
    return { t: 'def', name, val, rec: true, nparams: k };
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
      if (!this.startsPatAtom()) this.err('match 需要至少一個分支');
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
    if (t.k === 'kw' && (t.v === 'let' || t.v === 'have')) {
      const isHave = t.v === 'have';
      this.next();
      let rec = false, nm = null;
      if (!isHave && this.peek() && this.peek().k === 'id' && this.peek().v === 'rec') {
        let q = this.p + 1; while (this.t[q] && this.t[q].k === 'nl') q++;   // rec 後還跟識別字才是關鍵字
        if (this.t[q] && this.t[q].k === 'id') { this.next(); rec = true; }
      }
      if (isHave && rec) this.err('have 不支援 rec');   // 到不了，保險
      if (this.peek() && this.peek().k === 'id') {       // have 可匿名；let 必須具名
        const save = this.p;
        const cand = strip(this.next().v);
        if (this.isOp(':=') || this.isOp(':')) nm = this.checkVar(cand);
        else this.p = save;
      }
      if (nm === null && !isHave) this.err('let 需要變數名');
      if (this.isOp(':')) { this.next(); this.skipTypeTo(':='); }
      this.expectOp(':=');
      const v = this.parseExpr();
      this.expectOp(';');
      const body = this.parseExpr();
      if (rec) return { t: 'letrec', pat: { p: 'var', name: nm }, val: v, body };
      return nm ? { t: 'let', pat: { p: 'var', name: nm }, val: v, body }
                : { t: 'begin', items: [v, body] };
    }
    if (t.k === 'kw' && t.v === 'do') return this.parseDo();
    if (t.k === 'kw' && t.v === 'return') { this.next(); return this.parseExpr(); }
    if (t.k === 'kw' && t.v === 'try') {
      this.next();
      const body = this.parseExpr();
      this.expectKw('catch');
      const v = this.expectId();
      if (v.includes('.')) this.err('catch 變數不可含點');
      this.checkVar(strip(v));
      this.expectOp('=>');
      return { t: 'try', body, var: strip(v), handler: this.parseExpr() };
    }
    return this.parseBin(0);
  }

  parseArm() {
    const p = this.parsePattern();
    this.expectOp('=>');
    return { pat: p, body: this.parseExpr() };
  }

  parseDo() {
    this.next();                                                 // do
    let monad = null;
    if (this.isOp('[')) {                                        // do[M]
      this.next();
      const mt = this.peek();
      if (!mt || mt.k !== 'id') this.err('do[...] 需要型別名');
      monad = mt.v; this.next();
      this.expectOp(']');
    }
    const outerBase = this.appBaseCol, outerMonad = this.doMonad, outerDoBase = this.doBase;
    this.doMonad = monad;
    this.doBase = this.p;
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
      if (monad && t.k === 'kw' && t.v === 'return') {           // return e 即 pure e
        this.p++;
        acts.push({ k: 'return', val: this.parseExpr() });
        continue;
      }
      if (t.k === 'kw' && t.v === 'let') {                       // let [rec] x := e / let x ← e
        this.p++;
        let rec = false;
        if (this.peek() && this.peek().k === 'id' && this.peek().v === 'rec') {
          let q = this.p + 1; while (this.t[q] && this.t[q].k === 'nl') q++;
          if (this.t[q] && this.t[q].k === 'id') { this.next(); rec = true; }
        }
        const nm = this.checkVar(strip(this.expectId()));
        if (this.raw() && this.raw().k === 'op' && this.raw().v === ':=') this.p++;
        else if (!rec && this.raw() && this.raw().k === 'larrow') this.p++;
        else if (rec) this.err('let rec 不支援 ← (請用 :=)');
        else this.err('do- let 需要 := 或 ←');
        acts.push({ k: rec ? 'letrec' : 'let', name: nm, val: this.parseExpr() });
        continue;
      }
      if (t.k === 'id') {                                        // x ← e ?
        let q = this.p + 1;
        while (this.t[q] && this.t[q].k === 'nl') q++;
        if (this.t[q] && this.t[q].k === 'larrow') {
          const nm = this.checkVar(strip(t.v));
          this.p = q + 1;
          acts.push(monad ? { k: 'bind', name: nm, val: this.parseExpr() }
                          : { k: 'let', name: nm, val: this.parseExpr() });
          continue;
        }
      }
      acts.push({ k: 'expr', val: this.parseExpr() });
    }
    if (!acts.length) this.err('do 需要至少一個動作');
    this.appBaseCol = outerBase;
    this.doMonad = outerMonad;
    this.doBase = outerDoBase;
    if (monad) return this.foldMonadic(monad, acts);
    const lastK = acts[acts.length - 1].k;
    const mkBind = (a, b) => a.k === 'letrec'
      ? { t: 'letrec', pat: { p: 'var', name: a.name }, val: a.val, body: b }
      : { t: 'let', pat: { p: 'var', name: a.name }, val: a.val, body: b };
    let body = (lastK === 'let' || lastK === 'letrec')
      ? { t: 'app', f: vr('println'), a: { t: 'nil' } }          // 尾是 let: 補 unit
      : acts[acts.length - 1].val;
    for (let i = acts.length - 2; i >= 0; i--)
      body = (acts[i].k === 'let' || acts[i].k === 'letrec')
        ? mkBind(acts[i], body)
        : { t: 'begin', items: [acts[i].val, body] };
    if (acts.length === 1 && acts[0].k === 'expr') return acts[0].val;
    return body;
  }

  foldMonadic(monad, acts) {
    const last = acts[acts.length - 1];
    if (last.k !== 'expr' && last.k !== 'return')
      this.err('do[...] 結尾須為運算式 (用 return x 收尾)');
    let body = last.k === 'return' ? this.buildPureCall(monad, [last.val]) : last.val;
    for (let i = acts.length - 2; i >= 0; i--) {
      const a = acts[i];
      if (a.k === 'let')
        body = { t: 'let', pat: { p: 'var', name: a.name }, val: a.val, body };
      else if (a.k === 'letrec')
        body = { t: 'letrec', pat: { p: 'var', name: a.name }, val: a.val, body };
      else if (a.k === 'bind')
        body = this.buildBind(a.val, { p: 'var', name: a.name }, body);
      else if (a.k === 'return')
        body = this.buildBind(this.buildPureCall(monad, [a.val]), { p: 'wild' }, body);
      else
        body = this.buildBind(a.val, { p: 'wild' }, body);
    }
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
    if (t && t.k === 'kw' && ['fun', 'match', 'if', 'let', 'have', 'do', 'return', 'try'].includes(t.v)) return this.parseExpr();
    return this.parseApp();
  }

  startsAtom() {
    const t = this.peek();
    if (!t) return false;
    if (['num', 'str', 'id', 'arrayopen'].includes(t.k)) return true;
    if (t.k === 'kw') return ['true', 'false'].includes(t.v);
    return t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '{');
  }

  bracketDepth() {                                           // do 起點至今未閉合括號數
    let d = 0;
    for (let i = this.doBase; i < this.p; i++) {
      const t = this.t[i];
      if (t.k === 'arrayopen') d++;
      else if (t.k === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) d++;
      else if (t.k === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) d--;
    }
    return d;
  }

  parseApp() {
    let f = this.parseAtom();
    let nArgs = 0;
    for (;;) {
      if (!this.startsAtom()) break;
      const a = this.peek();
      // do-action 內的並置: 括號內不限行；否則跨行需比動作縮排深
      if (this.appBaseCol !== null && a.line > this.lastLine
          && !(a.col > this.appBaseCol) && this.bracketDepth() < 1) break;
      f = { t: 'app', f, a: this.parseAtom() }; nArgs++;
    }
    if (nArgs === 0) {
      if (f.t === 'var' && this.methodOf.has(f.name))
        this.err(`方法 "${f.name}" 需呼叫使用 (不能當作值傳遞)`);
      return f;
    }
    let h = f; const args = [];
    while (h.t === 'app') { args.unshift(h.a); h = h.f; }
    if (h.t === 'var' && h.name === 'apply' && !this.defs.has('apply')) {
      if (args.length !== 2) this.err(`apply 需要恰 2 個參數 (apply f xs)，得到 ${args.length} 個`);
      return { t: 'apply', f: args[0], lst: args[1] };
    }
    if (h.t === 'var' && h.name === 'pure' && this.doMonad) return this.buildPureCall(this.doMonad, args);
    if (h.t === 'var' && this.methodOf.has(h.name)) return this.buildMethodCall(h.name, args);
    return f;
  }

  findExpr(clsSym, tagExpr) {                                 // (__tc-find __tcTable 'cls tag)
    return { t: 'app', f: { t: 'app', f: { t: 'app', f: vr('__tcFind'), a: vr('__tcTable') },
      a: { t: 'sym', name: clsSym } }, a: tagExpr };
  }
  extractMethod(find, idx) {                                  // dict 第 idx 個方法
    for (let i = 0; i < idx; i++) find = { t: 'app', f: vr('cdr'), a: find };
    return { t: 'app', f: vr('car'), a: find };
  }
  buildPureCall(monadType, args) {                            // do[M] 的 return/pure: 查 (Monad, M) 列
    if (!this.methodOf.has('pure')) this.err('pure 未定義 (需 class Monad)');
    const { idx } = this.methodOf.get('pure');
    let call = this.extractMethod(this.findExpr('Monad', { t: 'sym', name: monadType }), idx);
    for (const a of args) call = { t: 'app', f: call, a };
    return call;
  }
  buildBind(scrut, pat, rest) {                               // bind 苦工: 分派首參
    if (!this.methodOf.has('bind')) this.err('bind 未定義 (需 class Monad)');
    const { cls, idx } = this.methodOf.get('bind');
    const t = tmp('m');
    const fn = this.extractMethod(
      this.findExpr(cls, { t: 'app', f: vr('__tcTag'), a: vr(t) }), idx);
    return { t: 'let', pat: { p: 'var', name: t }, val: scrut,
      body: { t: 'app', f: { t: 'app', f: fn, a: vr(t) },
        a: { t: 'lam', param: pat, body: rest } } };
  }

  buildMethodCall(name, args) {                               // 方法呼叫: 首參數決定分派
    const { cls, idx } = this.methodOf.get(name);
    const t = tmp('m');
    const fn = this.extractMethod(
      this.findExpr(cls, { t: 'app', f: vr('__tcTag'), a: vr(t) }), idx);
    let call = { t: 'app', f: fn, a: vr(t) };
    for (const a of args.slice(1)) call = { t: 'app', f: call, a };
    return { t: 'let', pat: { p: 'var', name: t }, val: args[0], body: call };
  }

  parseAtom() {
    const t = this.next();
    if (!t) this.err('運算式不完整');
    if (t.k === 'num') return num(t.v);
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'id') {
      const raw = t.v;
      if (raw === 'sorry' || raw === 'sorryAx')          // 未證即跑到才炸，可 catch
        return { t: 'call', f: vr('error'), args: [{ t: 'str', v: 'sorry' }] };
      if (PRIM_ALIAS.has(raw)) return vr(PRIM_ALIAS.get(raw));
      if (this.defs.has(raw)) return vr(raw);              // 使用者定義 (全名，含 UInt32.add)
      if (this.projections.has(raw)) return vr(raw);       // Point.x 全名投影優先
      if (raw.includes('.')) return vr(this.resolveCtor(raw));
      const nm = strip(raw);
      if (this.indCtors.has(C(nm))) return vr(C(nm));
      this.bakedUndeclared(nm);
      if (/^\p{Lu}/u.test(nm)) this.err(`未知建構子 "${nm}" (inductive 宣告了嗎?)`);
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
        const ot = this.peek();                              // (+) 運算子 section
        if (ot && ot.k === 'op' && SECT_OPS.has(ot.v)) {
          this.next(); this.expectOp(')');
          const a = tmp('s'), b = tmp('s'), va = vr(a), vb = vr(b);
          const body = ot.v === '/' ? { t: 'app', f: { t: 'app', f: vr('quotient'), a: va }, a: vb }
            : ot.v === '-' ? this.natSub(va, vb)
            : { t: 'binop', op: ot.v, l: va, r: vb };
          return { t: 'lam', param: { p: 'var', name: a },
            body: { t: 'lam', param: { p: 'var', name: b }, body } };
        }
        const e = this.parseNamedOrExpr();
        if (this.isOp(',')) {
          const items = [e];
          while (this.isOp(',')) { this.next(); items.push(this.parseNamedOrExpr()); }
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
      if (t.v === '{') return this.parseStructLit();
    }
    if (t.k === 'arrayopen') {
      const args = [];
      if (!this.isOp(']')) {
        args.push(this.parseExpr());
        while (this.isOp(',')) { this.next(); if (this.isOp(']')) break; args.push(this.parseExpr()); }
      }
      this.expectOp(']');
      return { t: 'call', f: vr('array'), args };
    }
    this.p--; this.err('無法解析的運算式');
  }

  parseNamedOrExpr() {                                       // (x := e) 具名參數：只取値
    const t = this.peek();
    if (t && t.k === 'id') {
      let q = this.p + 1;
      while (this.t[q] && this.t[q].k === 'nl') q++;
      if (this.t[q] && this.t[q].k === 'op' && this.t[q].v === ':=') {
        this.p = q + 1;
        return this.parseExpr();
      }
    }
    return this.parseExpr();
  }

  parseStructLit() {                                          // { x := .., .. } 或 { p with x := .. }
    const t0 = this.peek();
    if (!t0 || t0.k !== 'id') this.err('{...} 需要欄位或 p with');
    const first = strip(this.next().v);
    if (this.isKw('with')) {                                  // { p with f := e, ... }
      this.next();
      if (first.includes('.')) this.err('{...} with 的基底須為變數');
      const base = vr(first);
      const given = this.parseStructFields();
      this.expectOp('}');
      const st = this.structForFields(given.map(g => g[0]), 'with');
      return this.buildStruct(st, given, base);
    }
    this.expectOp(':=');
    const given = [[first, this.parseExpr()]];
    while (this.isOp(',')) { this.next(); if (this.isOp('}')) break; given.push(this.parseStructField()); }
    this.expectOp('}');
    const st = this.structForFields(given.map(g => g[0]), 'instance');
    return this.buildStruct(st, given, null);
  }
  parseStructField() {
    const t = this.peek();
    if (!t || t.k !== 'id') this.err('{...} 欄位需要名稱');
    const fn = strip(this.next().v);
    this.expectOp(':=');
    return [fn, this.parseExpr()];
  }
  parseStructFields() {
    const out = [this.parseStructField()];
    while (this.isOp(',')) { this.next(); if (this.isOp('}')) break; out.push(this.parseStructField()); }
    return out;
  }
  structForFields(names, what) {
    const cands = [...this.structs.entries()].filter(([sn, fs]) => names.every(n => fs.includes(n)));
    if (!cands.length) {
      const known = [...this.structs.keys()];
      this.err(`{...} ${what}: 找不到含欄位 [${names.join(', ')}] 的 structure` +
        (known.length ? ` (已宣告: ${known.join(', ')})` : ' (尚未宣告任何 structure；請先宣告)'));
    }
    if (cands.length > 1) this.err(`{...} ${what}: 欄位 [${names.join(', ')}] 模稜兩可 (${cands.map(c => c[0]).join(', ')})`);
    return cands[0];
  }
  buildStruct([sn, fs], given, base) {                        // 依宣告順序排成 ctor 應用
    const giv = new Map(given);
    const args = fs.map(f => {
      if (giv.has(f)) return giv.get(f);
      if (!base) this.err(`{...}: 缺少欄位 "${f}" (structure ${sn})`);
      return { t: 'app', f: vr(sn + '.' + f), a: base };       // 舊欄读投影
    });
    let node = vr(C(sn + '.mk'));
    for (const a of args) node = { t: 'app', f: node, a };
    return node;
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
      const raw = t.v;
      if (raw.includes('.')) {                             // 點名只可能是建構子
        this.next();
        return { p: 'ctor', name: this.resolveCtor(raw), args: this.patArgs() };
      }
      const nm = strip(raw);
      if (nm === '_') { this.next(); return { p: 'wild' }; }
      if (this.indCtors.has(C(nm))) {
        this.next();
        return { p: 'ctor', name: C(nm), args: this.patArgs() };
      }
      this.bakedUndeclared(nm);
      if (/^\p{Lu}/u.test(nm)) this.err(`未知建構子 "${nm}"`);
      this.next();
      if (this.startsPatAtom()) this.err(`未知建構子 "${raw}" (小寫建構子需先宣告)`);
      if (RESERVED_VAR.has(nm)) this.err(`"${nm}" 不可為 pattern`);
      return { p: 'var', name: nm };
    }
    return this.parsePatAtom();
  }
  patArgs() { const args = []; while (this.startsPatAtom()) args.push(this.parsePatAtom()); return args; }
  // 建構子解析: 'NatList.cons'/'.cons'/'cons' -> 'ctor/cons'；'Point.mk' -> 'ctor/Point.mk'
  // structure 一律寫全名；短名只認 inductive (未知則報錯並提示)
  bakedUndeclared(nm) {
    if (BAKED_CTORS.includes(C(nm)))
      this.err(nm === 'nil'
        ? `建構子 "nil" 未宣告（是否少了 inductive？空串列請用 []）`
        : `建構子 "${nm}" 未宣告（是否少了 inductive？）`);
  }
  resolveCtor(raw) {
    const segs = raw.split('.').filter(x => x.length);
    const short = segs[segs.length - 1], full = segs.join('.');
    if (segs.length > 1) {
      if (this.structCtors.has(C(full))) return C(full);
      if (this.indCtors.has(C(short))) return C(short);
      const cands = [...this.projections].filter(p => strip(p) === short);
      this.err(`未知建構子 "${raw}"` + (cands.length
        ? ` (是否有名為 ${cands.join('、')} 的投影？p.x 點記法不支援)`
        : ` (p.x 點記法不支援；structure 請寫完整 Point.mk)`));
    }
    const key = C(short);
    if (this.indCtors.has(key)) return key;
    this.err(`未知建構子 "${raw}" (structure 請寫完整 Point.mk)`);
  }
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
      const raw = t.v;
      if (raw.includes('.')) return { p: 'ctor', name: this.resolveCtor(raw), args: [] };
      const nm = strip(raw);
      if (nm === '_') return { p: 'wild' };
      if (this.indCtors.has(C(nm))) return { p: 'ctor', name: C(nm), args: [] };
      this.bakedUndeclared(nm);
      if (/^\p{Lu}/u.test(nm)) this.err(`未知建構子 "${raw}"`);
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

function prescanCtors(toks) {                                // 先掃建構子名 (判別用)
  const ind = new Set(), struct = new Set();
  const at = i => { while (i < toks.length && toks[i].k === 'nl') i++; return toks[i]; };
  let mode = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'kw' && (TOPKW.has(t.v) || PROOFKW.has(t.v))) {
      mode = null;
      if (t.v === 'structure') {
        const u = at(i + 1);
        if (u && u.k === 'id') struct.add(C(u.v + '.mk'));      // 全名，不 strip
      } else if (t.v === 'inductive') mode = 'ind';
    }
    else if (t.k === 'directive') mode = null;
    else if (mode === 'ind' && t.k === 'op' && t.v === '|') {
      const u = at(i + 1);
      if (u && u.k === 'id') ind.add(C(strip(u.v)));
    }
  }
  return { ind, struct, at };
}

function parse(src) {                                            // 回傳 items，供 CLI 警告用
  gid = 0;
  const preParser = new Parser(tokenize(LEAN_PRELUDE),
    { ind: new Set(BAKED_CTORS), struct: new Set() }, { allowDunder: true });
  const pre = preParser.parseProgram().filter(it => it.t === 'def');
  const reserved = new Set(pre.map(d => d.name));
  const toks = tokenize(src);
  const presc = prescanCtors(toks);
  const parser = new Parser(toks, presc, { reservedDefs: reserved });
  for (const n of reserved) parser.defs.add(n);      // prelude 名 (含 UInt32.add) 可解析
  const items = parser.parseProgram();
  return { items, pre };
}
function warnMain(items) {
  const mains = items.filter(it => it.t === 'def' && it.name === 'main');
  if (!mains.length) console.error('警告: 沒有 main（不會自動執行任何事）');
  else if ((mains[mains.length - 1].nparams || 0) > 0)
    console.error('警告: main 帶參數不會自動執行');
}
function toScheme(src) {
  const { items, pre } = parse(src);
  return new mlc.Desugar().program(assembleProgram(items, pre));
}
function warnMain(items) {
  const mains = items.filter(it => it.t === 'def' && it.name === 'main');
  if (!mains.length) console.error('警告: 沒有 main（不會自動執行任何事）');
  else if ((mains[mains.length - 1].nparams || 0) > 0)
    console.error('警告: main 帶參數不會自動執行');
}

/* 內建 prelude (Lean 寫成，同一 parser 解析；__ 前綴保留給它) */
const UINT_WIDTHS = [8, 16, 32, 64];
const UINT_OPS = ['add', 'sub', 'mul', 'div', 'mod', 'shl', 'shr', 'and', 'or', 'xor', 'not', 'toNat', 'fromNat'];
const UINT_UNARY = new Set(['not', 'toNat', 'fromNat']);
const cap = s => s[0].toUpperCase() + s.slice(1);
const uintPrelude = UINT_WIDTHS.map(w =>
  UINT_OPS.map(op => UINT_UNARY.has(op)
    ? `def UInt${w}.${op} (a : Nat) : Nat := u${cap(op)} ${w} a`
    : `def UInt${w}.${op} (a : Nat) (b : Nat) : Nat := u${cap(op)} ${w} a b`).join('\n')
).join('\n');
const LEAN_PRELUDE = `
def __tcTag (x : Nat) : Nat :=
  if null? x then error "cannot dispatch on ()"
  else if pair? x then
    if symbol? (car x) then car x
    else error "not a dispatchable value"
  else if symbol? x then x
  else error "cannot dispatch (primitive instances later)"

def __tcFind (table : Nat) (cls : Nat) (tag : Nat) : Nat :=
  if null? table then error "no instance"
  else if car (car table) == cls then
    if car (cdr (car table)) == tag then car (cdr (cdr (car table)))
    else __tcFind (cdr table) cls tag
  else __tcFind (cdr table) cls tag

def __reprPair (l : Nat) : Nat :=
  String.append (__reprAny (car l))
    (if null? (cdr l) then ")"
    else if pair? (cdr l) then String.append " " (__reprPair (cdr l))
    else String.append " . " (String.append (__reprAny (cdr l)) ")"))

def __reprAny (x : Nat) : Nat :=
  if null? x then "[]"
  else if number? x then Nat.toString x
  else if string? x then String.append "\\"" (String.append x "\\"")
  else if symbol? x then Symbol.toString x
  else if pair? x then String.append "(" (__reprPair x)
  else if procedure? x then "<procedure>"
  else if x then "true" else "false"

def pow2 (w : Nat) : Nat :=
  if w == 0 then 1 else 2 * pow2 (w - 1)

def Nat.pow (b : Nat) (e : Nat) : Nat :=
  if e == 0 then 1 else b * Nat.pow b (e - 1)

def uMask (w : Nat) : Nat := pow2 w - 1
def uNorm (w : Nat) (a : Nat) : Nat := a % pow2 w
def uAdd (w : Nat) (a : Nat) (b : Nat) : Nat := (uNorm w a + uNorm w b) % pow2 w
def uSub (w : Nat) (a : Nat) (b : Nat) : Nat := (uNorm w a + pow2 w - uNorm w b) % pow2 w
def uMul (w : Nat) (a : Nat) (b : Nat) : Nat := (uNorm w a * uNorm w b) % pow2 w
def uDiv (w : Nat) (a : Nat) (b : Nat) : Nat :=
  if b == 0 then error "uDiv: division by zero" else quotient (uNorm w a) (uNorm w b)
def uMod (w : Nat) (a : Nat) (b : Nat) : Nat :=
  if b == 0 then error "uMod: division by zero" else modulo (uNorm w a) (uNorm w b)
def uShl (w : Nat) (a : Nat) (n : Nat) : Nat := uNorm w (uNorm w a * pow2 n)
def uShr (w : Nat) (a : Nat) (n : Nat) : Nat := quotient (uNorm w a) (pow2 n)
def uAnd (w : Nat) (a : Nat) (b : Nat) : Nat := uNorm w (Bit.and a b)
def uOr (w : Nat) (a : Nat) (b : Nat) : Nat := uNorm w (Bit.or a b)
def uXor (w : Nat) (a : Nat) (b : Nat) : Nat := uNorm w (Bit.xor a b)
def uNot (w : Nat) (a : Nat) : Nat := uMask w - uNorm w a
def uToNat (w : Nat) (a : Nat) : Nat := uNorm w a
def uFromNat (w : Nat) (a : Nat) : Nat := uNorm w a

def List.map (f : Nat) (xs : Nat) : Nat :=
  match xs with | nil => nil | cons x xs => cons (f x) (List.map f xs)
def List.filter (f : Nat) (xs : Nat) : Nat :=
  match xs with | nil => nil | cons x xs => if f x then cons x (List.filter f xs) else List.filter f xs
def List.foldl (f : Nat) (acc : Nat) (xs : Nat) : Nat :=
  match xs with | nil => acc | cons x xs => List.foldl f (f acc x) xs
def List.length (xs : Nat) : Nat :=
  match xs with | nil => 0 | cons _ xs => List.length xs + 1
def List.append (xs : Nat) (ys : Nat) : Nat :=
  match xs with | nil => ys | cons x xs => cons x (List.append xs ys)
def List.reverseAux (xs : Nat) (acc : Nat) : Nat :=
  match xs with | nil => acc | cons x xs => List.reverseAux xs (cons x acc)
def List.reverse (xs : Nat) : Nat := List.reverseAux xs nil

def Option.map (f : Nat) (o : Nat) : Nat :=
  match o with | none => none | some x => some (f x)
def Option.bind (o : Nat) (f : Nat) : Nat :=
  match o with | none => none | some x => f x
def Option.getD (o : Nat) (d : Nat) : Nat :=
  match o with | none => d | some x => x

def Except.map (f : Nat) (e : Nat) : Nat :=
  match e with | ok x => ok (f x) | err e => err e
def Except.bind (e : Nat) (f : Nat) : Nat :=
  match e with | ok x => f x | err e => err e
def Except.getD (e : Nat) (d : Nat) : Nat :=
  match e with | ok x => x | err e => d
def Except.toOption (e : Nat) : Nat :=
  match e with | ok x => some x | err _ => none

${uintPrelude}
`;

function assembleProgram(items, pre) {
  const instances = items.filter(it => it.t === 'instance');
  const rest = items.filter(it => it.t !== 'instance');
  // rest 前兩項固定是 println/print (parseProgram 注入)；tc 輔助放其後
  const out = [...rest.slice(0, 2), ...pre];
  // 表永遠 emit (空表亦然；落空由 __tc-find 報 "no instance"，而非 unbound)
  const rows = [];
  for (let i = instances.length - 1; i >= 0; i--) {
    const inst = instances[i];
    const dict = { t: 'call', f: vr('list'), args: inst.methods.map(m => inst.impls.get(m)) };
    for (const tg of inst.tags)
      rows.push({ t: 'call', f: vr('list'), args: [{ t: 'sym', name: inst.cls }, { t: 'sym', name: tg }, dict] });
    if (inst.cls === 'Monad')                                  // pure 查表列 (do[M] 的 return)
      rows.push({ t: 'call', f: vr('list'), args: [{ t: 'sym', name: 'Monad' }, { t: 'sym', name: inst.ty }, dict] });
  }
  out.push({ t: 'def', name: '__tcTable', rec: false, val: { t: 'call', f: vr('list'), args: rows } });
  out.push(...rest.slice(2));
  return out;
}
function compile(src) { return lispc.compile(toScheme(src)); }
module.exports = { compile, toScheme, tokenize, parse };

/* ─────────── CLI ─────────── */
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('用法: node leanc.js prog.lean [-o prog.fbc] [--scheme]'); process.exit(1); }
  const input = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-o');
  const oi = args.indexOf('-o');
  const output = oi >= 0 ? args[oi + 1] : input.replace(/\.[^.]*$/, '') + '.fbc';
  try {
    const src = fs.readFileSync(input, 'utf8');
    if (args.includes('--scheme')) process.stdout.write(toScheme(src));
    else {
      const { items, pre } = parse(src);
      warnMain(items);
      const bc = lispc.compile(new mlc.Desugar().program(assembleProgram(items, pre)));
      if (output === '-') process.stdout.write(bc); else { fs.writeFileSync(output, bc); console.error(`已編譯 ${input} -> ${output}`); }
    }
  } catch (e) { console.error('編譯錯誤: ' + e.message); process.exit(1); }
}
