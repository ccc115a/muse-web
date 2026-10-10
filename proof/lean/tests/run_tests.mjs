// Detailed test suite for the Mini-Lean proof system (Node.js, no dependencies).
// Run:  node tests/run_tests.mjs   (or: npm test)
// Every proof produced by tactics is re-checked by the kernel inside runBlock,
// and the soundness section additionally verifies that wrong proofs are rejected.

import {
  Sort, PropT, Const, Var, App, Lam, Pi, Let, Ann, NatLit, Hole,
  mkApps, subst, freeVars, whnf, infer, check, defeq, structEq,
  toNatValue, pretty, Env, KernelError,
} from '../src/kernel.mjs';
import { buildPrelude } from '../src/prelude.mjs';
import { lex, parseFile, parseExprString, showExpr, ParseError } from '../src/parser.mjs';
import { elab, elabType, unifyHoles, applyAssign, ElabError } from '../src/elab.mjs';
import { runBlock, TacticError } from '../src/tactics.mjs';
import { checkSource, freshEnv } from '../src/lean.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let passed = 0, failed = 0;
const failures = [];
let section = '';
function describe(name) { section = name; console.log(`\n## ${name}`); }
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push(`${section} :: ${name} :: ${err.message}`);
    console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').join('\n       ')}`);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? 'mismatch'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}
function throws(fn, part) {
  try {
    fn();
  } catch (err) {
    if (part && !String(err.message).includes(part)) {
      throw new Error(`wrong error message: ${err.message} (expected to include ${JSON.stringify(part)})`);
    }
    return err;
  }
  throw new Error('expected an error but none was thrown');
}
function freshCtx(env) { return new Map(); }
function prove(src, filename = 'test') {
  const r = checkSource(src, { filename });
  if (!r.ok) throw new Error(`proof failed: ${r.errors.join(' | ')}`);
  return r;
}
function proveFails(src, part, filename = 'test') {
  const r = checkSource(src, { filename });
  if (r.ok) throw new Error('expected failure but proof passed');
  if (part && !r.errors.join('\n').includes(part)) {
    throw new Error(`wrong error: ${r.errors.join(' | ')} (expected ${JSON.stringify(part)})`);
  }
  return r;
}

// ===========================================================================
// A. Kernel
// ===========================================================================
describe('A. kernel: substitution & variables');
{
  const x = Var('x'), y = Var('y');
  test('subst basic', () => {
    const t = App(Lam('z', null, App(x, Var('z'))), y);
    eq(pretty(subst(t, 'x', Var('w'))), pretty(App(Lam('z', null, App(Var('w'), Var('z'))), y)));
  });
  test('subst capture-avoiding (Pi binder renamed)', () => {
    // [a := b](∀ b : Nat, a = b) must NOT capture: binder renamed, `a = b` kept distinct
    const NatT = Const('Nat');
    const body = mkApps(Const('Eq'), [NatT, Var('a'), Var('b')]);
    const t = Pi('b', NatT, body);
    const r = subst(t, 'a', Var('b'));
    // binder must have been renamed away from 'b'
    ok(r.name !== 'b', `binder not renamed: ${pretty(r)}`);
    // substituting back: body still mentions two distinct vars
    const fvs = freeVars(r);
    ok(fvs.has('b'), `free b lost: ${pretty(r)}`);
  });
  test('subst capture regression: Eq.subst-style Pi chain', () => {
    // the exact shape that broke rw_demo: [a := Var b] over (∀ b, Eq a b → …)
    const NatT = Const('Nat');
    const rest = Pi('_', mkApps(Const('Eq'), [NatT, Var('a'), Var('b')]), Var('t'));
    const t = Pi('b', NatT, rest);
    const r = subst(t, 'a', Var('b'));
    ok(r.name !== 'b', 'outer binder captured');
    // the Eq inside must keep two distinct sides (b vs renamed)
    const eqNode = r.body.dom;
    const args = [];
    let c = eqNode;
    while (c.t === 'App') { args.push(c.arg); c = c.fn; }
    eq(c.name, 'Eq');
    // args[0] = rhs, args[1] = lhs (spine order)
    ok(args[0].name !== args[1].name, `sides collapsed: ${pretty(eqNode)}`);
  });
  test('freeVars traverses Pi domains', () => {
    const t = Pi('b', Var('d'), Var('a'));
    const f = freeVars(t);
    ok(f.has('d') && f.has('a') && !f.has('b'), `got ${[...f]}`);
  });
  test('freeVars traverses Lam annotations', () => {
    const t = Lam('x', Var('T'), Var('x'));
    ok(freeVars(t).has('T'), 'annotation var missing');
  });
  test('structEq is alpha-insensitive', () => {
    ok(structEq(Lam('x', null, Var('x')), Lam('y', null, Var('y'))), 'alpha-eq failed');
    ok(!structEq(Var('x'), Var('y')), 'distinct vars equal?');
  });
}

