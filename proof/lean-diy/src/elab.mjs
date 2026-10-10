// Elaborator: surface expression AST (parser.mjs) -> kernel terms (kernel.mjs).
// Handles name resolution, Pi/fun/Exists/=/∧/∨/¬/arithmetic sugar,
// anonymous constructors ⟨a, b⟩, `_` holes and `sorry`.

import {
  Sort, PropT, Const, Var, App, Lam, Pi, Ann, NatLit, Hole,
  mkApps, fresh, subst, freeVars, whnf, infer, check, mustBeType,
  pretty,
} from './kernel.mjs';
import { showExpr } from './parser.mjs';

export class ElabError extends Error {
  constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.name = 'ElabError'; this.line = line; }
}

// env: kernel Env; ctx: Map name -> kernel type (local hypotheses)
export function elab(env, ctx, e, expected = null) {
  const ex = expected ? whnf(ctx, env, expected) : null;
  switch (e.k) {
    case 'ident': {
      if (ctx.has(e.name)) return Var(e.name);
      if (env.has(e.name)) return Const(e.name);
      throw new ElabError(`unknown identifier '${e.name}'`, e.line);
    }
    case 'num': return NatLit(e.value);
    case 'sort': return Sort(e.level);
    case 'prop': return PropT();
    case 'true': return Const('True');
    case 'false': return Const('False');
    case 'nat': return Const('Nat');
    case 'hole': return Hole(fresh('h'));
    case 'sorry': return Hole('sorry' + fresh(''));
    case 'neg': {
      const p = elab(env, ctx, e.e);
      mustBeProp(env, ctx, p, e.line);
      return Pi('_', p, Const('False'));
    }
    case 'binop': return elabBinop(env, ctx, e, ex);
    case 'app': return elabApp(env, ctx, e, ex);
    case 'ann': {
      const ty = elabType(env, ctx, e.ty);
      const v = elab(env, ctx, e.e, ty);
      check(ctx, env, v, ty);
      return Ann(v, ty);
    }
    case 'fun': return elabFun(env, ctx, e, ex);
    case 'forall': return elabForall(env, ctx, e);
    case 'exists': {
      // ∃ x : T, p  ==>  Exists T (fun x : T => p)   (nested for multiple binders)
      const ctx2 = new Map(ctx);
      const tys = [];
      for (const b of e.binders) {
        if (!b.ty) throw new ElabError('∃ binder needs a type', e.line);
        const ty = elabType(env, ctx2, b.ty);
        tys.push([b.name, ty]);
        ctx2.set(b.name, { type: ty });
      }
      const body = elab(env, ctx2, e.body);
      mustBeProp(env, ctx2, body, e.line);
      let inner = body;
      for (let i = tys.length - 1; i >= 0; i--) {
        const [n, ty] = tys[i];
        inner = mkApps(Const('Exists'), [ty, Lam(n, ty, inner)]);
      }
      return inner;
    }
    case 'anon': return elabAnon(env, ctx, e, ex);
    default: throw new ElabError(`cannot elaborate ${e.k}`, e.line);
  }
}

function mustBeProp(env, ctx, tm, line) {
  let t;
  try { t = whnf(ctx, env, infer(ctx, env, tm)); }
  catch (err) { throw new ElabError(`expected a proposition: ${err.message}`, line); }
  if (!(t.t === 'Prop')) throw new ElabError(`expected a proposition (Prop), got type ${pretty(t)}`, line);
}

export function elabType(env, ctx, e) {
  const t = elab(env, ctx, e);
  try { mustBeType(ctx, env, t); }
  catch (err) { throw new ElabError(`expected a Type/Prop: ${showExpr(e)} (${err.message})`, e.line); }
  return t;
}

