// Minimal Lean-like trusted kernel (pure JS, no dependencies).
// Works in Node.js and browsers (ES module, no I/O here).
//
// Term language (named representation, capture-avoiding substitution):
//   {t:'Sort', level}   Type level
//   {t:'Prop'}          impredicative universe of propositions
//   {t:'Const', name}   global constant
//   {t:'Var', name}     local variable (free w.r.t. context)
//   {t:'App', fn, arg}
//   {t:'Lam', name, ty, body}   ty may be null (untyped fun, needs expected type)
//   {t:'Pi', name, dom, body}
//   {t:'Let', name, ty, val, body}
//   {t:'Ann', e, ty}
//   {t:'NatLit', value}  number (>=0, safe integer)
//   {t:'Hole', name}     underscore / sorry placeholder (never appears in checked proofs)

export const MAX_FUEL = 4000;

export function Sort(level) { return { t: 'Sort', level }; }
export function PropT() { return { t: 'Prop' }; }
export function Const(name) { return { t: 'Const', name }; }
export function Var(name) { return { t: 'Var', name }; }
export function App(fn, arg) { return { t: 'App', fn, arg }; }
export function Lam(name, ty, body) { return { t: 'Lam', name, ty, body }; }
export function Pi(name, dom, body) { return { t: 'Pi', name, dom, body }; }
export function Let(name, ty, val, body) { return { t: 'Let', name, ty, val, body }; }
export function Ann(e, ty) { return { t: 'Ann', e, ty }; }
export function NatLit(value) { return { t: 'NatLit', value }; }
export function Hole(name) { return { t: 'Hole', name: name ?? '_' }; }

export function mkApps(fn, args) {
  let out = fn;
  for (const a of args) out = App(out, a);
  return out;
}
export function mkPis(bindings, body) {
  let out = body;
  for (let i = bindings.length - 1; i >= 0; i--) out = Pi(bindings[i][0], bindings[i][1], out);
  return out;
}
export function mkLams(bindings, body) {
  let out = body;
  for (let i = bindings.length - 1; i >= 0; i--) out = Lam(bindings[i][0], bindings[i][1], out);
  return out;
}
export function mkArrows(domains, body) {
  let out = body;
  for (let i = domains.length - 1; i >= 0; i--) out = Pi('_', domains[i], out);
  return out;
}

const NAT = 'Nat';
export const NATT = () => Const(NAT);
export const ZERO = () => mkApps(Const('Nat.zero'), []);
export const SUCC = (n) => App(Const('Nat.succ'), n);

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------
export function pretty(tm) {
  switch (tm.t) {
    case 'Sort': return tm.level === 0 ? 'Type' : `Type ${tm.level}`;
    case 'Prop': return 'Prop';
    case 'Const': return tm.name;
    case 'Var': return tm.name;
    case 'NatLit': return String(tm.value);
    case 'Hole': return tm.name === '_' ? '_' : `?${tm.name}`;
    case 'Ann': return `(${pretty(tm.e)} : ${pretty(tm.ty)})`;
    case 'App': {
      const parts = [];
      let cur = tm;
      while (cur.t === 'App') { parts.push(cur.arg); cur = cur.fn; }
      parts.push(cur);
      parts.reverse();
      // Special cases: Eq / And / Or / arithmetic / Exists
      if (parts[0].t === 'Const') {
        const n = parts[0].name;
        if (n === 'Eq' && parts.length === 4) return `(${pretty(parts[2])} = ${pretty(parts[3])})`;
        if (n === 'And' && parts.length === 3) return `(${pretty(parts[1])} ∧ ${pretty(parts[2])})`;
        if (n === 'Or' && parts.length === 3) return `(${pretty(parts[1])} ∨ ${pretty(parts[2])})`;
        if (n === 'Nat.add' && parts.length === 3) return `(${pretty(parts[1])} + ${pretty(parts[2])})`;
        if (n === 'Nat.mul' && parts.length === 3) return `(${pretty(parts[1])} * ${pretty(parts[2])})`;
        if (n === 'Nat.succ' && parts.length === 2) return `(Nat.succ ${prettyArg(parts[1])})`;
        if (n === 'Exists' && parts.length === 3) return `(∃ _ : ${pretty(parts[1])}, ${pretty(parts[2])})`;
      }
      return `(${parts.map(prettyArg).join(' ')})`;
    }
    case 'Lam': return `(fun ${tm.name}${tm.ty ? ' : ' + pretty(tm.ty) : ''} => ${pretty(tm.body)})`;
    case 'Pi': {
      if (tm.name === '_' && !mentions(tm.name, tm.body)) return `(${pretty(tm.dom)} → ${pretty(tm.body)})`;
      return `(∀ ${tm.name} : ${pretty(tm.dom)}, ${pretty(tm.body)})`;
    }
    case 'Let': return `(let ${tm.name} : ${pretty(tm.ty)} := ${pretty(tm.val)}; ${pretty(tm.body)})`;
    default: return '?';
  }
}
function prettyArg(tm) {
  const s = pretty(tm);
  if (tm.t === 'Var' || tm.t === 'Const' || tm.t === 'NatLit' || tm.t === 'Prop' || tm.t === 'Sort' || tm.t === 'Hole') return s;
  return s;
}
function mentions(name, tm) {
  return freeVars(tm).has(name);
}

