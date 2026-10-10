// Parser for the Mini-Lean surface syntax (.lean files).
// Produces declaration ASTs + expression ASTs + tactic ASTs with line numbers.
// Pure JS, no dependencies; works in Node and browsers.

export class ParseError extends Error {
  constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.name = 'ParseError'; this.line = line; }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------
const MULTI = [':=', '=>', '<->', '->', '<-', '/\\', '\\/', '<=', '>=', '=='];
const UNICODE_OPS = new Set(['∀', '∃', 'λ', '→', '←', '↔', '∧', '∨', '¬', '⟨', '⟩', '·', '×', '≠', '≤', '≥', '◻']);

export function lex(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const push = (k, v, l = line, c = col) => toks.push({ k, v, line: l, col: c });
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { i++; line++; col = 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; col++; continue; }
    // line comment
    if (ch === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') { i++; } continue; }
    // block comment /- ... -/ (nested)
    if (ch === '/' && src[i + 1] === '-') {
      let depth = 1; i += 2; col += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '-') { depth++; i += 2; col += 2; }
        else if (src[i] === '-' && src[i + 1] === '/') { depth--; i += 2; col += 2; }
        else { if (src[i] === '\n') { line++; col = 1; } else col++; i++; }
      }
      continue;
    }
    // #command
    if (ch === '#') {
      let j = i + 1;
      while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
      push('cmd', src.slice(i, j)); col += j - i; i = j; continue;
    }
    // number
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      push('num', src.slice(i, j)); col += j - i; i = j; continue;
    }
    // identifier (allows _ prefix, ' primes, .segments; unicode letters ok, symbols not)
    if (/[A-Za-z_]/.test(ch) || (ch.charCodeAt(0) > 127 && /[\p{L}_]/u.test(ch))) {
      let j = i;
      const isIdChar = (c) => /[A-Za-z0-9_']/.test(c) || (c.charCodeAt(0) > 127 && /[\p{L}\p{N}_]/u.test(c));
      while (j < src.length && isIdChar(src[j])) j++;
      // dotted continuation: .ident
      while (src[j] === '.' && j + 1 < src.length && /[A-Za-z_]/.test(src[j + 1])) {
        j++;
        while (j < src.length && /[A-Za-z0-9_']/.test(src[j])) j++;
      }
      push('ident', src.slice(i, j)); col += j - i; i = j; continue;
    }
    // unicode ops (single char tokens)
    if (UNICODE_OPS.has(ch)) { push('sym', ch); i++; col++; continue; }
    // multi-char ascii ops
    let matched = null;
    for (const m of MULTI) { if (src.startsWith(m, i)) { matched = m; break; } }
    if (matched) { push('sym', matched); i += matched.length; col += matched.length; continue; }
    // single-char symbols
    if ('()[]{}:;,._=+-*<>~|?!@%^&/'.includes(ch)) { push('sym', ch); i++; col++; continue; }
    if (ch === '"' || ch === "'") throw new ParseError(`unexpected character ${ch}`, line);
    throw new ParseError(`unexpected character ${JSON.stringify(ch)}`, line);
  }
  push('eof', '', line, col);
  return toks;
}

// ---------------------------------------------------------------------------
// Expression AST
// ---------------------------------------------------------------------------
// {k:'ident',name} {k:'num',value} {k:'sort',level} {k:'prop'} {k:'hole'}
// {k:'sorry'} {k:'true'} {k:'false'} {k:'nat'} {k:'app',fn,args[]}
// {k:'fun',binders:[{name,ty?}],body} {k:'forall',binders:[{name,ty}],body}
// {k:'exists',binders:[{name,ty}],body} {k:'binop',op,l,r} {k:'neg',e}
// {k:'ann',e,ty} {k:'anon',items[]}  (⟨a, b⟩ anonymous constructor)

const PREC = {
  '↔': 20, '<->': 20,
  '->': 12, '→': 12,
  '∨': 30, '\\/': 30,
  '∧': 35, '/\\': 35,
  '=': 50, '≠': 50,
  '+': 65, '-': 65,
  '*': 70, '×': 70, '/': 70,
};
const RIGHT_ASSOC = new Set(['->', '→', '∧', '/\\', '∨', '\\/']);

export class ExprParser {
  constructor(toks, start = 0) { this.toks = toks; this.pos = start; }
  peek(off = 0) { return this.toks[this.pos + off] ?? this.toks[this.toks.length - 1]; }
  next() { const t = this.peek(); if (t.k !== 'eof') this.pos++; return t; }
  err(msg) { return new ParseError(msg, this.peek().line); }
  expectSym(s) {
    const t = this.next();
    if (t.k !== 'sym' || t.v !== s) throw new ParseError(`expected '${s}', got '${t.v}'`, t.line);
    return t;
  }
  parseExpr(minPrec = 0) {
    let left = this.parseUnary();
    // type ascription (lowest): (e : T) is handled at atom level; top-level `e : T` for have/show handled separately.
    for (;;) {
      const t = this.peek();
      if (t.k !== 'sym' || !(t.v in PREC)) break;
      const p = PREC[t.v];
      if (p < minPrec) break;
      this.next();
      const nextMin = RIGHT_ASSOC.has(t.v) ? p : p + 1;
      const right = this.parseExpr(nextMin);
      left = { k: 'binop', op: t.v, l: left, r: right, line: t.line };
    }
    return left;
  }
  parseUnary() {
    const t = this.peek();
    if ((t.k === 'sym' && (t.v === '¬' || t.v === '~')) || (t.k === 'ident' && t.v === 'not')) {
      this.next();
      return { k: 'neg', e: this.parseUnary(), line: t.line };
    }
    return this.parseApp();
  }
  parseApp() {
    const fn = this.parseAtom();
    if (!fn) throw this.err('expected an expression');
    const args = [];
    for (;;) {
      const a = this.parseAtom();
      if (!a) break;
      args.push(a);
    }
    if (!args.length) return fn;
    return { k: 'app', fn, args, line: fn.line };
  }
  parseAtom() {
    const t = this.peek();
    if (t.k === 'num') { this.next(); return { k: 'num', value: parseInt(t.v, 10), line: t.line }; }
    if (t.k === 'ident') {
      if (t.v === 'fun' || t.v === 'λ' || t.v === 'fn') return this.parseFun();
      if (t.v === 'forall' || t.v === '∀') return this.parseForall();
      if (t.v === 'exists' || t.v === '∃') return this.parseExists();
      if (t.v === 'sorry') { this.next(); return { k: 'sorry', line: t.line }; }
      if (t.v === '_') { this.next(); return { k: 'hole', line: t.line }; }
      if (t.v === 'Type') {
        this.next();
        if (this.peek().k === 'num') { const n = this.next(); return { k: 'sort', level: parseInt(n.v, 10), line: t.line }; }
        return { k: 'sort', level: 0, line: t.line };
      }
      if (t.v === 'Prop') { this.next(); return { k: 'prop', line: t.line }; }
      if (t.v === 'True') { this.next(); return { k: 'true', line: t.line }; }
      if (t.v === 'False') { this.next(); return { k: 'false', line: t.line }; }
      if (t.v === 'Nat') { this.next(); return { k: 'nat', line: t.line }; }
      this.next();
      return { k: 'ident', name: t.v, line: t.line };
    }
    if (t.k === 'sym') {
      if (t.v === '∀') return this.parseForall();
      if (t.v === '∃') return this.parseExists();
      if (t.v === 'λ') return this.parseFun();
      if (t.v === '(') {
        this.next();
        if (this.peek().k === 'sym' && this.peek().v === ')') { this.next(); return { k: 'true', line: t.line, unit: true }; }
        const e = this.parseExpr();
        // (e : T) ascription
        if (this.peek().k === 'sym' && this.peek().v === ':') {
          this.next();
          const ty = this.parseExpr();
          this.expectSym(')');
          return { k: 'ann', e, ty, line: t.line };
        }
        this.expectSym(')');
        return e;
      }
      if (t.v === '⟨') {
        this.next();
        const items = [];
        if (!(this.peek().k === 'sym' && this.peek().v === '⟩')) {
          items.push(this.parseExpr());
          while (this.peek().k === 'sym' && this.peek().v === ',') { this.next(); items.push(this.parseExpr()); }
        }
        this.expectSym('⟩');
        return { k: 'anon', items, line: t.line };
      }
      return null;
    }
    return null;
  }
  parseBinderGroups(allowBare, needType) {
    // parses groups like (x y : T) {x : T} [x : T] or bare idents
    const binders = [];
    for (;;) {
      const t = this.peek();
      if (t.k === 'sym' && (t.v === '(' || t.v === '{' || t.v === '[')) {
        const open = t.v; this.next();
        const close = open === '(' ? ')' : open === '{' ? '}' : ']';
        const names = [];
        while (!(this.peek().k === 'sym' && this.peek().v === close)) {
          const n = this.next();
          if (n.k === 'ident' && n.v === ':') break;
          if (n.k !== 'ident') throw new ParseError(`expected binder name, got '${n.v}'`, n.line);
          if (n.v === ':' ) break;
          names.push(n.v);
          if (this.peek().k === 'sym' && this.peek().v === ':') break;
        }
        let ty = null;
        if (this.peek().k === 'sym' && this.peek().v === ':') {
          this.next();
          ty = this.parseExpr();
        } else if (needType) throw new ParseError('expected `: type` in binder', this.peek().line);
        this.expectSym(close);
        for (const n of names) binders.push({ name: n, ty });
      } else if (allowBare && t.k === 'ident' && ![':=', ':'].includes(t.v) && !this.isReserved(t.v)) {
        // bare ident (fun binder without type) — only if followed by ident/=>/etc.
        this.next();
        binders.push({ name: t.v, ty: null });
      } else break;
    }
    return binders;
  }
  isReserved(w) {
    return ['by', 'fun', 'forall', 'exists', 'sorry', 'with', 'at', 'in', 'only', 'as'].includes(w);
  }
  parseFun() {
    const t = this.next(); // fun/λ
    const binders = this.parseFunBinders();
    if (!binders.length) throw new ParseError('expected binder after fun', t.line);
    const nx = this.next();
    if (!(nx.k === 'sym' && nx.v === '=>')) throw new ParseError(`expected '=>', got '${nx.v}'`, nx.line);
    const body = this.parseExpr();
    return { k: 'fun', binders, body, line: t.line };
  }
  parseForall() {
    const t = this.next();
    const binders = this.parseFunBinders();
    if (!binders.length) throw new ParseError('expected binder after ∀', t.line);
    const nx = this.next();
    if (!(nx.k === 'sym' && nx.v === ',')) throw new ParseError(`expected ',', got '${nx.v}'`, nx.line);
    const body = this.parseExpr();
    return { k: 'forall', binders, body, line: t.line };
  }
  parseExists() {
    const t = this.next();
    const binders = this.parseFunBinders();
    if (!binders.length) throw new ParseError('expected binder after ∃', t.line);
    const nx = this.next();
    if (!(nx.k === 'sym' && nx.v === ',')) throw new ParseError(`expected ',', got '${nx.v}'`, nx.line);
    const body = this.parseExpr();
    return { k: 'exists', binders, body, line: t.line };
  }
  // Binder lists for fun/∀/∃: groups `(x y : T)` plus bare idents, with
  // support for trailing `: T` applying to the preceding bare names
  // (e.g. `fun x y : Nat => …`, `∀ n : Nat, …`).
  parseFunBinders() {
    const binders = [];
    for (;;) {
      const t = this.peek();
      if (t.k === 'sym' && (t.v === '(' || t.v === '{' || t.v === '[')) {
        const open = t.v; this.next();
        const close = open === '(' ? ')' : open === '{' ? '}' : ']';
        const names = [];
        while (!(this.peek().k === 'sym' && this.peek().v === close) && this.peek().k !== 'eof') {
          const n = this.next();
          if (n.k !== 'ident') throw new ParseError(`expected binder name, got '${n.v}'`, n.line);
          names.push(n.v);
          if (this.peek().k === 'sym' && this.peek().v === ':') break;
        }
        let ty = null;
        if (this.peek().k === 'sym' && this.peek().v === ':') {
          this.next();
          ty = this.parseExpr();
        }
        this.expectSym(close);
        for (const n of names) binders.push({ name: n, ty });
      } else if (t.k === 'ident' && !this.isReserved(t.v)) {
        this.next();
        binders.push({ name: t.v, ty: null });
      } else break;
    }
    // trailing `: T` applies to the trailing run of untyped binders
    if (this.peek().k === 'sym' && this.peek().v === ':') {
      this.next();
      const ty = this.parseExpr();
      let i = binders.length - 1;
      if (i < 0 || binders[i].ty) throw new ParseError("unexpected ':' in binder list", this.peek().line);
      while (i >= 0 && !binders[i].ty) { binders[i].ty = ty; i--; }
    }
    return binders;
  }
}

export function parseExprString(s, line = 1) {
  const toks = lex(s);
  const p = new ExprParser(toks);
  const e = p.parseExpr();
  return e;
}

// Split token list on top-level separator (depth counts () [] {} and ⟨⟩)
export function splitTopLevel(toks, sep) {
  const parts = [];
  let cur = [];
  let depth = 0;
  for (const t of toks) {
    if (t.k === 'sym' && ['(', '[', '{', '⟨'].includes(t.v)) depth++;
    if (t.k === 'sym' && [')', ']', '}', '⟩'].includes(t.v)) depth--;
    if (depth === 0 && ((t.k === 'sym' && t.v === sep) || (t.k === 'ident' && t.v === sep))) {
      parts.push(cur); cur = [];
    } else cur.push(t);
  }
  parts.push(cur);
  return parts;
}
function toksToString(toks) {
  // re-serialize for sub-parsing (simple join with spaces; lexer-compatible)
  return toks.map(t => t.v).join(' ');
}

// ---------------------------------------------------------------------------
// Tactic AST
// ---------------------------------------------------------------------------
// {k:'intro',names} {k:'exact'|'apply',e} {k:'assumption'} {k:'trivial'}
// {k:'rfl'} {k:'constructor'} {k:'left'} {k:'right'}
// {k:'cases',h,withNames[]} {k:'induction',h,withNames[]}
// {k:'rw',rules:[{rev,e}],at?} {k:'simp',rules,only} {k:'have',name,ty,e,byTacs}
// {k:'show',e} {k:'sorry'} {k:'all_goals',tac} {k:'case',tag,tac}

export function parseTacticTokens(toks, line) {
  if (!toks.length) throw new ParseError('empty tactic', line);
  const head = toks[0];
  if (head.k !== 'ident') throw new ParseError(`unknown tactic '${toksToString(toks)}'`, line);
  const w = head.v;
  const rest = toks.slice(1);
  const exprOf = (ts) => {
    if (!ts.length) throw new ParseError(`tactic '${w}' needs an argument`, line);
    const p = new ExprParser([...ts, { k: 'eof', v: '', line, col: 0 }]);
    const e = p.parseExpr();
    return e;
  };
  switch (w) {
    case 'intro':
    case 'intros': {
      const names = rest.filter(t => t.k === 'ident').map(t => t.v);
      if (!names.length) throw new ParseError('intro needs a name', line);
      return { k: 'intro', names, line };
    }
    case 'exact':
    case 'apply': return { k: w, e: exprOf(rest), line };
    case 'assumption': return { k: 'assumption', line };
    case 'trivial': return { k: 'trivial', line };
    case 'rfl':
    case 'refl': return { k: 'rfl', line };
    case 'constructor': return { k: 'constructor', line };
    case 'left': return { k: 'left', line };
    case 'right': return { k: 'right', line };
    case 'sorry': return { k: 'sorry', line };
    case 'cases':
    case 'rcases':
    case 'obtain': {
      if (!rest.length || rest[0].k !== 'ident') throw new ParseError(`${w} needs a hypothesis name`, line);
      const h = rest[0].v;
      let withNames = [];
      const wi = rest.findIndex(t => t.k === 'ident' && t.v === 'with');
      if (wi >= 0) withNames = rest.slice(wi + 1).filter(t => t.k === 'ident').map(t => t.v);
      return { k: 'cases', h, withNames, line };
    }
    case 'induction': {
      if (!rest.length || rest[0].k !== 'ident') throw new ParseError('induction needs a variable name', line);
      const h = rest[0].v;
      let withNames = [];
      const wi = rest.findIndex(t => t.k === 'ident' && t.v === 'with');
      if (wi >= 0) withNames = rest.slice(wi + 1).filter(t => t.k === 'ident').map(t => t.v);
      return { k: 'induction', h, withNames, line };
    }
    case 'rw':
    case 'rewrite':
    case 'simp': {
      // [<rules>] with optional `only` and optional `at ...` (rejected later)
      let only = false;
      let ts = rest;
      if (ts.length && ts[0].k === 'ident' && ts[0].v === 'only') { only = true; ts = ts.slice(1); }
      // simp without brackets: `simp` alone
      if (!ts.length) {
        if (w === 'simp') return { k: 'simp', rules: [], only, line };
        throw new ParseError(`${w} needs [...] arguments`, line);
      }
      if (ts[0].k !== 'sym' || ts[0].v !== '[') throw new ParseError(`${w} expects [...]`, ts[0].line);
      // find matching ]
      let depth = 0, end = -1;
      for (let i = 0; i < ts.length; i++) {
        if (ts[i].k === 'sym' && ts[i].v === '[') depth++;
        if (ts[i].k === 'sym' && ts[i].v === ']') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) throw new ParseError(`${w} missing ']'`, line);
      const inner = ts.slice(1, end);
      const after = ts.slice(end + 1);
      let at = null;
      if (after.length) {
        if (after[0].k === 'ident' && after[0].v === 'at') throw new ParseError(`'at h' rewriting is not supported (only goal rewriting)`, after[0].line);
        throw new ParseError(`unexpected '${toksToString(after)}' after ${w}`, line);
      }
      const ruleParts = splitTopLevel(inner, ',').filter(p => p.length);
      const rules = ruleParts.map(rp => {
        let rev = false;
        let r = rp;
        if ((r[0]?.k === 'sym' && (r[0].v === '<-' || r[0].v === '←'))) { rev = true; r = r.slice(1); }
        const p = new ExprParser([...r, { k: 'eof', v: '', line, col: 0 }]);
        return { rev, e: p.parseExpr() };
      });
      if (w === 'simp') return { k: 'simp', rules, only, line };
      return { k: 'rw', rules, line };
    }
    case 'simp_all': return { k: 'simp', rules: [], only: false, useHyps: true, line };
    case 'have': {
      // have h : T := e   |   have h : T := by tacs   |   have h := e   |   have : T := e
      if (!rest.length) throw new ParseError('have needs a name', line);
      let idx = 0, name = null;
      if (rest[0].k === 'ident') { name = rest[0].v; idx = 1; }
      let ty = null;
      if (rest[idx]?.k === 'sym' && rest[idx].v === ':') {
        // find top-level :=
        let di = -1, d2 = 0;
        for (let i = idx + 1; i < rest.length; i++) {
          if (rest[i].k === 'sym' && ['(', '[', '{'].includes(rest[i].v)) d2++;
          if (rest[i].k === 'sym' && [')', ']', '}'].includes(rest[i].v)) d2--;
          if (d2 === 0 && rest[i].k === 'sym' && rest[i].v === ':=') { di = i; break; }
        }
        if (di < 0) throw new ParseError('have needs `:=`', line);
        const typ = new ExprParser([...rest.slice(idx + 1, di), { k: 'eof', v: '', line, col: 0 }]);
        ty = typ.parseExpr();
        idx = di;
      }
      if (!(rest[idx]?.k === 'sym' && rest[idx].v === ':=')) throw new ParseError('have needs `:=`', line);
      const rhs = rest.slice(idx + 1);
      if (rhs.length && rhs[0].k === 'ident' && rhs[0].v === 'by') {
        const sub = splitTopLevel(rhs.slice(1), ';').filter(p => p.length);
        const byTacs = sub.map(s => parseTacticTokens(s, line));
        return { k: 'have', name: name ?? 'this', ty, e: null, byTacs, line };
      }
      return { k: 'have', name: name ?? 'this', ty, e: exprOf(rhs), byTacs: null, line };
    }
    case 'show':
    case 'change': return { k: 'show', e: exprOf(rest), line };
    case 'all_goals': return { k: 'all_goals', tac: parseTacticTokens(rest, line), line };
    case 'case': {
      // case tag => tac[; tac...]  (the sequence runs on the tagged goal)
      if (rest.length < 3 || rest[0].k !== 'ident') throw new ParseError('usage: case <tag> => <tactic>', line);
      const tag = rest[0].v;
      const arrow = rest[1];
      if (!((arrow.k === 'sym' && arrow.v === '=>') || (arrow.k === 'ident' && arrow.v === '=>'))) throw new ParseError('usage: case <tag> => <tactic>', line);
      const steps = splitTopLevel(rest.slice(2), ';').filter(p => p.length).map(s => parseTacticTokens(s, line));
      if (!steps.length) throw new ParseError('usage: case <tag> => <tactic>', line);
      for (const s of steps) {
        if (s.k === 'case') throw new ParseError('nested `case` is not supported', line);
      }
      return { k: 'case', tag, steps, line };
    }
    default: throw new ParseError(`unknown tactic '${w}'`, line);
  }
}

// Parse one tactic source line into a list of steps (split on top-level ';').
// A leading `case tag => …` consumes the whole line (its tail may itself
// contain `;`-separated steps that run on the tagged goal).
export function parseTacticLine(toks, line) {
  // bullet?
  let bullet = false;
  let ts = toks;
  if (ts.length && ((ts[0].k === 'sym' && ts[0].v === '·') || (ts[0].k === 'ident' && ts[0].v === '·'))) {
    bullet = true; ts = ts.slice(1);
  }
  if (ts.length && ts[0].k === 'ident' && ts[0].v === 'case') {
    return { bullet, steps: [parseTacticTokens(ts, line)], line };
  }
  const steps = splitTopLevel(ts, ';').filter(p => p.length).map(p => parseTacticTokens(p, line));
  return { bullet, steps, line };
}

// ---------------------------------------------------------------------------
// File parser
// ---------------------------------------------------------------------------
const DECL_KW = new Set(['theorem', 'lemma', 'example', 'def', 'abbrev', 'axiom']);
const CMD_KW = new Set(['#check', '#eval', '#print']);
const SKIP_KW = new Set(['import', 'open', 'namespace', 'section', 'end', 'variable', 'set_option']);

export function parseFile(src) {
  const toks = lex(src);
  // group tokens by line (excluding eof), keep non-empty lines
  const lines = new Map();
  for (const t of toks) {
    if (t.k === 'eof') break;
    if (!lines.has(t.line)) lines.set(t.line, []);
    lines.get(t.line).push(t);
  }
  const lineNos = [...lines.keys()].sort((a, b) => a - b);
  const decls = [];
  const commands = [];
  let exampleCount = 0;
  let i = 0;
  const isDeclStart = (ts) => ts.length && ts[0].k === 'ident' && DECL_KW.has(ts[0].v);
  const isCmdStart = (ts) => ts.length && ts[0].k === 'cmd' && CMD_KW.has(ts[0].v);
  const isSkipStart = (ts) => ts.length && ts[0].k === 'ident' && SKIP_KW.has(ts[0].v);

  while (i < lineNos.length) {
    const ln = lineNos[i];
    const ts = lines.get(ln);
    if (!ts.length) { i++; continue; }
    if (isSkipStart(ts)) { i++; continue; }
    if (isCmdStart(ts)) {
      const cmd = ts[0].v.slice(1);
      const p = new ExprParser([...ts.slice(1), { k: 'eof', v: '', line: ln, col: 0 }]);
      commands.push({ cmd, e: p.parseExpr(), line: ln });
      i++;
      continue;
    }
    if (!isDeclStart(ts)) {
      throw new ParseError(`expected a declaration (theorem/lemma/example/def/axiom) or #command, got '${ts[0].v}'`, ln);
    }
    const kw = ts[0].v;
    // collect full header: from this line until we see ':=' or end-of-line-terminated axiom
    // Headers may span multiple lines (binders across lines). Accumulate lines until ':=' found at depth 0
    // or (for axiom) end of the logical line.
    let headerToks = [...ts];
    let j = i;
    let foundAssign = indexOfTopLevel(headerToks, ':=');
    while (foundAssign < 0 && kw !== 'axiom') {
      j++;
      if (j >= lineNos.length) break;
      const nts = lines.get(lineNos[j]);
      // if next line starts a new decl/cmd, header is over (only legal for axiom)
      if (isDeclStart(nts) || isCmdStart(nts) || isSkipStart(nts)) break;
      headerToks = headerToks.concat(nts);
      foundAssign = indexOfTopLevel(headerToks, ':=');
    }
    if (kw === 'axiom') {
      const decl = parseHeader(headerToks, kw, ln, null);
      decls.push(decl);
      i = j + 1;
      continue;
    }
    if (foundAssign < 0) throw new ParseError(`declaration needs ':='`, ln);
    // check `by` right after :=
    const afterAssign = headerToks.slice(foundAssign + 1);
    const decl = parseHeader(headerToks.slice(0, foundAssign), kw, ln, null);
    const byOnNextLine = !afterAssign.length && (j + 1 < lineNos.length) &&
      lines.get(lineNos[j + 1]).some((t, idx) => idx === 0 && t.k === 'ident' && t.v === 'by');
    if ((afterAssign.length && afterAssign[0].k === 'ident' && afterAssign[0].v === 'by') || byOnNextLine) {
      // tactic block: consume following lines until next decl/cmd or EOF.
      // Note: `by` may be followed by same-line tactics.
      const tactics = [];
      const sameLine = afterAssign[0]?.k === 'ident' && afterAssign[0].v === 'by' ? afterAssign.slice(1) : [];
      if (sameLine.length) tactics.push(parseTacticLine(sameLine, ln));
      // header consumed lines i..j inclusive; tactic lines start at j+1.
      let k = j + 1;
      // `by` on its own next line: skip that line (it carries no tactics itself
      // unless followed by same-line tactics, which we also accept).
      if (byOnNextLine) {
        const byLine = lines.get(lineNos[k]);
        const rest = byLine.slice(1);
        if (rest.length) tactics.push(parseTacticLine(rest, lineNos[k]));
        k++;
      }
      while (k < lineNos.length) {
        const tls = lines.get(lineNos[k]);
        if (isDeclStart(tls) || isCmdStart(tls) || isSkipStart(tls)) break;
        if (tls.length) tactics.push(parseTacticLine(tls, lineNos[k]));
        k++;
      }
      if (!tactics.length) throw new ParseError(`'by' block is empty`, ln);
      decl.valueIsBy = true;
      decl.tactics = tactics;
      decls.push(decl);
      i = k;
      continue;
    } else {
      // term proof on (possibly) same logical header; expression may continue on following lines?
      // Allow continuation lines that do not start a new decl.
      let exprToks = [...afterAssign];
      let k = j + 1;
      while (k < lineNos.length) {
        const tls = lines.get(lineNos[k]);
        if (!tls.length) { k++; continue; }
        if (isDeclStart(tls) || isCmdStart(tls) || isSkipStart(tls)) break;
        exprToks = exprToks.concat(tls);
        k++;
      }
      if (!exprToks.length) throw new ParseError('missing proof term after `:=`', ln);
      const p = new ExprParser([...exprToks, { k: 'eof', v: '', line: ln, col: 0 }]);
      decl.valueIsBy = false;
      decl.valueExpr = p.parseExpr();
      decls.push(decl);
      i = k;
      continue;
    }
  }
  // name anonymous examples
  for (const d of decls) {
    if (d.kw === 'example') d.name = `example_${++exampleCount}`;
  }
  return { decls, commands };
}

function indexOfTopLevel(toks, sym) {
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'sym' && ['(', '[', '{'].includes(t.v)) depth++;
    if (t.k === 'sym' && [')', ']', '}'].includes(t.v)) depth--;
    if (depth === 0 && ((t.k === 'sym' && t.v === sym) || (t.k === 'ident' && t.v === sym))) return i;
  }
  return -1;
}