function elabBinop(env, ctx, e, ex) {
  const { op, l, r } = e;
  if (op === '->' || op === '→') {
    const d = elabType(env, ctx, l);
    const b = elab(env, ctx, r);
    return Pi('_', d, b);
  }
  if (op === '<->' || op === '↔') {
    const a = elab(env, ctx, l); mustBeProp(env, ctx, a, e.line);
    const b = elab(env, ctx, r); mustBeProp(env, ctx, b, e.line);
    return mkApps(Const('And'), [Pi('_', a, b), Pi('_', b, a)]);
  }
  if (op === '∧' || op === '/\\') {
    const a = elab(env, ctx, l); mustBeProp(env, ctx, a, e.line);
    const b = elab(env, ctx, r); mustBeProp(env, ctx, b, e.line);
    return mkApps(Const('And'), [a, b]);
  }
  if (op === '∨' || op === '\\/') {
    const a = elab(env, ctx, l); mustBeProp(env, ctx, a, e.line);
    const b = elab(env, ctx, r); mustBeProp(env, ctx, b, e.line);
    return mkApps(Const('Or'), [a, b]);
  }
  if (op === '=') {
    const a = elab(env, ctx, l);
    let aT;
    try { aT = infer(ctx, env, a); }
    catch (err) { throw new ElabError(`cannot infer type of left side of '=': ${err.message}`, e.line); }
    const b = elab(env, ctx, r, aT);
    try { check(ctx, env, b, aT); }
    catch (err) { throw new ElabError(`'=' needs both sides of the same type: ${err.message}`, e.line); }
    // Eq requires α : Type 0
    const s = whnf(ctx, env, infer(ctx, env, aT));
    void s;
    return mkApps(Const('Eq'), [aT, a, b]);
  }
  if (op === '≠') {
    const eq = elabBinop(env, ctx, { ...e, op: '=' }, ex);
    return Pi('_', eq, Const('False'));
  }
  if (op === '+' || op === '-' || op === '*' || op === '×' || op === '/') {
    if (op !== '+' && op !== '*') throw new ElabError(`operator '${op}' is not supported (only + and * on Nat)`, e.line);
    const a = elab(env, ctx, l);
    const b = elab(env, ctx, r);
    const NatT = Const('Nat');
    try { check(ctx, env, a, NatT); check(ctx, env, b, NatT); }
    catch (err) { throw new ElabError(`arithmetic needs Nat arguments: ${err.message}`, e.line); }
    return mkApps(Const(op === '+' ? 'Nat.add' : 'Nat.mul'), [a, b]);
  }
  throw new ElabError(`unknown operator '${op}'`, e.line);
}

function elabApp(env, ctx, e, _ex) {
  const fn = elab(env, ctx, e.fn);
  const args = e.args.map((a) => elab(env, ctx, a));
  return mkApps(fn, args);
}

function elabFun(env, ctx, e, ex) {
  // thread expected Pi domains into untyped binders
  let expDomains = [];
  if (ex && ex.t === 'Pi') {
    let cur = ex;
    while (cur.t === 'Pi') { expDomains.push(cur.dom); cur = cur.body; }
  }
  const ctx2 = new Map(ctx);
  const out = [];
  e.binders.forEach((b, idx) => {
    let ty = null;
    if (b.ty) ty = elabType(env, ctx2, b.ty);
    else if (idx < expDomains.length) ty = expDomains[idx];
    else throw new ElabError(`fun binder '${b.name}' needs a type annotation`, e.line);
    out.push([b.name, ty]);
    ctx2.set(b.name, { type: ty });
  });
  let bodyEx = null;
  if (ex && ex.t === 'Pi' && expDomains.length >= e.binders.length) {
    // substitute expected cods (they may mention binder names positionally — best effort)
    bodyEx = ex;
    for (let i = 0; i < e.binders.length; i++) bodyEx = bodyEx.body;
  }
  void bodyEx;
  const body = elab(env, ctx2, e.body);
  let tm = body;
  for (let i = out.length - 1; i >= 0; i--) tm = Lam(out[i][0], out[i][1], tm);
  return tm;
}

function elabForall(env, ctx, e) {
  const ctx2 = new Map(ctx);
  const out = [];
  for (const b of e.binders) {
    if (!b.ty) throw new ElabError(`∀ binder '${b.name}' needs a type`, e.line);
    const ty = elabType(env, ctx2, b.ty);
    out.push([b.name, ty]);
    ctx2.set(b.name, { type: ty });
  }
  const body = elab(env, ctx2, e.body);
  mustBeTypeOrProp(env, ctx2, body, e.line);
  let tm = body;
  for (let i = out.length - 1; i >= 0; i--) tm = Pi(out[i][0], out[i][1], tm);
  return tm;
}
function mustBeTypeOrProp(env, ctx, tm, line) {
  try { mustBeType(ctx, env, tm); }
  catch (err) { throw new ElabError(`∀ body must be a Type/Prop: ${err.message}`, line); }
}