describe('B. kernel: whnf reduction');
{
  const env = buildPrelude();
  const ctx = freshCtx();
  test('beta reduction', () => {
    const t = App(Lam('x', Const('Nat'), Var('x')), NatLit(7));
    eq(pretty(whnf(ctx, env, t)), '7');
  });
  test('delta unfolds Nat.add on literals: 2+3=5', () => {
    const t = mkApps(Const('Nat.add'), [NatLit(2), NatLit(3)]);
    const w = whnf(ctx, env, t);
    eq(w.t, 'NatLit');
    eq(w.value, 5);
  });
  test('mul on literals: 2*3=6', () => {
    const t = mkApps(Const('Nat.mul'), [NatLit(2), NatLit(3)]);
    eq(whnf(ctx, env, t).value, 6);
  });
  test('Nat.rec on zero picks base', () => {
    const mot = Lam('_', Const('Nat'), Const('Nat'));
    const t = mkApps(Const('Nat.rec'), [mot, NatLit(9), Lam('n', Const('Nat'), Lam('ih', Const('Nat'), Var('ih'))), NatLit(0)]);
    eq(whnf(ctx, env, t).value, 9);
  });
  test('Nat.rec on succ applies step (up to defeq)', () => {
    const mot = Lam('_', Const('Nat'), Const('Nat'));
    const step = Lam('n', Const('Nat'), Lam('ih', Const('Nat'), mkApps(Const('Nat.succ'), [Var('ih')])));
    const t = mkApps(Const('Nat.rec'), [mot, NatLit(0), step, NatLit(2)]);
    // whnf is weak-head only (does not reduce under succ); defeq sees through
    ok(defeq(ctx, env, t, NatLit(2)), 'rec computation');
  });
  test('toNatValue of succ chain', () => {
    const t = App(Const('Nat.succ'), App(Const('Nat.succ'), Const('Nat.zero')));
    eq(toNatValue(t), 2);
    eq(toNatValue(Var('n')), null);
  });
  test('open terms stay stuck (no infinite unfold)', () => {
    // `0 + n` cannot reduce (neutral scrutinee); `n + 0` DOES reduce via literal iota
    const ctx2 = new Map([['n', { type: Const('Nat') }]]);
    const t = mkApps(Const('Nat.add'), [NatLit(0), Var('n')]);
    const w = whnf(ctx2, env, t);
    ok(w.t === 'App', `unexpectedly reduced: ${pretty(w)}`);
  });
}