function parseHeader(toks, kw, line, _unused) {
  // toks: [kw, name?, binder-groups..., (: type)?]
  let pos = 1;
  let name = null;
  if (kw !== 'example') {
    if (!toks[pos] || toks[pos].k !== 'ident') throw new ParseError(`${kw} needs a name`, line);
    name = toks[pos].v; pos++;
  }
  // find top-level ':' separating binders and type
  let colon = -1, depth = 0;
  for (let q = pos; q < toks.length; q++) {
    const t = toks[q];
    if (t.k === 'sym' && ['(', '[', '{'].includes(t.v)) depth++;
    if (t.k === 'sym' && [')', ']', '}'].includes(t.v)) depth--;
    if (depth === 0 && t.k === 'sym' && t.v === ':') { colon = q; break; }
  }
  let binderToks = colon >= 0 ? toks.slice(pos, colon) : toks.slice(pos);
  let typeExpr = null;
  if (colon >= 0) {
    const p = new ExprParser([...toks.slice(colon + 1), { k: 'eof', v: '', line, col: 0 }]);
    typeExpr = p.parseExpr();
  }
  const binders = parseDeclBinders(binderToks, line);
  return { kw, name, binders, typeExpr, line };
}

function parseDeclBinders(toks, line) {
  const binders = [];
  const p = new ExprParser([...toks, { k: 'eof', v: '', line, col: 0 }]);
  // reuse binder group parsing: groups only (no bare idents except instance names? keep strict)
  const groups = p.parseBinderGroups(false, true);
  for (const g of groups) binders.push(g);
  if (p.peek().k !== 'eof') {
    // allow a single bare type without parens? e.g. `theorem t (h : P)` always parenthesized.
    // Also allow trailing implicit name like `{x}`? that has no type; reject clearly.
    throw new ParseError(`unexpected '${p.peek().v}' in binders`, p.peek().line);
  }
  return binders;
}