function elabAnon(env, ctx, e, ex) {
  // ⟨a, b⟩ with expected And / Exists; ⟨a⟩ single; ⟨⟩ True
  if (e.items.length === 0) {
    if (ex && (ex.t === 'Const' && ex.name === 'True')) return Const('True.intro');
    return Const('True.intro');
  }
  if (!ex) throw new ElabError('⟨...⟩ needs an expected type (use it with `exact`/`apply`)', e.line);
  const w = whnf(ctx, env, ex);
  const [head, args] = spineOf(w);
  if (head.t === 'Const' && head.name === 'And' && args.length === 2 && e.items.length === 2) {
    const a = elab(env, ctx, e.items[0], args[0]);
    const b = elab(env, ctx, e.items[1], args[1]);
    return mkApps(Const('And.intro'), [args[0], args[1], a, b]);
  }
  if (head.t === 'Const' && head.name === 'Exists' && args.length === 2 && e.items.length === 2) {
    // ⟨w, h⟩ : Exists α pred
    const wtn = elab(env, ctx, e.items[0], args[0]);
    const predW = App(args[1], wtn);
    const h = elab(env, ctx, e.items[1], predW);
    return mkApps(Const('Exists.intro'), [args[0], args[1], wtn, h]);
  }
  if (head.t === 'Const' && head.name === 'Or' && e.items.length === 1) {
    throw new ElabError('⟨a⟩ is ambiguous for Or (use Or.inl / Or.inr, or the `left`/`right` tactics)', e.line);
  }
  throw new ElabError(`⟨...⟩ with ${e.items.length} item(s) does not match expected type`, e.line);
}

function spineOf(tm) {
  const args = [];
  let cur = tm;
  while (cur.t === 'App') { args.push(cur.arg); cur = cur.fn; }
  args.reverse();
  return [cur, args];
}