describe('C. kernel: defeq');
{
  const env = buildPrelude();
  const ctx = new Map([['n', { type: Const('Nat') }]]);
  test('beta-eta equality', () => {
    const f = Lam('x', Const('Nat'), App(Var('f0'), Var('x')));
    ok(defeq(new Map([['f0', { type: Const('Nat') }]]), env, f, Var('f0')), 'eta failed');
  });
  test('NatLit 2 = succ (succ zero)', () => {
    const chain = App(Const('Nat.succ'), App(Const('Nat.succ'), Const('Nat.zero')));
    ok(defeq(ctx, env, NatLit(2), chain), 'literal vs chain');
    ok(!defeq(ctx, env, NatLit(2), NatLit(3)), '2 = 3?!');
  });
  test('Prop is definitionally Type 0', () => {
    ok(defeq(ctx, env, PropT(), Sort(0)), 'Prop = Type 0');
    ok(!defeq(ctx, env, PropT(), Sort(1)), 'Prop = Type 1?!');
  });
  test('2 + 3 is definitionally 5', () => {
    const t = mkApps(Const('Nat.add'), [NatLit(2), NatLit(3)]);
    ok(defeq(ctx, env, t, NatLit(5)), 'add compute');
  });
  test('n + 0 IS definitionally n (literal iota fires)', () => {
    const t = mkApps(Const('Nat.add'), [Var('n'), NatLit(0)]);
    ok(defeq(ctx, env, t, Var('n')), 'n + 0 should reduce');
  });
  test('0 + n is NOT definitionally n (needs induction)', () => {
    const t = mkApps(Const('Nat.add'), [NatLit(0), Var('n')]);
    ok(!defeq(ctx, env, t, Var('n')), 'should need proof');
  });
  test('(n + 0) + 0 IS definitionally n (literal iota)', () => {
    const inner = mkApps(Const('Nat.add'), [Var('n'), NatLit(0)]);
    const t = mkApps(Const('Nat.add'), [inner, NatLit(0)]);
    ok(defeq(ctx, env, t, Var('n')), 'nested literal iota');
  });
}

describe('D. kernel: infer & check');
{
  const env = buildPrelude();
  test('identity infers Pi type', () => {
    const id = Lam('x', Const('Nat'), Var('x'));
    const t = infer(new Map(), env, id);
    eq(pretty(t), pretty(Pi('x', Const('Nat'), Const('Nat'))));
  });
  test('Sort/Prop levels', () => {
    eq(infer(new Map(), env, Sort(0)).level, 1);
    eq(infer(new Map(), env, PropT()).level, 0);
  });
  test('reject application of non-function', () => {
    throws(() => infer(new Map(), env, App(NatLit(3), NatLit(4))), 'function');
  });
  test('reject unknown constant', () => {
    throws(() => infer(new Map(), env, Const('Nope')), 'unknown constant');
  });
  test('reject ill-typed Eq.refl (mismatched sides via Ann)', () => {
    const bad = Ann(mkApps(Const('Eq.refl'), [Const('Nat'), NatLit(1)]),
      mkApps(Const('Eq'), [Const('Nat'), NatLit(1), NatLit(2)]));
    throws(() => infer(new Map(), env, bad), null);
  });
  test('Let checks', () => {
    const t = Let('x', Const('Nat'), NatLit(3), Var('x'));
    eq(pretty(infer(new Map(), env, t)), 'Nat');
  });
  test('Pi formation: Nat -> Prop is a Type, Nat -> True is a Prop', () => {
    const t = Pi('_', Const('Nat'), PropT());
    eq(infer(new Map(), env, t).level, 0); // Type 0
    const t2 = Pi('_', Const('Nat'), Const('True'));
    eq(infer(new Map(), env, t2).t, 'Prop');
  });
}

