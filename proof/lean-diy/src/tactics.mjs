// Tactic engine: transforms goals into subgoals while building proof terms.
// Every closing step produces a kernel term; the final proof is re-checked
// by the trusted kernel, so tactic bugs cannot produce false proofs
// (they can only fail or produce terms the kernel rejects).
//
// Goal semantics (documented for users):
//   - Each tactic line acts on the FIRST open goal.
//   - `a; b` inside one line: `b` runs on ALL goals produced by `a`.
//   - `· tac` focuses the first goal (same rule, marks branches visually).
//   - `all_goals tac` runs tac on every open goal.
//   - `case <tag> => tac` runs tac on the goal tagged <tag>.

import {
  Const, Var, App, Lam, Pi, NatLit, Hole,
  mkApps, fresh, subst, freeVars, whnf, infer, check, defeq,
  getEqParts, getBinParts, getExistsParts, isPiType, pretty, structEq,
  toNatValue, KernelError,
} from './kernel.mjs';
import { elab, elabType, unifyHoles, applyAssign, hasUnassignedHole, hasSorry, ElabError } from './elab.mjs';
import { showExpr, showTactic } from './parser.mjs';
import { SIMP_LEMMAS } from './prelude.mjs';

export class TacticError extends Error {
  constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.name = 'TacticError'; this.line = line; }
}
function terr(msg, line) { return new TacticError(msg, line); }

// ---------------------------------------------------------------------------
// Slots & joins (proof assembly)
// ---------------------------------------------------------------------------
let slotId = 0;
export function makeSlot(hyps, target, tag, join, index) {
  return {
    id: ++slotId,
    hyps: hyps.map(h => ({ ...h })), // [{name, type}]
    target,
    tag: tag ?? 'main',
    join, index,
    wrap: (p) => p,
  };
}
function closeSlot(slot, proof) {
  if (slot.closed) throw new TacticError('internal error: goal closed twice');
  slot.closed = true;
  const j = slot.join;
  j.proofs[slot.index] = slot.wrap(proof);
  j.filled++;
  if (j.filled === j.n) j.k(j.combine(j.proofs));
}
function wrapSlot(slot, f) {
  const old = slot.wrap;
  slot.wrap = (p) => old(f(p));
}
export function slotCtx(slot) {
  const m = new Map();
  for (const h of slot.hyps) m.set(h.name, { type: h.type });
  return m;
}
function findHyp(slot, name, line) {
  const h = slot.hyps.find((x) => x.name === name);
  if (!h) throw terr(`unknown hypothesis '${name}'`, line);
  return h;
}
function assertFresh(slot, name, line) {
  if (slot.hyps.some((h) => h.name === name)) throw terr(`'${name}' is already used (pick a fresh name)`, line);
}

export function showGoal(env, slot) {
  const ctx = slotCtx(slot);
  void ctx;
  const hs = slot.hyps.map((h) => `  ${h.name} : ${pretty(h.type)}`).join('\n');
  return `${slot.tag} ⊢ ${pretty(slot.target)}${hs ? '\n' + hs : ''}`;
}

// ---------------------------------------------------------------------------
// Step dispatch
// ---------------------------------------------------------------------------
function execStep(env, slot, step, opts) {
  switch (step.k) {
    case 'intro': return [doIntro(env, slot, step)];
    case 'exact': doExact(env, slot, step, opts); return [];
    case 'apply': return doApply(env, slot, step, opts);
    case 'assumption': doAssumption(env, slot, step); return [];
    case 'trivial': doTrivial(env, slot, step); return [];
    case 'rfl': doRfl(env, slot, step); return [];
    case 'constructor': return doConstructor(env, slot, step);
    case 'left': doLeftRight(env, slot, step, 'left'); return [slot];
    case 'right': doLeftRight(env, slot, step, 'right'); return [slot];
    case 'cases': return doCases(env, slot, step);
    case 'induction': return doInduction(env, slot, step);
    case 'rw': return doRewriteSeq(env, slot, step, opts);
    case 'simp': return doSimp(env, slot, step, opts);
    case 'have': doHave(env, slot, step, opts); return [slot];
    case 'show': doShow(env, slot, step); return [slot];
    case 'sorry': doSorry(env, slot, step, opts); return [];
    case 'all_goals': {
      // nested all_goals inside ; chains: acts on this single slot
      const kids = execStep(env, slot, step.tac, opts);
      return kids;
    }
    case 'case': throw terr('nested `case` is not supported', step.line);
    default: throw terr(`unsupported tactic '${step.k}'`, step.line);
  }
}

// Patch runBlock to use broadcast semantics for `;` chains and a sane all_goals.
export function runBlock(env, hyps, target, lines, opts = {}) {
  const trace = [];
  let result = null;
  const top = { n: 1, proofs: new Array(1), filled: 0, combine: (ps) => ps[0], k: (p) => { result = p; } };
  const queue = [makeSlot(hyps, target, 'main', top, 0)];
  const pushTrace = (label) => {
    trace.push({ label, goals: queue.map((s) => snapshotSlot(s)) });
  };
  pushTrace('start');
  for (const ln of lines) {
    for (const sub of splitCaseLines(ln)) {
      if (sub.k === 'all_goals') {
        if (!queue.length) throw terr('all_goals: no goals', sub.line);
        const cur = queue.splice(0, queue.length);
        const out = [];
        for (const s of cur) out.push(...execStep(env, s, sub.tac, opts));
        queue.push(...out);
      } else if (sub.k === 'case') {
        const idx = queue.findIndex((s) => s.tag === sub.tag);
        if (idx < 0) throw terr(`case: no goal tagged '${sub.tag}' (open: ${queue.map((s) => s.tag).join(', ') || 'none'})`, sub.line);
        const [s] = queue.splice(idx, 1);
        let progeny = execStep(env, s, sub.steps[0], opts);
        for (const st of sub.steps.slice(1)) {
          const next = [];
          for (const q of progeny) next.push(...execStep(env, q, st, opts));
          progeny = next;
        }
        queue.splice(idx, 0, ...progeny);
      } else if (sub.k === 'seq') {
        if (!queue.length) throw terr(`no goals (tactic '${sub.steps.map(showTactic).join('; ')}' has nothing to act on)`, sub.line);
        const first = queue.shift();
        let progeny = execStep(env, first, sub.steps[0], opts);
        for (const st of sub.steps.slice(1)) {
          const next = [];
          for (const s of progeny) next.push(...execStep(env, s, st, opts));
          progeny = next;
        }
        queue.unshift(...progeny);
      }
    }
    const label = `${ln.bullet ? '· ' : ''}${ln.steps.map(showTactic).join('; ')}`;
    pushTrace(label);
  }
  if (queue.length) {
    const rest = queue.map((s) => `\n[${s.tag}] ${pretty(s.target)}`).join('');
    throw terr(`proof incomplete: ${queue.length} unsolved goal(s):${rest}`, lines.length ? lines[lines.length - 1].line : undefined);
  }
  if (!result) throw terr('proof produced no term', undefined);
  const ctx = new Map();
  for (const h of hyps) ctx.set(h.name, { type: h.type });
  try {
    check(ctx, env, result, target);
  } catch (err) {
    if (globalThis.LEAN_DEBUG) console.log('INNER STACK:', err.stack);
    throw terr(`kernel rejected the proof term (${err.message})`, undefined);
  }
  return { proof: result, trace };
}