// ---------------------------------------------------------------------------
// First-order unification for `_` holes (Hole nodes act as metavariables).
// Returns assignment Map holeName -> kernel term, or throws ElabError.
// ---------------------------------------------------------------------------
export function unifyHoles(env, ctx, a, b, line) {
  const assign = new Map();
  function deref(t) {
    let cur = t;
    const seen = new Set();
    while (cur.t === 'Hole' && assign.has(cur.name) && !seen.has(cur.name)) {
      seen.add(cur.name);
      cur = assign.get(cur.name);
    }
    return cur;
  }
  function occurs(n, t) {
    t = deref(t);
    if (t.t === 'Hole') return t.name === n;
    if (t.t === 'Var') return t.name === n;
    if (t.t === 'App') return occurs(n, t.fn) || occurs(n, t.arg);
    if (t.t === 'Lam') return (t.ty ? occurs(n, t.ty) : false) || occurs(n, t.body);
    if (t.t === 'Pi') return occurs(n, t.dom) || occurs(n, t.body);
    if (t.t === 'Let') return occurs(n, t.ty) || occurs(n, t.val) || occurs(n, t.body);
    if (t.t === 'Ann') return occurs(n, t.e) || occurs(n, t.ty);
    return false;
  }
  function go(x, y, depth) {
    if (depth > 400) throw new ElabError('unification depth exhausted', line);
    x = whnf(ctx, env, deref(x));
    y = whnf(ctx, env, deref(y));
    // pseudo-structural compare that treats assigned holes as their values
    if (x.t === 'Hole' && x.name.startsWith('sorry')) throw new ElabError('`sorry` cannot be unified', line);
    if (x.t === 'Hole' && !x.name.startsWith('sorry')) {
      if (y.t === 'Hole' && y.name === x.name) return;
      if (occurs(x.name, y)) throw new ElabError('cannot unify (occurs check)', line);
      assign.set(x.name, y);
      return;
    }
    if (y.t === 'Hole' && !y.name.startsWith('sorry')) {
      if (occurs(y.name, x)) throw new ElabError('cannot unify (occurs check)', line);
      assign.set(y.name, x);
      return;
    }
    if (x.t !== y.t) {
      // beta-eta: if one side is Lam, eta-expand the other
      if (x.t === 'Lam' || y.t === 'Lam') {
        const f = fresh('u');
        const v = Var(f);
        const nb = new Map(ctx); nb.set(f, { type: Hole(fresh('d')) });
        const xx = x.t === 'Lam' ? subst(x.body, x.name, v) : App(x, v);
        const yy = y.t === 'Lam' ? subst(y.body, y.name, v) : App(y, v);
        return go(xx, yy, depth + 1);
      }
      throw new ElabError('types do not match', line);
    }
    switch (x.t) {
      case 'Sort': if (x.level !== y.level) throw new ElabError('universe mismatch', line); return;
      case 'Prop': return;
      case 'Const': if (x.name !== y.name) throw new ElabError('constants do not match', line); return;
      case 'Var': if (x.name !== y.name) throw new ElabError('variables do not match', line); return;
      case 'NatLit': if (x.value !== y.value) throw new ElabError('numerals do not match', line); return;
      case 'App': go(x.fn, y.fn, depth + 1); go(x.arg, y.arg, depth + 1); return;
      case 'Lam':
      case 'Pi': {
        go(x.ty ?? x.dom ?? Hole(fresh('d')), y.ty ?? y.dom ?? Hole(fresh('d')), depth + 1);
        const f = fresh('u');
        const v = Var(f);
        const dom = x.t === 'Lam' ? (x.ty ?? Hole(fresh('d'))) : x.dom;
        const nb = new Map(ctx); nb.set(f, { type: dom });
        go(subst(x.body, x.name, v), subst(y.body, y.name, v), depth + 1);
        return;
      }
      default: throw new ElabError('cannot unify', line);
    }
  }
  // cheap pre-check with structurally-normalized comparison happens inside go()
  try {
    go(a, b, 0);
  } catch (err) {
    if (err instanceof ElabError) throw err;
    throw new ElabError(`unification failed (${err.message})`, line);
  }
  return assign;
}

export function applyAssign(tm, assign) {
  function deref(t) {
    if (t.t === 'Hole' && assign.has(t.name)) return deref(assign.get(t.name));
    return t;
  }
  function go(t) {
    t = deref(t);
    switch (t.t) {
      case 'App': return App(go(t.fn), go(t.arg));
      case 'Lam': return Lam(t.name, t.ty ? go(t.ty) : t.ty, go(t.body));
      case 'Pi': return Pi(t.name, go(t.dom), go(t.body));
      case 'Let': return t.ty ? { t: 'Let', name: t.name, ty: go(t.ty), val: go(t.val), body: go(t.body) } : t;
      case 'Ann': return Ann(go(t.e), go(t.ty));
      default: return t;
    }
  }
  return go(tm);
}

export function hasUnassignedHole(tm, assign) {
  let found = false;
  function go(t) {
    if (t.t === 'Hole' && !assign.has(t.name) && !t.name.startsWith('sorry')) { found = true; return; }
    if (t.t === 'App') { go(t.fn); go(t.arg); }
    else if (t.t === 'Lam') { if (t.ty) go(t.ty); go(t.body); }
    else if (t.t === 'Pi') { go(t.dom); go(t.body); }
  }
  go(applyAssign(tm, assign));
  return found;
}

export function hasSorry(tm) {
  let found = false;
  function go(t) {
    if (!t || found) return;
    if (t.t === 'Hole' && String(t.name).startsWith('sorry')) { found = true; return; }
    if (t.t === 'App') { go(t.fn); go(t.arg); }
    else if (t.t === 'Lam') { if (t.ty) go(t.ty); go(t.body); }
    else if (t.t === 'Pi') { go(t.dom); go(t.body); }
    else if (t.t === 'Let') { go(t.ty); go(t.val); go(t.body); }
    else if (t.t === 'Ann') { go(t.e); go(t.ty); }
  }
  go(tm);
  return found;
}