// ===========================================================================
// E. Parser
// ===========================================================================
describe('E. parser: expressions');
{
  test('precedence: ∧ binds tighter than →', () => {
    const e = parseExprString('p ∧ q -> r');
    eq(e.k, 'binop'); eq(e.op, '->');
    eq(e.l.k, 'binop'); eq(e.l.op, '∧');
  });
  test('precedence: → is right associative', () => {
    const e = parseExprString('a -> b -> c');
    eq(e.op, '->');
    eq(showExpr(e.r), '(b -> c)');
  });
  test('+ binds tighter than =', () => {
    const e = parseExprString('a + b = c');
    eq(e.op, '=');
  });
  test('ascii alternatives /\\ \\/ -> <->', () => {
    eq(parseExprString('p /\\ q').op, '/\\');
    eq(parseExprString('p \\/ q').op, '\\/');
    eq(parseExprString('p <-> q').op, '<->');
  });
  test('fun with typed binders', () => {
    const e = parseExprString('fun (x : Nat) y => x');
    eq(e.k, 'fun');
    eq(e.binders.length, 2);
  });
  test('forall/exists binders with trailing type', () => {
    const f = parseExprString('∀ n : Nat, p n');
    eq(f.k, 'forall');
    ok(f.binders[0].ty, 'binder type missing');
    const x = parseExprString('∃ n : Nat, n = 0');
    eq(x.k, 'exists');
  });
  test('anonymous constructor', () => {
    const e = parseExprString('⟨a, b⟩');
    eq(e.k, 'anon');
    eq(e.items.length, 2);
  });
  test('comments are skipped', () => {
    const f = parseFile('-- hello\ntheorem t : True := by\n  trivial\n/- block -/\n');
    eq(f.decls.length, 1);
  });
  test('unknown tactic is a parse error', () => {
    throws(() => parseFile('theorem t : True := by\n  frobnicate\n'), 'unknown tactic');
  });
  test('#check / #eval commands parse', () => {
    const f = parseFile('#check Nat\n#eval 1 + 2\n');
    eq(f.commands.length, 2);
  });
  test('multi-line header with binders', () => {
    const f = parseFile('theorem t (p : Prop)\n  (h : p) : p := by\n  exact h\n');
    eq(f.decls[0].binders.length, 2);
  });
}

describe('F. elab');
{
  const env = buildPrelude();
  test('unknown identifier errors', () => {
    throws(() => elab(env, new Map(), parseExprString('zzz')), 'unknown identifier');
  });
  test('heterogeneous equality rejected', () => {
    const ctx = new Map([['a', { type: Const('Nat') }], ['p', { type: PropT() }]]);
    throws(() => elab(env, ctx, parseExprString('a = p')), 'same type');
  });
  test('arithmetic needs Nat', () => {
    const ctx = new Map([['p', { type: PropT() }]]);
    throws(() => elab(env, ctx, parseExprString('p + p')), 'Nat');
  });
  test('unifyHoles solves_ORDER-independent positions', () => {
    const h1 = Hole('a'), h2 = Hole('b');
    const a = unifyHoles(env, new Map(), mkApps(Const('And'), [h1, PropT()]), mkApps(Const('And'), [PropT(), PropT()]));
    eq(a.get('a').t, 'Prop');
  });
  test('unifyHoles occurs check', () => {
    throws(() => unifyHoles(env, new Map(), Hole('a'), App(Var('f'), Hole('a'))), 'occurs');
  });
  test('⟨⟩ without expected type errors helpfully', () => {
    throws(() => elab(env, new Map(), parseExprString('⟨a, b⟩')), 'expected type');
  });
}