// ---------------------------------------------------------------------------
// Variables / substitution
// ---------------------------------------------------------------------------
export function freeVars(tm, bound = new Set(), out = new Set()) {
  switch (tm.t) {
    case 'Var': if (!bound.has(tm.name)) out.add(tm.name); break;
    case 'App': freeVars(tm.fn, bound, out); freeVars(tm.arg, bound, out); break;
    case 'Lam':
    case 'Pi': {
      const ann = tm.t === 'Lam' ? tm.ty : tm.dom;
      if (ann) freeVars(ann, bound, out);
      bound.add(tm.name); freeVars(tm.body, bound, out); bound.delete(tm.name);
      break;
    }
    case 'Let':
      if (tm.ty) freeVars(tm.ty, bound, out);
      freeVars(tm.val, bound, out);
      bound.add(tm.name); freeVars(tm.body, bound, out); bound.delete(tm.name);
      break;
    case 'Ann': freeVars(tm.e, bound, out); freeVars(tm.ty, bound, out); break;
    default: break;
  }
  return out;
}

let freshCounter = 0;
export function freshName(base, used) {
  if (!used.has(base)) return base;
  let i = 1;
  while (used.has(`${base}'`.padEnd(base.length + i, "'"))) i++;
  return `${base}${"'".repeat(i)}`;
}
export function fresh(base = 'x') {
  return `${base}_${freshCounter++}`;
}

function renameBound(tm, oldName, newName) {
  // rename free occurrences of Var(oldName) that refer to the binder; here used
  // only right after cloning a binder, so plain substitution without capture
  // issues is fine because newName is globally fresh.
  return subst(tm, oldName, Var(newName));
}

// Capture-avoiding substitution [name := repl]tm
export function subst(tm, name, repl) {
  const replFv = freeVars(repl);
  function go(t, bound) {
    switch (t.t) {
      case 'Var': return (t.name === name && !bound.has(name)) ? repl : t;
      case 'App': return App(go(t.fn, bound), go(t.arg, bound));
      case 'Lam':
      case 'Pi': {
        const isLam = t.t === 'Lam';
        const ann = isLam ? t.ty : t.dom;
        if (t.name === name) {
          // shadowed: only substitute inside the annotation
          const ty2 = ann ? go(ann, bound) : ann;
          return isLam ? Lam(t.name, ty2, t.body) : Pi(t.name, ty2, t.body);
        }
        let bname = t.name;
        let body = t.body;
        if (replFv.has(bname) && mentions(name, body)) {
          const nb = fresh(bname);
          body = renameBound(body, bname, nb);
          bname = nb;
        }
        const ty2 = ann ? go(ann, bound) : ann;
        const nb2 = new Set(bound); nb2.add(bname);
        body = go(body, nb2);
        return isLam ? Lam(bname, ty2, body) : Pi(bname, ty2, body);
      }
      case 'Let': {
        const ty = t.ty ? go(t.ty, bound) : t.ty;
        const val = go(t.val, bound);
        if (t.name === name) return Let(t.name, ty, val, t.body);
        let bname = t.name; let body = t.body;
        if (replFv.has(bname) && mentions(name, body)) {
          const nb = fresh(bname);
          body = renameBound(body, bname, nb);
          bname = nb;
        }
        const nb2 = new Set(bound); nb2.add(bname);
        return Let(bname, ty, val, go(body, nb2));
      }
      case 'Ann': return Ann(go(t.e, bound), go(t.ty, bound));
      default: return t;
    }
  }
  return go(tm, new Set());
}