function snapshotSlot(s) {
  return ({ tag: s.tag, hyps: s.hyps.map((h) => ({ name: h.name, type: pretty(h.type) })), target: pretty(s.target) });
}
// A parsed line is {bullet, steps}; wrap single steps for uniform handling.
function splitCaseLines(ln) {
  const out = [];
  for (const st of ln.steps) {
    if (st.k === 'all_goals' || st.k === 'case') {
      if (ln.steps.length > 1 && st.k === 'all_goals') {
        throw terr('cannot mix `;` with `all_goals` on one line (split into separate lines)', ln.line);
      }
      out.push(st);
    }
    else out.push({ k: 'seq', steps: [st], line: st.line });
  }
  // merge consecutive seq singles back into one seq to preserve `;` broadcast
  const merged = [];
  for (const o of out) {
    if (o.k === 'seq' && merged.length && merged[merged.length - 1].k === 'seq' && !ln.bullet) {
      merged[merged.length - 1].steps.push(...o.steps);
    } else merged.push(o);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Individual tactics
// ---------------------------------------------------------------------------
function doIntro(env, slot, step) {
  const ctx = slotCtx(slot);
  for (const name of step.names) {
    assertFresh(slot, name, step.line);
    const pi = whnf(ctx, env, slot.target);
    if (pi.t !== 'Pi') throw terr(`intro ${name}: goal is not a function type:\n  ${pretty(slot.target)}`, step.line);
    const dom = pi.dom;
    slot.hyps.push({ name, type: dom });
    ctx.set(name, { type: dom });
    const oldBody = pi.body, oldName = pi.name;
    slot.target = subst(oldBody, oldName, Var(name));
    const d = dom;
    wrapSlot(slot, (p) => Lam(name, d, p));
  }
  return slot;
}

function elabChecked(env, slot, expr, line) {
  const ctx = slotCtx(slot);
  let tm;
  try {
    tm = elab(env, ctx, expr, slot.target);
  } catch (err) {
    throw terr(`exact: cannot elaborate (${err.message})`, line);
  }
  const solved = solveHolesToTarget(env, ctx, tm, slot.target, line);
  try {
    check(ctx, env, solved, slot.target);
  } catch (err) {
    throw terr(`exact: ${err.message}`, line);
  }
  return solved;
}

// Elaborate tm (may contain Holes from `_`), unify its type with target.
export function solveHolesToTarget(env, ctx, tm, target, line) {
  const T = inferHoles(env, ctx, tm, line);
  const all = new Map(T.assign);
  // apply domain-solving assignments first
  let tm1 = applyAssign(tm, all);
  let T1 = applyAssign(T.type, all);
  let extra;
  try {
    extra = unifyHoles(env, ctx, T1, target, line);
  } catch (err) {
    throw terr(`type mismatch: proof has type ${pretty(T1)}, goal is ${pretty(target)}${err.message ? ` (${err.message})` : ''}`, line);
  }
  for (const [k, v] of extra) {
    if (all.has(k)) {
      const a = applyAssign(all.get(k), all);
      const b = applyAssign(v, all);
      if (!safeDefeq(ctx, env, a, b)) throw terr('ambiguous `_`: conflicting solutions', line);
    } else all.set(k, v);
  }
  const out = applyAssign(tm1, all);
  if (hasUnassignedHole(out, new Map())) throw terr('`_` could not be determined (provide more explicit arguments)', line);
  if (hasSorry(out)) return out; // sorry handled by caller
  // re-verify deferred checks under full assignment
  for (const [t, ty] of T.deferred) {
    const t2 = applyAssign(t, all), ty2 = applyAssign(ty, all);
    try {
      check(ctx, env, t2, ty2);
    } catch (err) {
      throw terr(`type mismatch (${err.message})`, line);
    }
  }
  return out;
}

function safeDefeq(ctx, env, a, b) {
  try { return defeq(ctx, env, a, b); } catch { return false; }
}

// Hole-tolerant inference. Returns {type, assign, deferred:[[tm,ty]]}.
// - Hole in value position: succeeds, records nothing (solved by result unification).
// - non-hole term vs hole-containing domain: solve via unification when possible,
//   else defer.
function inferHoles(env, ctx, tm, line) {
  const assign = new Map();
  const deferred = [];
  const derefA = (t) => applyAssign(t, assign);
  function go(t) {
    switch (t.t) {
      case 'Hole': return Hole('ty_' + t.name); // unknown type; caller unifies result
      case 'Var': {
        const e = ctx.get(t.name);
        if (!e) throw terr(`unknown variable '${t.name}'`, line);
        return e.type;
      }
      case 'Const': {
        const e = env.map.get(t.name);
        if (!e) throw terr(`unknown constant '${t.name}'`, line);
        return e.type;
      }
      case 'NatLit': return Const('Nat');
      case 'Sort': return { t: 'Sort', level: t.level + 1 };
      case 'Prop': return { t: 'Sort', level: 0 };
      case 'Ann': chk(t.e, t.ty); return t.ty;
      case 'Lam': {
        if (!t.ty) throw terr('cannot infer untyped fun here (add annotation)', line);
        const nb = new Map(ctx);
        const f = fresh(t.name);
        nb.set(f, { type: t.ty });
        const bt = go2(nb, subst(t.body, t.name, Var(f)));
        return Pi(t.name, t.ty, subst(bt, f, Var(t.name)));
      }
      case 'Pi': {
        const nb = new Map(ctx);
        const f = fresh(t.name);
        nb.set(f, { type: t.dom });
        const bt = go2(nb, subst(t.body, t.name, Var(f)));
        void bt;
        // universe: assume ok (kernel re-checks at the end)
        return { t: 'Sort', level: 0 };
      }
      case 'Let': {
        const vt = t.ty ?? go(t.val);
        if (t.ty) chk(t.val, t.ty);
        const nb = new Map(ctx);
        const f = fresh(t.name);
        nb.set(f, { type: vt });
        const bt = go2(nb, subst(t.body, t.name, Var(f)));
        return subst(bt, f, t.val);
      }
      case 'App': {
        const fT = whnf(ctx, env, derefA(go(t.fn)));
        if (fT.t !== 'Pi') throw terr(`too many arguments / not a function: ${pretty(t.fn)}`, line);
        chk(t.arg, fT.dom);
        return subst(fT.body, fT.name, t.arg);
      }
      default: throw terr('cannot infer', line);
    }
  }
  function go2(savedCtx, t) {
    // run go() with a different ctx (for binders)
    const keep = new Map(ctx);
    ctx.clear();
    for (const [k, v] of savedCtx) ctx.set(k, v);
    try {
      return go(t);
    } finally {
      ctx.clear();
      for (const [k, v] of keep) ctx.set(k, v);
    }
  }
  function chk(t, ty) {
    const d = derefA(ty);
    if (t.t === 'Hole' && !t.name.startsWith('sorry') && !t.name.startsWith('ty_')) return; // value hole: defer
    if (t.t === 'Hole') return;
    if (containsHole(d)) {
      // try to solve domain holes from the argument's type
      let it;
      try { it = go(t); } catch { deferred.push([t, d]); return; }
      try {
        const a2 = unifyHoles(env, ctx, it, d, line);
        for (const [k, v] of a2) { if (!assign.has(k)) assign.set(k, v); }
      } catch { deferred.push([t, d]); }
      return;
    }
    try {
      check(ctx, env, applyAssign(t, assign), d);
    } catch (err) {
      // last chance: unification (handles NatLit vs succ-chains etc.)
      let it;
      try { it = go(t); } catch { throw terr(`type mismatch (${err.message})`, line); }
      try {
        const a2 = unifyHoles(env, ctx, it, d, line);
        for (const [k, v] of a2) { if (!assign.has(k)) assign.set(k, v); }
      } catch { throw terr(`type mismatch (${err.message})`, line); }
    }
  }
  const ty = go(tm);
  return { type: ty, assign, deferred };
}

function containsHole(t) {
  let f = false;
  (function g(x) {
    if (!x || f) return;
    if (x.t === 'Hole' && !x.name.startsWith('sorry')) { f = true; return; }
    if (x.t === 'App') { g(x.fn); g(x.arg); }
    else if (x.t === 'Lam') { if (x.ty) g(x.ty); g(x.body); }
    else if (x.t === 'Pi') { g(x.dom); g(x.body); }
    else if (x.t === 'Let') { g(x.ty); g(x.val); g(x.body); }
    else if (x.t === 'Ann') { g(x.e); g(x.ty); }
  })(t);
  return f;
}

function doExact(env, slot, step, opts) {
  const ctx = slotCtx(slot);
  let tm;
  try {
    tm = elab(env, ctx, step.e, slot.target);
  } catch (err) {
    throw terr(`cannot elaborate (${err.message})`, step.line);
  }
  if (hasSorry(tm)) {
    if (opts.warnings) opts.warnings.push(`line ${step.line}: 'sorry' used (admits ${pretty(slot.target)})`);
    // elaborate the non-sorry skeleton for a better error if it is ill-typed,
    // but close with sorryAx applied to the goal.
    closeSlot(slot, App(Const('sorryAx'), slot.target));
    return;
  }
  const solved = solveHolesToTarget(env, ctx, tm, slot.target, step.line);
  try {
    check(ctx, env, solved, slot.target);
  } catch (err) {
    throw terr(`${err.message}`, step.line);
  }
  closeSlot(slot, solved);
}

function doAssumption(env, slot, step) {
  const ctx = slotCtx(slot);
  for (let i = slot.hyps.length - 1; i >= 0; i--) {
    const h = slot.hyps[i];
    if (safeDefeq(ctx, env, h.type, slot.target)) {
      closeSlot(slot, Var(h.name));
      return;
    }
  }
  throw terr(`assumption failed: no hypothesis matches ${pretty(slot.target)}`, step.line);
}

function doRfl(env, slot, step) {
  const ctx = slotCtx(slot);
  const eq = getEqParts(ctx, env, slot.target);
  if (!eq) throw terr(`rfl: goal is not an equality:\n  ${pretty(slot.target)}`, step.line);
  if (!safeDefeq(ctx, env, eq.lhs, eq.rhs)) {
    throw terr(`rfl failed: ${pretty(eq.lhs)} is not definitionally equal to ${pretty(eq.rhs)}`, step.line);
  }
  // Eq.refl α a
  closeSlot(slot, mkApps(Const('Eq.refl'), [eq.ty, eq.lhs]));
}

function doTrivial(env, slot, step) {
  const ctx = slotCtx(slot);
  try { doAssumption(env, slot, step); return; } catch {}
  try { doRfl(env, slot, step); return; } catch {}
  const w = whnf(ctx, env, slot.target);
  if (w.t === 'Const' && w.name === 'True') { closeSlot(slot, Const('True.intro')); return; }
  for (const h of slot.hyps) {
    const t = whnf(ctx, env, h.type);
    if (t.t === 'Const' && t.name === 'False') {
      closeSlot(slot, mkApps(Const('False.elim'), [slot.target, Var(h.name)]));
      return;
    }
  }
  throw terr(`trivial failed on ${pretty(slot.target)}`, step.line);
}

function doConstructor(env, slot, step) {
  const ctx = slotCtx(slot);
  const w = whnf(ctx, env, slot.target);
  const [head, args] = spineOf(w);
  if (head.t === 'Const' && head.name === 'And' && args.length === 2) {
    const [p, q] = args;
    const j = { n: 2, proofs: new Array(2), filled: 0, combine: ([a, b]) => mkApps(Const('And.intro'), [p, q, a, b]), k: (t) => closeSlot(slot, t) };
    return [makeSlot(slot.hyps, p, 'left', j, 0), makeSlot(slot.hyps, q, 'right', j, 1)];
  }
  if (head.t === 'Const' && head.name === 'True' && !args.length) {
    closeSlot(slot, Const('True.intro'));
    return [];
  }
  if (head.t === 'Const' && head.name === 'Eq' && args.length === 3) {
    doRfl(env, slot, step);
    return [];
  }
  if (head.t === 'Const' && head.name === 'Exists' && args.length === 2) {
    throw terr('constructor: Exists needs an explicit witness (use `exact ⟨w, h⟩` or `apply Exists.intro`)', step.line);
  }
  if (head.t === 'Const' && head.name === 'Or') {
    throw terr('constructor: Or is ambiguous (use `left` or `right`)', step.line);
  }
  throw terr(`constructor failed on ${pretty(slot.target)}`, step.line);
}

function doLeftRight(env, slot, step, side) {
  const ctx = slotCtx(slot);
  const parts = getBinParts(ctx, env, slot.target, 'Or');
  if (!parts) throw terr(`${side}: goal is not a disjunction:\n  ${pretty(slot.target)}`, step.line);
  const [p, q] = parts;
  slot.target = side === 'left' ? p : q;
  const c = side === 'left' ? 'Or.inl' : 'Or.inr';
  wrapSlot(slot, (prf) => mkApps(Const(c), [p, q, prf]));
}

function spineOf(tm) {
  const args = [];
  let cur = tm;
  while (cur.t === 'App') { args.push(cur.arg); cur = cur.fn; }
  args.reverse();
  return [cur, args];
}

// -- cases --------------------------------------------------------------------
function doCases(env, slot, step) {
  const ctx = slotCtx(slot);
  const h = findHyp(slot, step.h, step.line);
  const T = whnf(ctx, env, h.type);
  const [head, args] = spineOf(T);
  const rest = slot.hyps.filter((x) => x.name !== h.name);
  const names = step.withNames;

  const headName = head.t === 'Const' ? head.name : null;
  if (headName === 'And' && args.length === 2) {
    const [p, q] = args;
    const n1 = names[0] ?? `${h.name}_left`;
    const n2 = names[1] ?? `${h.name}_right`;
    assertFresh(slot, n1, step.line); assertFresh(slot, n2, step.line);
    const s = makeSlot([...rest, { name: n1, type: p }, { name: n2, type: q }], slot.target, slot.tag, slot.join, slot.index);
    s.wrap = (prf) => slot.wrap(subst(subst(prf, n2, mkApps(Const('And.right'), [p, q, Var(h.name)])), n1, mkApps(Const('And.left'), [p, q, Var(h.name)])));
    return [s];
  }
  if (headName === 'Or' && args.length === 2) {
    const [p, q] = args;
    const n1 = names[0] ?? `${h.name}_inl`;
    const n2 = names[1] ?? `${h.name}_inr`;
    const j = {
      n: 2, proofs: new Array(2), filled: 0,
      combine: ([a, b]) => mkApps(Const('Or.elim'), [p, q, slot.target, Var(h.name), Lam(n1, p, a), Lam(n2, q, b)]),
      k: (t) => closeSlot(slot, t),
    };
    return [
      makeSlot([...rest, { name: n1, type: p }], slot.target, 'inl', j, 0),
      makeSlot([...rest, { name: n2, type: q }], slot.target, 'inr', j, 1),
    ];
  }
  if (headName === 'Exists' && args.length === 2) {
    const [ty, pred] = args;
    const n1 = names[0] ?? `${h.name}_w`;
    const n2 = names[1] ?? `${h.name}_h`;
    assertFresh(slot, n1, step.line); assertFresh(slot, n2, step.line);
    const s = makeSlot([...rest, { name: n1, type: ty }, { name: n2, type: App(pred, Var(n1)) }], slot.target, slot.tag, slot.join, slot.index);
    // wrap: Exists.elim α pred G h (fun w h => prf)
    s.wrap = (prf) => slot.wrap(mkApps(Const('Exists.elim'), [ty, pred, slot.target, Var(h.name), Lam(n1, ty, Lam(n2, App(pred, Var(n1)), prf))]));
    return [s];
  }
  if (headName === 'False' && !args.length) {
    closeSlot(slot, mkApps(Const('False.elim'), [slot.target, Var(h.name)]));
    return [];
  }
  if (headName === 'Eq' && args.length === 3) {
    // substitute lhs -> rhs in goal (keep h, like rw)
    const [ty, lhs, rhs] = args;
    const m = fresh('m');
    const [nt, changed] = abstractOccurrences(slot.target, lhs, m, ctx, env);
    if (!changed) throw terr(`cases: '${h.name}' does not occur in the goal`, step.line);
    const motive = Lam(m, ty, nt);
    slot.target = subst(nt, m, rhs);
    wrapSlot(slot, (prf) => mkApps(Const('Eq.subst'), [ty, motive, rhs, lhs, mkApps(Const('Eq.symm'), [ty, lhs, rhs, Var(h.name)]), prf]));
    return [slot];
  }
  if (headName === 'Nat' && !args.length) {
    return casesNat(env, slot, step, h, rest, names, false, null);
  }
  throw terr(`cases: cannot destruct ${pretty(h.type)}`, step.line);
}

function casesNat(env, slot, step, h, rest, names, withIh, _unused) {
  const ctx = slotCtx(slot);
  // motive: fun m : Nat => goal[n := m]
  for (const x of rest) {
    if ([...freeVars(x.type)].includes(h.name)) {
      throw terr(`cannot cases/induction on '${h.name}': hypothesis '${x.name}' depends on it`, step.line);
    }
  }
  const m = fresh('m');
  const motBody = subst(slot.target, h.name, Var(m));
  const motive = Lam(m, Const('Nat'), motBody);
  const kName = names[0] ?? `${h.name}_pred`;
  assertFresh(slot, kName, step.line);
  const baseT = subst(slot.target, h.name, { t: 'Const', name: 'Nat.zero' });
  const stepT = subst(slot.target, h.name, App(Const('Nat.succ'), Var(kName)));
  if (!withIh) {
    const j = {
      n: 2, proofs: new Array(2), filled: 0,
      combine: ([b, s]) => mkApps(Const('Nat.rec'), [motive, b, Lam(kName, Const('Nat'), Lam('_', subst(motBody, m, Var(kName)), s)), Var(h.name)]),
      k: (t) => closeSlot(slot, t),
    };
    return [
      makeSlot(rest, baseT, 'zero', j, 0),
      makeSlot([...rest, { name: kName, type: Const('Nat') }], stepT, 'succ', j, 1),
    ];
  }
  const ihName = names[1] ?? 'ih';
  assertFresh(slot, ihName, step.line);
  const ihT = subst(motBody, m, Var(kName));
  const j = {
    n: 2, proofs: new Array(2), filled: 0,
    combine: ([b, s]) => mkApps(Const('Nat.rec'), [motive, b, Lam(kName, Const('Nat'), Lam(ihName, ihT, s)), Var(h.name)]),
    k: (t) => closeSlot(slot, t),
  };
  return [
    makeSlot(rest, baseT, 'zero', j, 0),
    makeSlot([...rest, { name: kName, type: Const('Nat') }, { name: ihName, type: ihT }], stepT, 'succ', j, 1),
  ];
}
// -- induction -----------------------------------------------------------------
function doInduction(env, slot, step) {
  const ctx = slotCtx(slot);
  const h = findHyp(slot, step.h, step.line);
  const T = whnf(ctx, env, h.type);
  const [head, args] = spineOf(T);
  if (!(head.t === 'Const' && head.name === 'Nat' && !args.length)) {
    throw terr(`induction: '${h.name}' is not a Nat variable`, step.line);
  }
  const rest = slot.hyps.filter((x) => x.name !== h.name);
  return casesNat(env, slot, step, h, rest, step.withNames, true, null);
}

// -- apply ----------------------------------------------------------------------
function doApply(env, slot, step, opts) {
  void opts;
  const ctx = slotCtx(slot);
  let fn;
  try {
    fn = elab(env, ctx, step.e);
  } catch (err) {
    throw terr(`cannot elaborate (${err.message})`, step.line);
  }
  let fnT;
  try {
    fnT = inferHoles(env, ctx, fn, step.line).type;
  } catch (err) {
    throw terr(`${err.message}`, step.line);
  }
  // instantiate leading Pis with fresh holes
  const holes = []; // {holeName, dom}
  let cur = whnf(ctx, env, applyAssign(fnT, new Map()));
  let guard = 0;
  const argsSoFar = [];
  while (cur.t === 'Pi') {
    if (++guard > 200) throw terr('apply: too many binders', step.line);
    const hn = fresh('arg');
    holes.push({ hole: hn, dom: cur.dom });
    argsSoFar.push(Hole(hn));
    cur = whnf(ctx, env, subst(cur.body, cur.name, Hole(hn)));
  }
  const concl = cur;
  let assign;
  try {
    assign = unifyHoles(env, ctx, concl, slot.target, step.line);
  } catch {
    throw terr(`apply failed: conclusion ${pretty(concl)} does not match goal ${pretty(slot.target)}`, step.line);
  }
  // Build final args: solved holes become terms, unsolved become subgoals
  // (only proof obligations: concrete Props; undetermined data/type
  // parameters are an error with guidance, since independent subgoals
  // cannot propagate their solutions like Lean's metavariables).
  const finalArgs = [];
  const newSlots = [];
  const fullAssign = new Map(assign);
  for (let i = 0; i < holes.length; i++) {
    const dom = applyAssign(holes[i].dom, fullAssign);
    if (fullAssign.has(holes[i].hole)) {
      finalArgs.push(applyAssign(Hole(holes[i].hole), fullAssign));
    } else if (containsHole(dom)) {
      throw terr(`apply: cannot determine argument #${i + 1} (it depends on other undetermined arguments; give explicit arguments or use 'exact')`, step.line);
    } else {
      const dw = whnf(ctx, env, dom);
      if (dw.t === 'Prop') {
        // a proposition hole: legitimate subgoal (e.g. And.intro's sides)
        finalArgs.push({ subgoal: newSlots.length });
        newSlots.push({ dom, i });
        continue;
      }
      let isType = false;
      try {
        const ds = whnf(ctx, env, infer(ctx, env, dom));
        isType = ds.t === 'Sort';
      } catch { isType = false; }
      if (isType) {
        throw terr(`apply: cannot determine argument #${i + 1} of type ${pretty(dom)} (give it explicitly, e.g. 'apply ${showExpr(step.e)} …' with more arguments, or use 'exact')`, step.line);
      }
      // concrete proposition: subgoal
      finalArgs.push({ subgoal: newSlots.length });
      newSlots.push({ dom, i });
    }
  }
  // Assemble with a join over subgoals.
  const j = {
    n: newSlots.length, proofs: new Array(newSlots.length), filled: 0,
    combine: (ps) => {
      const a = [];
      let k = 0;
      for (const f of finalArgs) {
        if (f && f.subgoal !== undefined) a.push(ps[k++]);
        else a.push(applyAssign(f, fullAssign));
      }
      return mkApps(applyAssign(fn, fullAssign), a);
    },
    k: (t) => closeSlot(slot, t),
  };
  if (!newSlots.length) {
    const proof = mkApps(applyAssign(fn, fullAssign), finalArgs.map((f) => applyAssign(f, fullAssign)));
    try {
      check(ctx, env, proof, slot.target);
    } catch (err) {
      throw terr(`apply: ${err.message}`, step.line);
    }
    closeSlot(slot, proof);
    return [];
  }
  return newSlots.map((s, k) => makeSlot(slot.hyps, applyAssign(s.dom, fullAssign), `arg${k + 1}`, j, k));
}

// -- rw --------------------------------------------------------------------------
function ruleToEq(env, slot, rule, line) {
  const ctx = slotCtx(slot);
  let tm;
  try {
    tm = elab(env, ctx, rule.e);
  } catch (err) {
    throw terr(`rw: cannot elaborate '${showExpr(rule.e)}' (${err.message})`, line);
  }
  let T;
  try {
    T = infer(ctx, env, tm);
  } catch (err) {
    throw terr(`rw: cannot infer type of '${showExpr(rule.e)}' (${err.message})`, line);
  }
  // instantiate leading ∀s with holes
  let cur = whnf(ctx, env, T);
  const args = [];
  while (cur.t === 'Pi') {
    const hn = fresh('rw');
    args.push(Hole(hn));
    cur = whnf(ctx, env, subst(cur.body, cur.name, Hole(hn)));
  }
  const eq = getEqParts(ctx, env, cur);
  if (!eq) throw terr(`rw: '${showExpr(rule.e)}' is not an equality (got ${pretty(cur)})`, line);
  return { tm, args, eq };
}

function matchPattern(env, ctx, pat, target, assign) {
  // first-order match of pat (may contain Holes) against target. Returns true/false.
  pat = applyAssign(pat, assign);
  target = applyAssign(target, assign);
  if (pat.t === 'Hole' && !pat.name.startsWith('sorry')) {
    if (assign.has(pat.name)) {
      return safeDefeq(ctx, env, assign.get(pat.name), target);
    }
    // occurs check (light): target must not mention hole
    assign.set(pat.name, target);
    return true;
  }
  // numeric equivalence
  const pv = pat.t === 'NatLit' ? pat.value : toNatValue(pat);
  const tv = target.t === 'NatLit' ? target.value : toNatValue(target);
  if (pv !== null && tv !== null) return pv === tv;
  if (pat.t !== target.t) return false;
  switch (pat.t) {
    case 'Const': return pat.name === target.name;
    case 'Var': return pat.name === target.name;
    case 'Sort': return pat.level === target.level;
    case 'Prop': return true;
    case 'NatLit': return pat.value === target.value;
    case 'App': return matchPattern(env, ctx, pat.fn, target.fn, assign) && matchPattern(env, ctx, pat.arg, target.arg, assign);
    case 'Lam':
    case 'Pi': {
      const d1 = pat.t === 'Lam' ? pat.ty : pat.dom;
      const d2 = target.t === 'Lam' ? target.ty : target.dom;
      if (d1 && d2 && !matchPattern(env, ctx, d1, d2, assign)) return false;
      if ((d1 && !d2) || (!d1 && d2)) return false;
      const f = fresh('m');
      return matchPattern(env, ctx, subst(pat.body, pat.name, Var(f)), subst(target.body, target.name, Var(f)), assign);
    }
    default: return structEq(pat, target);
  }
}

function findFirstMatch(env, ctx, pat, tm, assign) {
  // returns {found, assign} — tries tm then children (pre-order).
  const a1 = new Map(assign);
  if (matchPattern(env, ctx, pat, tm, a1)) return { found: tm, assign: a1 };
  if (tm.t === 'App') {
    // do not descend into fn position of Eq head? descend everywhere is fine.
    const l = findFirstMatch(env, ctx, pat, tm.fn, assign);
    if (l.found) return l;
    return findFirstMatch(env, ctx, pat, tm.arg, assign);
  }
  if (tm.t === 'Lam' || tm.t === 'Pi') {
    const d = tm.t === 'Lam' ? tm.ty : tm.dom;
    if (d) {
      const l = findFirstMatch(env, ctx, pat, d, assign);
      if (l.found) return l;
    }
    const f = fresh('m');
    const nb = new Map(ctx); nb.set(f, { type: d ?? Hole(fresh('d')) });
    return findFirstMatch(env, nb, subst(pat, '_KEEP', Var('_KEEP')), subst(tm.body, tm.name, Var(f)), assign);
  }
  return { found: null, assign };
}

function abstractOccurrences(tm, lhsInst, freshName, ctx, env) {
  // Replace all subterms equal (up to NatLit/succ-chain equivalence) to
  // lhsInst with Var(freshName).
  let changed = false;
  function go(t) {
    if (tmEq(t, lhsInst)) { changed = true; return Var(freshName); }
    switch (t.t) {
      case 'App': return App(go(t.fn), go(t.arg));
      case 'Lam': return Lam(t.name, t.ty ? go(t.ty) : t.ty, go(t.body));
      case 'Pi': return Pi(t.name, go(t.dom), go(t.body));
      default: return t;
    }
  }
  void env; void ctx;
  const out = go(tm);
  return [out, changed];
}
// Recursive equality modulo NatLit <-> Nat.zero/succ-chain equivalence.
function tmEq(a, b) {
  const na = toNatValue(a), nb = toNatValue(b);
  if (na !== null && nb !== null) return na === nb;
  if ((na !== null) !== (nb !== null)) return false;
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 'Const': return a.name === b.name;
    case 'Var': return a.name === b.name;
    case 'Sort': return a.level === b.level;
    case 'Prop': return true;
    case 'NatLit': return a.value === b.value;
    case 'Hole': return a.name === b.name;
    case 'App': return tmEq(a.fn, b.fn) && tmEq(a.arg, b.arg);
    case 'Lam': return (a.ty ? (b.ty && tmEq(a.ty, b.ty)) : !b.ty) && tmEq(a.body, b.body);
    case 'Pi': return tmEq(a.dom, b.dom) && tmEq(a.body, b.body);
    default: return structEq(a, b);
  }
}
function synEqModuloNat(a, b) {
  return tmEq(a, b);
}

function doRewriteOnce(env, slot, ruleTm, ruleArgs, eq, rev, line) {
  const ctx = slotCtx(slot);
  const lhs = rev ? eq.rhs : eq.lhs;
  const rhs = rev ? eq.lhs : eq.rhs;
  // find instantiation by matching lhs against goal
  let found = findFirstMatch(env, ctx, lhs, slot.target, new Map());
  if (!found.found) {
    // fallback: unfold user definitions (but not Nat.add/Nat.mul/Nat.rec,
    // whose unfolding would destroy matchability) and retry. Sound because
    // unfolding is definitional (like `show`).
    const normed = normDeep(ctx, env, slot.target, 0);
    if (!structEq(normed, slot.target)) {
      slot.target = normed;
      found = findFirstMatch(env, slotCtx(slot), lhs, slot.target, new Map());
    }
  }
  if (!found.found) {
    throw terr(`rw failed: pattern ${pretty(applyAssign(lhs, found.assign))} not found in goal ${pretty(slot.target)}`, line);
  }
  const assign = found.assign;
  const lhsI = applyAssign(lhs, assign);
  const rhsI = applyAssign(rhs, assign);
  const argsI = ruleArgs.map((a) => applyAssign(a, assign));
  // all holes in the rule must be solved by the match
  const combined = [...collectHoles(lhsI), ...collectHoles(rhsI), ...argsI.flatMap(collectHoles)];
  if (combined.length) throw terr(`rw: could not determine all arguments of the rule`, line);
  const hProof = mkApps(ruleTm, argsI);
  // sanity: rule really proves lhsI = rhsI (or reversed)
  const m = fresh('m');
  const [abstracted, changed] = abstractOccurrences(slot.target, lhsI, m, ctx, env);
  if (!changed) throw terr('rw failed: pattern not found in goal', line);
  const motive = Lam(m, eq.ty, abstracted);
  const newTarget = subst(abstracted, m, rhsI);
  // builder: newProof : newTarget  ==>  oldTarget
  // L-to-R (lhs->rhs in goal): motive lhs = old, motive rhs = new.
  //   proof = Eq.subst motive rhs lhs (Eq.symm h) new : motive lhs (old)
  // R-to-L: motive rhs = old, motive lhs = new.
  //   proof = Eq.subst motive rhs lhs h new : motive rhs (old)
  // In the (possibly swapped) lhs/rhs naming, the sides are always
  // [rhsI, lhsI] and only the justifying equation differs.
  const hNeed = rev ? hProof : mkApps(Const('Eq.symm'), [eq.ty, lhsI, rhsI, hProof]);
  wrapSlot(slot, (newProof) => mkApps(Const('Eq.subst'), [eq.ty, motive, rhsI, lhsI, hNeed, newProof]));
  slot.target = newTarget;
}

// Deep one-pass normalization: beta-reduce and unfold user definitions
// (defs/abbrevs), but never Nat.add/Nat.mul/Nat.rec (their unfolding would
// destroy rewrite matchability) nor constructors/axioms. Used as a fallback
// when syntactic rewrite matching fails.
const NO_UNFOLD = new Set(['Nat.add', 'Nat.mul', 'Nat.rec']);
function normDeep(ctx, env, tm, depth) {
  if (depth > 60) return tm;
  const args = [];
  let head = tm;
  while (head.t === 'App') { args.push(head.arg); head = head.fn; }
  args.reverse();
  if (head.t === 'Lam' && args.length) {
    let body = subst(head.body, head.name, args[0]);
    for (let i = 1; i < args.length; i++) body = App(body, args[i]);
    return normDeep(ctx, env, body, depth + 1);
  }
  if (head.t === 'Const' && !NO_UNFOLD.has(head.name)) {
    const ent = env.map.get(head.name);
    if (ent && ent.value !== undefined) {
      let cur = ent.value;
      let i = 0;
      while (cur.t === 'Lam' && i < args.length) {
        cur = subst(cur.body, cur.name, args[i]);
        i++;
      }
      for (; i < args.length; i++) cur = App(cur, args[i]);
      return normDeep(ctx, env, cur, depth + 1);
    }
  }
  const na = args.map((a) => normDeep(ctx, env, a, depth + 1));
  if (head.t === 'Lam' || head.t === 'Pi') {
    // normalize under the binder with a fresh name, then restore the name
    const f = fresh(head.name);
    const isLam = head.t === 'Lam';
    const ann = isLam ? head.ty : head.dom;
    const annN = ann ? normDeep(ctx, env, ann, depth + 1) : ann;
    const nb = new Map(ctx); nb.set(f, { type: annN ?? Hole(fresh('d')) });
    const bdN = normDeep(nb, env, subst(head.body, head.name, Var(f)), depth + 1);
    const back = subst(bdN, f, Var(head.name));
    head = isLam ? Lam(head.name, annN, back) : Pi(head.name, annN, back);
  }
  let out = head;
  for (const a of na) out = App(out, a);
  return out;
}

function collectHoles(tm) {
  const out = [];
  (function g(t) {
    if (!t) return;
    if (t.t === 'Hole' && !t.name.startsWith('sorry')) { out.push(t.name); return; }
    if (t.t === 'App') { g(t.fn); g(t.arg); }
    else if (t.t === 'Lam') { if (t.ty) g(t.ty); g(t.body); }
    else if (t.t === 'Pi') { g(t.dom); g(t.body); }
  })(tm);
  return [...new Set(out)];
}

function doRewriteSeq(env, slot, step, _opts) {
  for (const rule of step.rules) {
    const { tm, args, eq } = ruleToEq(env, slot, rule, step.line);
    doRewriteOnce(env, slot, tm, args, eq, rule.rev, step.line);
  }
  // Lean's rw tries rfl afterwards.
  try { doRfl(env, slot, step); } catch { /* keep goal */ }
  return slot.closed ? [] : [slot];
}

// -- simp -----------------------------------------------------------------------
function doSimp(env, slot, step, opts) {
  const ctx = slotCtx(slot);
  // gather rewrite rules: default simp set (unless only) + user rules + hyps (simp_all)
  const rules = [];
  const pushRule = (tm, args, eq, rev, label) => rules.push({ tm, args, eq, rev, label });
  // user rules first (they are usually the progress-makers like ih)
  for (const r of (step.rules ?? [])) {
    const q = ruleToEq(env, slot, r, step.line);
    pushRule(q.tm, q.args, q.eq, r.rev, showExpr(r.e));
  }
  if (!step.only) {
    for (const nm of SIMP_LEMMAS) {
      const ent = env.map.get(nm);
      if (!ent) continue;
      let cur = whnf(ctx, env, ent.type);
      const args = [];
      while (cur.t === 'Pi') {
        const hn = fresh('s');
        args.push(Hole(hn));
        cur = whnf(ctx, env, subst(cur.body, cur.name, Hole(hn)));
      }
      const eq = getEqParts(ctx, env, cur);
      if (eq) pushRule(Const(nm), args, eq, false, nm);
    }
  }
  if (step.useHyps) {
    for (const h of slot.hyps) {
      const eq = getEqParts(ctx, env, h.type);
      if (eq) pushRule(Var(h.name), [], eq, false, h.name);
    }
  }
  // fixpoint loop (user rules first, loop detection via visited goals)
  const seen = new Set([pretty(slot.target)]);
  for (let iter = 0; iter < 24; iter++) {
    // close True / rfl goals immediately
    const w0 = whnf(ctx, env, slot.target);
    if (w0.t === 'Const' && w0.name === 'True') {
      closeSlot(slot, Const('True.intro'));
      return [];
    }
    try { doRfl(env, slot, step); return []; } catch { /* not an rfl-goal */ }
    if (slot.closed) return [];
    let progressed = false;
    for (const r of rules) {
      try {
        const before = pretty(slot.target);
        doRewriteOnce(env, slot, r.tm, r.args, r.eq, r.rev, step.line);
        const after = pretty(slot.target);
        if (after !== before) {
          if (seen.has(after)) {
            // loop detected (e.g. two rules undoing each other): stop rewriting
            progressed = false;
            break;
          }
          seen.add(after);
          progressed = true;
          break;
        }
      } catch { /* rule not applicable */ }
    }
    if (!progressed) break;
  }
  // try closers
  if (!slot.closed) { try { doRfl(env, slot, step); } catch {} }
  if (slot.closed) return [];
  const w = whnf(slotCtx(slot), env, slot.target);
  if (w.t === 'Const' && w.name === 'True') {
    closeSlot(slot, Const('True.intro'));
    return [];
  }
  try { doAssumption(env, slot, step); return []; } catch {}
  // contradiction?
  for (const h of slot.hyps) {
    const t = whnf(slotCtx(slot), env, h.type);
    if (t.t === 'Const' && t.name === 'False') {
      closeSlot(slot, mkApps(Const('False.elim'), [slot.target, Var(h.name)]));
      return [];
    }
  }
  return [slot];
}

// -- have / show / sorry ----------------------------------------------------------
function doHave(env, slot, step, opts) {
  assertFresh(slot, step.name, step.line);
  const ctx = slotCtx(slot);
  let ty, proof;
  if (step.byTacs) {
    if (!step.ty) throw terr('have ... := by ... needs a type ascription', step.line);
    try {
      ty = elabType(env, ctx, step.ty);
    } catch (err) {
      throw terr(`cannot elaborate type (${err.message})`, step.line);
    }
    // subproof in current context
    const sub = runBlock(env, slot.hyps.map((h) => ({ ...h })), ty,
      step.byTacs.map((t) => ({ bullet: false, steps: [t], line: step.line })), opts);
    proof = sub.proof;
  } else {
    let tm;
    try {
      tm = elab(env, ctx, step.e, step.ty ? elabType(env, ctx, step.ty) : null);
    } catch (err) {
      throw terr(`cannot elaborate (${err.message})`, step.line);
    }
    if (step.ty) {
      try {
        ty = elabType(env, ctx, step.ty);
      } catch (err) {
        throw terr(`cannot elaborate type (${err.message})`, step.line);
      }
      const solved = solveHolesToTarget(env, ctx, tm, ty, step.line);
      try {
        check(ctx, env, solved, ty);
      } catch (err) {
        throw terr(`${err.message}`, step.line);
      }
      proof = solved;
    } else {
      // infer type; holes not allowed without ascription
      try {
        ty = infer(ctx, env, tm);
      } catch (err) {
        throw terr(`cannot infer type (${err.message}); add ': T'`, step.line);
      }
      if (collectHoles(tm).length || containsHole(tm)) throw terr('have needs a type ascription with `_`', step.line);
      proof = tm;
    }
  }
  slot.hyps.push({ name: step.name, type: ty });
  const nm = step.name, T = ty, P = proof;
  wrapSlot(slot, (prf) => ({ t: 'Let', name: nm, ty: T, val: P, body: prf }));
}

function doShow(env, slot, step) {
  const ctx = slotCtx(slot);
  let ty;
  try {
    ty = elabType(env, ctx, step.e);
  } catch (err) {
    throw terr(`cannot elaborate (${err.message})`, step.line);
  }
  if (!safeDefeq(ctx, env, ty, slot.target)) {
    throw terr(`show failed: ${pretty(ty)} is not definitionally equal to ${pretty(slot.target)}`, step.line);
  }
  slot.target = ty;
}

function doSorry(env, slot, step, opts) {
  if (opts.warnings) opts.warnings.push(`line ${step.line}: 'sorry' used (admits ${pretty(slot.target)})`);
  closeSlot(slot, App(Const('sorryAx'), slot.target));
}