// ===========================================================================
// G. Tactics (positive + negative)
// ===========================================================================
describe('G. tactics');
{
  test('intro on non-function fails', () => {
    proveFails('theorem t : True := by\n  intro x\n', 'not a function type');
  });
  test('exact with wrong type fails', () => {
    proveFails('theorem t (p q : Prop) (h : p) : q := by\n  exact h\n', 'mismatch');
  });
  test('assumption finds hypothesis', () => {
    prove('theorem t (p : Prop) (h : p) : p := by\n  assumption\n');
  });
  test('assumption fails with no match', () => {
    proveFails('theorem t (p q : Prop) (h : p) : q := by\n  assumption\n', 'assumption failed');
  });
  test('rfl on non-equality fails', () => {
    proveFails('theorem t : True := by\n  rfl\n', 'not an equality');
  });
  test('rfl rejects 0 = 1', () => {
    proveFails('theorem t : 0 = 1 := by\n  rfl\n', 'not definitionally equal');
  });
  test('constructor splits And; semicolon broadcasts', () => {
    prove('theorem t (p q : Prop) (a : p) (b : q) : p ∧ q := by\n  constructor; assumption\n');
  });
  test('left/right on non-Or fails', () => {
    proveFails('theorem t (p q : Prop) (h : p ∧ q) : p := by\n  left\n', 'disjunction');
  });
  test('cases on Nat splits zero/succ (broadcast ;) closes both', () => {
    prove('theorem t (n : Nat) : True := by\n  cases n with k; trivial\n');
  });
  test('cases function type fails', () => {
    proveFails('theorem t (f : Nat -> Nat) : True := by\n  cases f\n', 'cannot destruct');
  });
  test('induction on non-Nat fails', () => {
    proveFails('theorem t (p : Prop) (h : p) : p := by\n  induction h\n', 'not a Nat');
  });
  test('induction with dependent hypothesis fails helpfully', () => {
    proveFails('theorem t (n : Nat) (h : n = 0) : True := by\n  induction n\n', 'depends on it');
  });
  test('rw with missing pattern fails', () => {
    proveFails('theorem t (a b c d : Nat) (h : a = b) : c = d := by\n  rw [h]\n', 'not found in goal');
  });
  test('rw with non-equality fails', () => {
    proveFails('theorem t (p : Prop) (h : p) : p := by\n  rw [h]\n', 'not an equality');
  });
  test('reverse rw works', () => {
    prove('theorem t (a b : Nat) (h : a = b) : b = a := by\n  rw [<- h]\n');
  });
  test('apply with undetermined middle term errors helpfully', () => {
    proveFails('theorem t (a b c : Nat) (h1 : a = b) (h2 : b = c) : a = c := by\n  apply Eq.trans\n', 'cannot determine');
  });
  test('apply conclusion mismatch errors', () => {
    proveFails('theorem t (p q : Prop) (h : p) : q := by\n  apply And.intro\n', 'does not match');
  });
  test('have without proof type ascription still works via inference', () => {
    prove('theorem t (p : Prop) (h : p) : p := by\n  have h2 := h\n  exact h2\n');
  });
  test('have with by-block', () => {
    prove('theorem t (p q : Prop) (h : p ∧ q) : q := by\n  have h2 : p ∧ q := by exact h\n  cases h2 with a b\n  exact b\n');
  });
  test('show with non-defeq type fails', () => {
    proveFails('theorem t (p q : Prop) (h : p) : p := by\n  show q\n', 'definitionally equal');
  });
  test('sorry warns but passes', () => {
    const r = prove('theorem t : True := by\n  sorry\n');
    ok(r.hasSorry, 'hasSorry flag missing');
    ok(r.warnings.length === 1, 'sorry warning missing');
  });
  test('all_goals closes both branches', () => {
    prove('theorem t (p q : Prop) (h : p ∨ q) (a : p -> q ∨ p) (b : q -> q ∨ p) : q ∨ p := by\n  cases h with l r\n  all_goals sorry\n');
  });
  test('case selects tagged goal', () => {
    prove('theorem t (p q : Prop) (h : p ∨ q) : q ∨ p := by\n  cases h with l r\n  case inr => left\n  case inl => right\n  · exact l\n  · exact r\n');
  });
  test('simp terminates on potentially looping rules', () => {
    prove('theorem t (n : Nat) : n + 0 + 0 = n := by\n  simp\n', 'loop');
  });
  test('simp only uses given rules', () => {
    prove('theorem t (n : Nat) : n + 0 = n := by\n  simp only [Nat.add_zero]\n');
  });
  test('term-mode proof by lambda', () => {
    prove('theorem t (p : Prop) : p -> p := fun h => h\n');
  });
  test('term-mode proof must match ascription', () => {
    proveFails('theorem t (p q : Prop) (h : p) : q := h\n', null);
  });
  test('duplicate binder rejected', () => {
    proveFails('theorem t (p : Prop) (p : Prop) : True := by\n  trivial\n', 'duplicate');
  });
  test('shadowing intro rejected', () => {
    proveFails('theorem t (p : Prop) : p -> p := by\n  intro p\n  exact p\n', 'already used');
  });
  test('exact fun with expected type', () => {
    prove('theorem t (p : Prop) : p -> p := by\n  exact fun h => h\n');
  });
  test('exact anonymous And constructor', () => {
    prove('theorem t (p q : Prop) (a : p) (b : q) : p ∧ q := by\n  exact ⟨a, b⟩\n');
  });
  test('undetermined hole errors helpfully', () => {
    proveFails('theorem t (p : Prop) (hp : p) : p ∧ True := by\n  exact And.intro _ _ hp _\n', 'could not be determined');
  });
  test('empty by block fails', () => {
    proveFails('theorem t : True := by\n', null);
  });
  test('nameless example works', () => {
    prove('example : True := by\n  trivial\n');
  });
  test('have with anonymous constructor', () => {
    prove('theorem t (p q : Prop) (a : p) (b : q) : p ∧ q := by\n  have h : p ∧ q := ⟨a, b⟩\n  exact h\n');
  });
  test('rw unfolds user defs as fallback (no show needed)', () => {
    prove('def d2 (n : Nat) : Nat := n + n\ntheorem t (n : Nat) : d2 (Nat.succ n) = Nat.succ (Nat.succ (d2 n)) := by\n  rw [Nat.add_succ, Nat.succ_add]\n');
  });
  test('simp with no progress leaves goal (fails)', () => {
    proveFails('theorem t (n m : Nat) : n + m = m + n := by\n  simp\n', 'unsolved');
  });
  test('rw at h rejected clearly', () => {
    proveFails('theorem t (a b : Nat) (h : a = b) : a = b := by\n  rw [h] at h\n', 'at h');
  });
  test('nested have-by inline block', () => {
    prove('theorem t (p : Prop) (h : p) : p := by\n  have h2 : p := by exact h\n  exact h2\n');
  });
  test('show defeq change then rfl', () => {
    prove('theorem t (n : Nat) : n + 0 = n := by\n  show n + 0 = n\n  rfl\n');
  });
  test('def with inferred type + #check', () => {
    const r = prove('def myid (n : Nat) := n\n#check myid 3\n');
    ok(r.messages.length === 1 && r.messages[0].text.includes('Nat'), 'check message');
  });
  test('axiom then use', () => {
    prove('axiom myax : True\ntheorem t : True := by\n  exact myax\n');
  });
  test('unbalanced paren is a clean error', () => {
    proveFails('theorem t : True := by\n  exact (True.intro\n', null);
  });
  test('too many intros fail', () => {
    proveFails('theorem t (p : Prop) : p -> p := by\n  intro a b\n', null);
  });
  test('cases Or without with-names (auto names)', () => {
    prove('theorem t (p q : Prop) (h : p ∨ q) : q ∨ p := by\n  cases h\n  · right; assumption\n  · left; assumption\n');
  });
  test('case with ;-sequence on tagged goal', () => {
    prove('theorem t (n : Nat) : 0 + n = n := by\n  induction n\n  case zero => rfl\n  case succ => rw [Nat.add_succ, ih]\n');
  });
}