// Pretty-print surface expressions (for error messages / UI echo)
export function showExpr(e) {
  switch (e.k) {
    case 'ident': return e.name;
    case 'num': return String(e.value);
    case 'sort': return e.level ? `Type ${e.level}` : 'Type';
    case 'prop': return 'Prop';
    case 'hole': return '_';
    case 'sorry': return 'sorry';
    case 'true': return 'True';
    case 'false': return 'False';
    case 'nat': return 'Nat';
    case 'app': return `(${showExpr(e.fn)} ${e.args.map(showExpr).join(' ')})`;
    case 'fun': return `(fun ${e.binders.map(b => b.ty ? `(${b.name} : ${showExpr(b.ty)})` : b.name).join(' ')} => ${showExpr(e.body)})`;
    case 'forall': return `(∀ ${e.binders.map(b => `${b.name} : ${showExpr(b.ty)}`).join(' ')}, ${showExpr(e.body)})`;
    case 'exists': return `(∃ ${e.binders.map(b => `${b.name} : ${showExpr(b.ty)}`).join(' ')}, ${showExpr(e.body)})`;
    case 'binop': return `(${showExpr(e.l)} ${e.op} ${showExpr(e.r)})`;
    case 'neg': return `(¬${showExpr(e.e)})`;
    case 'ann': return `(${showExpr(e.e)} : ${showExpr(e.ty)})`;
    case 'anon': return `⟨${e.items.map(showExpr).join(', ')}⟩`;
    default: return '?';
  }
}

export function showTactic(t) {
  switch (t.k) {
    case 'intro': return `intro ${t.names.join(' ')}`;
    case 'exact': return `exact ${showExpr(t.e)}`;
    case 'apply': return `apply ${showExpr(t.e)}`;
    case 'rw': return `rw [${t.rules.map(r => (r.rev ? '<- ' : '') + showExpr(r.e)).join(', ')}]`;
    case 'simp': return t.rules.length ? `simp [${t.rules.map(r => showExpr(r.e)).join(', ')}]` : 'simp';
    case 'cases': return `cases ${t.h}${t.withNames.length ? ' with ' + t.withNames.join(' ') : ''}`;
    case 'induction': return `induction ${t.h}${t.withNames.length ? ' with ' + t.withNames.join(' ') : ''}`;
    case 'have': return `have ${t.name}${t.ty ? ' : ' + showExpr(t.ty) : ''} := ${t.byTacs ? 'by ...' : showExpr(t.e)}`;
    case 'show': return `show ${showExpr(t.e)}`;
    case 'case': return `case ${t.tag} => ${(t.steps ?? [t.tac]).map(showTactic).join('; ')}`;
    case 'all_goals': return `all_goals ${showTactic(t.tac)}`;
    default: return t.k;
  }
}