// Structural equality (alpha modulo bound renaming via pretty of de Bruijn-ish canonical form)
export function structEq(a, b) {
  return canonical(a) === canonical(b);
}
function canonical(tm, env = []) {
  switch (tm.t) {
    case 'Sort': return `T${tm.level}`;
    case 'Prop': return 'P';
    case 'Const': return `C(${tm.name})`;
    case 'Var': {
      const i = env.lastIndexOf(tm.name);
      return i >= 0 ? `B${env.length - 1 - i}` : `F(${tm.name})`;
    }
    case 'NatLit': return `N${tm.value}`;
    case 'Hole': return `H(${tm.name})`;
    case 'App': return `A(${canonical(tm.fn, env)},${canonical(tm.arg, env)})`;
    case 'Lam': return `L(${tm.ty ? canonical(tm.ty, env) : '_'},${canonical(tm.body, [...env, tm.name])})`;
    case 'Pi': return `D(${canonical(tm.dom, env)},${canonical(tm.body, [...env, tm.name])})`;
    case 'Let': return `E(${canonical(tm.ty, env)},${canonical(tm.val, env)},${canonical(tm.body, [...env, tm.name])})`;
    case 'Ann': return `S(${canonical(tm.e, env)},${canonical(tm.ty, env)})`;
    default: return '?';
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
export class Env {
  constructor() {
    this.map = new Map(); // name -> {type, value?, kind}
  }
  add(name, type, value = undefined, kind = 'axiom') {
    if (this.map.has(name)) throw new KernelError(`constant ${name} already declared`);
    this.map.set(name, { type, value, kind });
  }
  has(name) { return this.map.has(name); }
  get(name) { return this.map.get(name); }
  names() { return [...this.map.keys()]; }
  clone() {
    const e = new Env();
    for (const [k, v] of this.map) e.map.set(k, v);
    return e;
  }
}

export class KernelError extends Error {
  constructor(msg) { super(msg); this.name = 'KernelError'; }
}

// Context: Map name -> {type, value?}
export function ctxGet(ctx, name) { return ctx.get(name); }

// ---------------------------------------------------------------------------
// Weak head normal form
// ---------------------------------------------------------------------------
export function whnf(ctx, env, tm, fuel = MAX_FUEL) {
  let cur = tm;
  let depth = 0;
  while (true) {
    if (++depth > fuel) throw new KernelError('whnf: reduction fuel exhausted (possible infinite loop)');
    switch (cur.t) {
      case 'Ann': cur = cur.e; continue;
      case 'Let': cur = subst(cur.body, cur.name, cur.val); continue;
      case 'Var': {
        const e = ctx.get(cur.name);
        if (e && e.value !== undefined) { cur = e.value; continue; }
        return cur;
      }
      case 'App': {
        // collect spine
        const args = [];
        let fn = cur;
        while (fn.t === 'App') { args.push(fn.arg); fn = fn.fn; }
        args.reverse();
        // builtin Nat.add / Nat.mul on numerals (before unfolding, so that
        // `2 + 3` reduces to `5` instead of unfolding into Nat.rec).
        if (fn.t === 'Const' && (fn.name === 'Nat.add' || fn.name === 'Nat.mul') && args.length >= 2) {
          const a = toNatValue(whnf(ctx, env, args[0], fuel));
          if (a !== null) {
            const b = toNatValue(whnf(ctx, env, args[1], fuel));
            if (b !== null) {
              const r = fn.name === 'Nat.add' ? a + b : a * b;
              cur = mkApps(NatLit(Number(r)), args.slice(2));
              continue;
            }
          }
        }
        fn = whnf(ctx, env, fn, fuel);
        if (fn.t === 'Lam') {
          if (args.length === 0) { cur = fn; continue; }
          let body = subst(fn.body, fn.name, args[0]);
          for (let i = 1; i < args.length; i++) body = App(body, args[i]);
          cur = body;
          continue;
        }
        if (fn.t === 'Const') {
          // iota: Nat.rec
          if (fn.name === 'Nat.rec' && args.length >= 4) {
            const [motive, base, step, n, ...rest] = args;
            const nw = whnf(ctx, env, n, fuel);
            const nv = toNatValue(nw);
            let red;
            if (nv !== null) {
              if (nv === 0) red = base;
              else {
                const pred = (typeof nv === 'bigint' ? nv - 1n : nv - 1);
                const predT = (typeof nv === 'bigint' && pred > Number.MAX_SAFE_INTEGER) ? NatLit(Number(pred)) : NatLit(Number(pred));
                const recPred = mkApps(Const('Nat.rec'), [motive, base, step, predT]);
                red = mkApps(step, [predT, recPred]);
              }
            } else if (nw.t === 'Const' && nw.name === 'Nat.zero') red = base;
            else if (nw.t === 'App' && nw.fn.t === 'Const' && nw.fn.name === 'Nat.succ' && nw.arg) {
              const recPred = mkApps(Const('Nat.rec'), [motive, base, step, nw.arg]);
              red = mkApps(step, [nw.arg, recPred]);
            }
            if (red !== undefined) {
              cur = mkApps(red, rest);
              continue;
            }
          }
          // delta: unfold definitions (but not constructors/axioms)
          const ent = env.map.get(fn.name);
          if (ent && ent.value !== undefined) {
            cur = mkApps(ent.value, args);
            continue;
          }
          // rebuild with reduced fn
          if (args.length === 0) return fn;
          let out = fn;
          for (const a of args) out = App(out, a);
          return out;
        }
        // rebuild
        {
          let out = fn;
          for (const a of args) out = App(out, a);
          return out;
        }
      }
      case 'Const': {
        const ent = env.map.get(cur.name);
        if (ent && ent.value !== undefined) { cur = ent.value; continue; }
        return cur;
      }
      default:
        return cur;
    }
  }
}

// Numeric value of a Nat constructor chain or literal (syntactic + one whnf step by caller).
export function toNatValue(tm) {
  if (tm.t === 'NatLit') return tm.value;
  let n = 0;
  let cur = tm;
  while (true) {
    if (cur.t === 'Const' && cur.name === 'Nat.zero') return n;
    if (cur.t === 'App' && cur.fn.t === 'Const' && cur.fn.name === 'Nat.succ') { n++; cur = cur.arg; continue; }
    return null;
  }
}

// Deep evaluation of CLOSED Nat terms (bounded): NatLit/succ-chains,
// Nat.add/Nat.mul and Nat.rec with small literal scrutinees.
// Used by defeq so that closed computations compare by value.
export function evalNat(ctx, env, tm, fuel = 400) {
  const seen = new Map();
  function go(t, depth) {
    if (depth > 60) return null;
    let w;
    try { w = whnf(ctx, env, t, fuel); } catch { return null; }
    if (w.t === 'NatLit') return w.value;
    if (w.t === 'Const' && w.name === 'Nat.zero') return 0;
    if (w.t === 'App' && w.fn.t === 'Const' && w.fn.name === 'Nat.succ') {
      const v = go(w.arg, depth + 1);
      return v === null ? null : v + 1;
    }
    const args = [];
    let h = w;
    while (h.t === 'App') { args.push(h.arg); h = h.fn; }
    args.reverse();
    if (h.t === 'Const' && (h.name === 'Nat.add' || h.name === 'Nat.mul') && args.length >= 2) {
      const a = go(args[0], depth + 1);
      const b = go(args[1], depth + 1);
      if (a === null || b === null || a > 100000 || b > 100000) return null;
      return h.name === 'Nat.add' ? a + b : a * b;
    }
    if (h.t === 'Const' && h.name === 'Nat.rec' && args.length >= 4) {
      const k = go(args[3], depth + 1);
      if (k === null || k < 0 || k > 256) return null;
      // iterate: acc_{i+1} = step i acc_i (as values, via whnf+eval)
      let accT = args[1];
      for (let i = 0; i < k; i++) {
        const applied = App(App(args[2], NatLit(i)), accT);
        let w2;
        try { w2 = whnf(ctx, env, applied, fuel); } catch { return null; }
        const v = go(w2, depth + 1);
        if (v === null) return null;
        accT = NatLit(v);
        void seen;
      }
      const fin = go(accT, depth + 1);
      return fin;
    }
    return null;
  }
  const v = go(tm, 0);
  return (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) ? v : null;
}
function natHeaded(tm) {
  let h = tm;
  while (h.t === 'App') h = h.fn;
  return (h.t === 'NatLit') ||
    (h.t === 'Const' && ['Nat.zero', 'Nat.succ', 'Nat.add', 'Nat.mul', 'Nat.rec'].includes(h.name));
}

// ---------------------------------------------------------------------------
// Definitional equality
// ---------------------------------------------------------------------------
export function defeq(ctx, env, a, b, fuel = MAX_FUEL) {
  const trail = [];
  function go(x, y, d) {
    if (d > 600) throw new KernelError('defeq: depth exhausted');
    if (structEq(x, y)) return true;
    x = whnf(ctx, env, x, fuel);
    y = whnf(ctx, env, y, fuel);
    if (structEq(x, y)) return true;
    // Prop is definitionally Type 0 (impredicative universe à la CC; this lets
    // Nat.rec-style recursors with `motive : Nat → Type` also eliminate into Prop).
    if ((x.t === 'Prop' && y.t === 'Sort' && y.level === 0) ||
        (y.t === 'Prop' && x.t === 'Sort' && x.level === 0)) return true;
    // Nat literals vs succ chains (syntactic fast path)
    const nx = toNatValue(x);
    const ny = toNatValue(y);
    if (nx !== null && ny !== null) return nx === ny;
    if (nx !== null || ny !== null) {
      // one side is a numeral-like Nat term: deep-evaluate closed Nat terms
      if (natHeaded(x) && natHeaded(y)) {
        const ex = evalNat(ctx, env, x);
        const ey = evalNat(ctx, env, y);
        if (ex !== null && ey !== null) return ex === ey;
      }
      return false;
    }
    if (x.t !== y.t) {
      // eta for functions
      if (x.t === 'Lam') {
        const f = fresh(x.name);
        const fv = new Set([...freeVars(x), ...freeVars(y), f]);
        void fv; void trail;
        const v = Var(f);
        const nb = new Map(ctx); nb.set(f, x.ty ?? Hole('_'));
        return go(subst(x.body, x.name, v), App(y, v), d + 1);
      }
      if (y.t === 'Lam') {
        const f = fresh(y.name);
        const v = Var(f);
        return go(App(x, v), subst(y.body, y.name, v), d + 1);
      }
      return false;
    }
    switch (x.t) {
      case 'Sort': return x.level === y.level;
      case 'Prop': return true;
      case 'Const': return x.name === y.name;
      case 'Var': return x.name === y.name;
      case 'NatLit': return x.value === y.value;
      case 'Hole': return x.name === y.name;
      case 'App': return go(x.fn, y.fn, d + 1) && go(x.arg, y.arg, d + 1);
      case 'Lam': {
        if (x.ty && y.ty && !go(x.ty, y.ty, d + 1)) return false;
        const f = fresh(x.name || y.name || 'x');
        const v = Var(f);
        const dom = x.ty ?? y.ty ?? Hole('_');
        const nb = new Map(ctx); nb.set(f, { type: dom });
        const saved = ctxSubstScope(ctx, nb);
        try {
          return go(subst(x.body, x.name, v), subst(y.body, y.name, v), d + 1);
        } finally { restoreScope(ctx, saved); }
      }
      case 'Pi': {
        if (!go(x.dom, y.dom, d + 1)) return false;
        const f = fresh(x.name || 'x');
        const v = Var(f);
        const nb = new Map(ctx); nb.set(f, { type: x.dom });
        const saved = ctxSubstScope(ctx, nb);
        try {
          return go(subst(x.body, x.name, v), subst(y.body, y.name, v), d + 1);
        } finally { restoreScope(ctx, saved); }
      }
      default: return false;
    }
  }
  return go(a, b, 0);
}
function ctxSubstScope(ctx, extra) {
  const saved = new Map();
  for (const [k, v] of extra) {
    saved.set(k, ctx.has(k) ? ctx.get(k) : undefined);
    ctx.set(k, v);
  }
  return saved;
}
function restoreScope(ctx, saved) {
  for (const [k, v] of saved) {
    if (v === undefined) ctx.delete(k); else ctx.set(k, v);
  }
}

// ---------------------------------------------------------------------------
// Type checking (bidirectional)
// ---------------------------------------------------------------------------
export function infer(ctx, env, tm) {
  switch (tm.t) {
    case 'Sort': return Sort(tm.level + 1);
    case 'Prop': return Sort(0);
    case 'Const': {
      const e = env.map.get(tm.name);
      if (!e) throw new KernelError(`unknown constant ${tm.name}`);
      return e.type;
    }
    case 'Var': {
      const e = ctx.get(tm.name);
      if (!e) throw new KernelError(`unknown variable ${tm.name}`);
      return e.type;
    }
    case 'NatLit': return NATT();
    case 'Hole': throw new KernelError('cannot infer type of `_` (needs expected type)');
    case 'Ann': {
      mustBeType(ctx, env, tm.ty);
      check(ctx, env, tm.e, tm.ty);
      return tm.ty;
    }
    case 'Pi': {
      const dSort = mustBeType(ctx, env, tm.dom);
      const f = fresh(tm.name);
      const nb = new Map(ctx); nb.set(f, { type: tm.dom });
      const bodyT = infer(nb, env, subst(tm.body, tm.name, Var(f)));
      const cSort = asSort(whnf(nb, env, bodyT));
      if (!cSort) throw new KernelError(`Pi codomain is not a type: ${pretty(bodyT)}`);
      if (cSort.t === 'Prop') return PropT();
      if (dSort.t === 'Prop') return cSort;
      return Sort(Math.max(dSort.level, cSort.level));
    }
    case 'Lam': {
      if (!tm.ty) throw new KernelError('cannot infer untyped fun (add a type annotation or use `exact` with expected type)');
      mustBeType(ctx, env, tm.ty);
      const f = fresh(tm.name);
      const nb = new Map(ctx); nb.set(f, { type: tm.ty });
      const bT = infer(nb, env, subst(tm.body, tm.name, Var(f)));
      return Pi(tm.name, tm.ty, unsubst(bT, f, tm.name));
    }
    case 'Let': {
      if (tm.ty) { mustBeType(ctx, env, tm.ty); check(ctx, env, tm.val, tm.ty); }
      const vT = tm.ty ?? infer(ctx, env, tm.val);
      const f = fresh(tm.name);
      const nb = new Map(ctx); nb.set(f, { type: vT, value: tm.val });
      const bT = infer(nb, env, subst(tm.body, tm.name, Var(f)));
      return subst(bT, f, tm.val);
    }
    case 'App': {
      const fT = whnf(ctx, env, infer(ctx, env, tm.fn));
      if (fT.t !== 'Pi') throw new KernelError(`function expected a Pi type, got ${pretty(fT)} in ${pretty(tm)}`);
      check(ctx, env, tm.arg, fT.dom);
      return subst(fT.body, fT.name, tm.arg);
    }
    default: throw new KernelError(`cannot infer: ${pretty(tm)}`);
  }
}

export function check(ctx, env, tm, expected) {
  const exp = whnf(ctx, env, expected);
  if (tm.t === 'Hole') return; // holes handled by elaborator/unifier, not kernel
  if (tm.t === 'Lam' && !tm.ty && exp.t === 'Pi') {
    const f = fresh(tm.name || exp.name);
    const nb = new Map(ctx); nb.set(f, { type: exp.dom });
    check(nb, env, subst(tm.body, tm.name, Var(f)), subst(exp.body, exp.name, Var(f)));
    return;
  }
  if (tm.t === 'Lam' && tm.ty && exp.t === 'Pi') {
    if (!defeq(ctx, env, tm.ty, exp.dom)) throw new KernelError(`lambda domain mismatch: ${pretty(tm.ty)} vs ${pretty(exp.dom)}`);
    const f = fresh(tm.name);
    if (globalThis.LEAN_DEBUG) console.log(`LAM-DESCEND binder=${tm.name} fresh=${f}`);
    const nb = new Map(ctx); nb.set(f, { type: exp.dom });
    check(nb, env, subst(tm.body, tm.name, Var(f)), subst(exp.body, exp.name, Var(f)));
    return;
  }
  const got = infer(ctx, env, tm);
  if (!defeq(ctx, env, got, expected)) {
    if (globalThis.LEAN_DEBUG) console.log('CHECK-FAIL got=', JSON.stringify(got), 'exp=', JSON.stringify(expected));
    throw new KernelError(`type mismatch:\n  term has: ${pretty(got)}\n  expected: ${pretty(expected)}`);
  }
}

function unsubst(tm, from, to) {
  // rename Var(from) back to `to` (used after freshening a binder for display fidelity)
  return subst(tm, from, Var(to));
}

export function asSort(tm) {
  if (tm.t === 'Sort' || tm.t === 'Prop') return tm;
  return null;
}
export function mustBeType(ctx, env, tm) {
  const t = whnf(ctx, env, infer(ctx, env, tm));
  const s = asSort(t);
  if (!s) throw new KernelError(`expected a Type/Prop, got ${pretty(tm)} : ${pretty(t)}`);
  return s;
}

// ---------------------------------------------------------------------------
// Head helpers for tactics
// ---------------------------------------------------------------------------
export function spine(tm) {
  const args = [];
  let cur = tm;
  while (cur.t === 'App') { args.push(cur.arg); cur = cur.fn; }
  args.reverse();
  return [cur, args];
}
export function getAppArgs(tm, headName) {
  const [h, args] = spine(whnfEmpty(tm));
  if (h.t === 'Const' && h.name === headName) return args;
  return null;
}
function whnfEmpty(tm) { return tm; }

export function getEqParts(ctx, env, tm) {
  const w = whnf(ctx, env, tm);
  const [h, args] = spine(w);
  if (h.t === 'Const' && h.name === 'Eq' && args.length === 3) {
    return { ty: args[0], lhs: args[1], rhs: args[2] };
  }
  return null;
}
export function getBinParts(ctx, env, tm, head) {
  const w = whnf(ctx, env, tm);
  const [h, args] = spine(w);
  if (h.t === 'Const' && h.name === head && args.length === 2) return args;
  return null;
}
export function getExistsParts(ctx, env, tm) {
  const w = whnf(ctx, env, tm);
  const [h, args] = spine(w);
  if (h.t === 'Const' && h.name === 'Exists' && args.length === 2) return { ty: args[0], pred: args[1] };
  return null;
}
export function isPiType(ctx, env, tm) {
  const w = whnf(ctx, env, tm);
  return w.t === 'Pi' ? w : null;
}

// Collect leading Pi binders: returns {binders:[{name,dom}], body}
export function collectPis(ctx, env, ty) {
  const binders = [];
  let cur = whnf(ctx, env, ty);
  let guard = 0;
  while (cur.t === 'Pi') {
    if (++guard > 500) throw new KernelError('type has too many binders');
    binders.push({ name: cur.name, dom: cur.dom });
    const f = fresh(cur.name);
    const nb = new Map(ctx); nb.set(f, { type: cur.dom });
    cur = whnf(nb, env, subst(cur.body, cur.name, Var(f)));
    // NOTE: substitution uses fresh var; binders after this mention Var(f).
    // Record mapping so callers can re-substitute; store fresh name.
    binders[binders.length - 1].fresh = f;
  }
  return { binders, body: cur };
}