// ===========================================================================
// H. Soundness: false things must NOT prove
// ===========================================================================
describe('H. soundness (must all fail)');
{
  test('0 = 1 unprovable by rfl', () => {
    proveFails('theorem t : 0 = 1 := by rfl\n', null);
  });
  test('p -> q from p alone unprovable', () => {
    proveFails('theorem t (p q : Prop) (h : p) : q := by exact h\n', null);
  });
  test('swapped And components rejected', () => {
    proveFails('theorem t (p q : Prop) (h : p ∧ q) : q ∧ p := by\n  cases h with a b\n  constructor\n  · exact a\n  · exact b\n', null);
  });
  test('0 + n = n NOT by rfl (needs induction)', () => {
    proveFails('theorem t (n : Nat) : 0 + n = n := by rfl\n', null);
  });
  test('n + 0 = n IS by rfl (literal iota computes)', () => {
    prove('theorem t (n : Nat) : n + 0 = n := by rfl\n');
  });
  test('0 * n = 0 NOT by rfl', () => {
    proveFails('theorem t (n : Nat) : 0 * n = 0 := by rfl\n', null);
  });
  test('Exists with wrong witness rejected', () => {
    proveFails('theorem t : ∃ n : Nat, n = 1 := by\n  exact ⟨0, Eq.refl Nat 0⟩\n', null);
  });
  test('kernel rejects hand-built ill-typed term', () => {
    const env = buildPrelude();
    throws(() => check(new Map(), env, App(Const('Nat.zero'), Const('Nat.zero')), Const('Nat')), null);
  });
  test('incomplete proof (leftover goal) fails', () => {
    proveFails('theorem t (p q : Prop) (a : p) (b : q) : p ∧ q := by\n  constructor\n  · exact a\n', 'unsolved');
  });
  test('term-mode sorry warns and flags hasSorry', () => {
    const r = prove('theorem t : False := sorry\n');
    ok(r.hasSorry && r.warnings.length === 1, 'sorry tracking');
  });
  test('using unknown hypothesis fails', () => {
    proveFails('theorem t (p : Prop) : p := by\n  exact noSuchHyp\n', 'unknown');
  });
}

// ===========================================================================
// I. Examples directory (frontend must execute >= 5)
// ===========================================================================
describe('I. examples/ (all must pass, no sorry)');
{
  const dir = path.join(ROOT, 'examples');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.lean')).sort();
  test(`at least 5 examples (found ${files.length})`, () => {
    ok(files.length >= 5, `only ${files.length} examples`);
  });
  for (const f of files) {
    test(`example ${f} checks`, () => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const r = checkSource(src, { filename: f });
      if (!r.ok) throw new Error(r.errors.join(' | '));
      if (r.hasSorry) throw new Error('example contains sorry');
      ok(r.declResults.length > 0, 'no declarations?');
      // every declaration kernel-checked: re-verify each proof independently
      const env = r.env;
      for (const d of r.declResults) {
        const ent = env.map.get(d.name);
        if (ent?.proof) {
          check(new Map(), env, ent.proof, ent.type);
        }
      }
    });
  }
  test('examples are deterministic (run twice)', () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const a = checkSource(src, { filename: f });
      const b = checkSource(src, { filename: f });
      eq(a.ok, b.ok);
      eq(JSON.stringify(a.declResults.map((d) => d.name)), JSON.stringify(b.declResults.map((d) => d.name)));
    }
  });
  test('manifest.json matches directory', () => {
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    eq(JSON.stringify([...man.files].sort()), JSON.stringify(files));
  });
}

// ===========================================================================
// J. Frontend assets (pure frontend: no backend needed)
// ===========================================================================
describe('J. frontend assets');
{
  test('index.html loads app.js (kernel via app.js import, no backend)', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok(html.includes('app.js'), 'app.js not referenced');
    ok(!html.includes('fetch(\'/api'), 'must not call a backend API');
    ok(!html.includes('localhost:') && !html.includes('127.0.0.1'), 'must not hard-require a backend');
  });
  test('app.js exists and imports the kernel', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    ok(app.includes('lean.mjs'), 'app.js does not import kernel');
    ok(app.includes('manifest.json'), 'app.js does not load examples manifest');
  });
  test('package.json has test + serve scripts, no runtime deps', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    ok(pkg.scripts.test.includes('run_tests'), 'npm test missing');
    ok(pkg.scripts.serve, 'npm run serve missing');
    ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'must stay dependency-free');
  });
  test('src modules are dependency-free (browser-safe, no node: imports)', () => {
    for (const m of ['kernel.mjs', 'prelude.mjs', 'parser.mjs', 'elab.mjs', 'tactics.mjs']) {
      const src = fs.readFileSync(path.join(ROOT, 'src', m), 'utf8');
      ok(!src.includes("from 'node:"), `${m} imports node builtins`);
      ok(!src.includes('process.'), `${m} uses process`);
    }
  });
}

// ===========================================================================
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(' -', f);
}
process.exit(failed ? 1 : 0);
