// Prelude: built-in constants, definitions and trusted lemma axioms.
// All proof terms built by tactics are kernel-checked against this environment,
// so tactic soundness reduces to kernel soundness + truth of these axioms
// (all are standard: equality axioms, Nat computation rules, propext-style
// Prop equalities used only for rewriting).

import {
  Env, Sort, PropT, Const, Var, App, Lam, Pi, NatLit,
  mkApps, mkArrows, NATT, ZERO, SUCC,
} from './kernel.mjs';

const P = PropT();
const S0 = Sort(0);
const NatT = NATT();
const zero = ZERO();
const succOf = SUCC;
const arrow = (a, b) => Pi('_', a, b);
const forall2 = (n1, d1, n2, d2, b) => Pi(n1, d1, Pi(n2, d2, b));

export function buildPrelude() {
  const env = new Env();
  const add = (n, t, v, k) => env.add(n, t, v, k);

  // -- Universes / basic types ------------------------------------------------
  add('Nat', S0, undefined, 'inductive');
  add('Nat.zero', NatT, undefined, 'ctor');
  add('Nat.succ', arrow(NatT, NatT), undefined, 'ctor');

  // Nat.rec : {motive : Nat -> Type} -> motive zero -> ((n) -> motive n -> motive (succ n)) -> (n) -> motive n
  const motiveT = arrow(NatT, S0);
  const mv = Var('motive');
  const baseT = App(mv, zero);
  const stepT = Pi('n', NatT, Pi('_', App(mv, Var('n')), App(mv, succOf(Var('n')))));
  const recT = Pi('motive', motiveT, Pi('base', baseT, Pi('step', stepT, Pi('n', NatT, App(mv, Var('n'))))));
  add('Nat.rec', recT, undefined, 'recursor');

  // Nat.add x y := Nat.rec (fun _ => Nat) x (fun _ ih => succ ih) y
  const addVal =
    Lam('x', NatT, Lam('y', NatT,
      mkApps(Const('Nat.rec'), [
        Lam('_', NatT, NatT),
        Var('x'),
        Lam('n', NatT, Lam('ih', NatT, succOf(Var('ih')))),
        Var('y'),
      ])));
  add('Nat.add', arrow(NatT, arrow(NatT, NatT)), addVal, 'def');

  // Nat.mul x y := Nat.rec (fun _ => Nat) zero (fun _ ih => Nat.add ih x) y
  const mulVal =
    Lam('x', NatT, Lam('y', NatT,
      mkApps(Const('Nat.rec'), [
        Lam('_', NatT, NatT),
        zero,
        Lam('n', NatT, Lam('ih', NatT, mkApps(Const('Nat.add'), [Var('ih'), Var('x')]))),
        Var('y'),
      ])));
  add('Nat.mul', arrow(NatT, arrow(NatT, NatT)), mulVal, 'def');

  // -- Propositions ------------------------------------------------------------
  add('True', P, undefined, 'inductive');
  add('True.intro', Const('True'), undefined, 'ctor');
  add('False', P, undefined, 'inductive');
  add('False.elim', Pi('p', P, arrow(Const('False'), Var('p'))), undefined, 'eliminator');

  add('And', arrow(P, arrow(P, P)), undefined, 'inductive');
  const p = Var('p'), q = Var('q');
  add('And.intro',
    Pi('p', P, Pi('q', P, arrow(p, arrow(q, mkApps(Const('And'), [p, q]))))), undefined, 'ctor');
  add('And.left',
    Pi('p', P, Pi('q', P, arrow(mkApps(Const('And'), [p, q]), p))), undefined, 'eliminator');
  add('And.right',
    Pi('p', P, Pi('q', P, arrow(mkApps(Const('And'), [p, q]), q))), undefined, 'eliminator');

  add('Or', arrow(P, arrow(P, P)), undefined, 'inductive');
  add('Or.inl',
    Pi('p', P, Pi('q', P, arrow(p, mkApps(Const('Or'), [p, q])))), undefined, 'ctor');
  add('Or.inr',
    Pi('p', P, Pi('q', P, arrow(q, mkApps(Const('Or'), [p, q])))), undefined, 'ctor');
  const orElimInner = arrow(arrow(p, Var('r')), arrow(arrow(q, Var('r')), Var('r')));
  const orElimTy = Pi('p', P, Pi('q', P, Pi('r', P, arrow(mkApps(Const('Or'), [p, q]), orElimInner))));
  add('Or.elim', orElimTy, undefined, 'eliminator');

  // Exists (α : Type) (pred : α -> Prop) : Prop
  const alpha = Var('α'), pred = Var('pred');
  const predT = arrow(alpha, P);
  add('Exists', Pi('α', S0, arrow(predT, P)), undefined, 'inductive');
  add('Exists.intro',
    Pi('α', S0, Pi('pred', predT,
      Pi('w', alpha, arrow(App(pred, Var('w')), mkApps(Const('Exists'), [alpha, pred]))))), undefined, 'ctor');
  const exStep = Pi('w', alpha, arrow(App(pred, Var('w')), Var('r')));
  const exElimTy = Pi('α', S0, Pi('pred', predT, Pi('r', P,
    arrow(mkApps(Const('Exists'), [alpha, pred]), arrow(exStep, Var('r'))))));
  add('Exists.elim', exElimTy, undefined, 'eliminator');

  // -- Equality -----------------------------------------------------------------
  // Eq (α : Type) (a b : α) : Prop
  const tyV = Var('α'), aV = Var('a'), bV = Var('b');
  const eqOf = (ty, a, b) => mkApps(Const('Eq'), [ty, a, b]);
  add('Eq', Pi('α', S0, Pi('_', tyV, Pi('_', tyV, P))), undefined, 'inductive');
  add('Eq.refl', Pi('α', S0, Pi('a', tyV, eqOf(tyV, aV, aV))), undefined, 'ctor');
  const symmTy = Pi('α', S0, Pi('a', tyV, Pi('b', tyV, arrow(eqOf(tyV, aV, bV), eqOf(tyV, bV, aV)))));
  add('Eq.symm', symmTy, undefined, 'axiom');
  const cV = Var('c');
  const transInner = arrow(eqOf(tyV, aV, bV), arrow(eqOf(tyV, bV, cV), eqOf(tyV, aV, cV)));
  const transTy = Pi('α', S0, Pi('a', tyV, Pi('b', tyV, Pi('c', tyV, transInner))));
  add('Eq.trans', transTy, undefined, 'axiom');
  // Eq.subst (Leibniz): motive a -> motive b given a = b
  const motV = Var('motive');
  const substInner = arrow(eqOf(tyV, aV, bV), arrow(App(motV, aV), App(motV, bV)));
  const substTy = Pi('α', S0, Pi('motive', arrow(tyV, P), Pi('a', tyV, Pi('b', tyV, substInner))));
  add('Eq.subst', substTy, undefined, 'axiom');
  const congrInner = arrow(eqOf(tyV, aV, bV), eqOf(Var('β'), App(Var('f'), aV), App(Var('f'), bV)));
  const congrTy = Pi('α', S0, Pi('β', S0, Pi('f', arrow(tyV, Var('β')), Pi('a', tyV, Pi('b', tyV, congrInner)))));
  add('congrArg', congrTy, undefined, 'axiom');

  // -- Trusted Nat computation lemmas (all true by definition of add/mul) -------
  const eqNat = (a, b) => eqOf(NatT, a, b);
  const nV = Var('n'), mV = Var('m');
  const addMN = mkApps(Const('Nat.add'), [nV, mV]);
  const tru = (name, ty) => add(name, ty, undefined, 'axiom');
  tru('Nat.add_zero', Pi('n', NatT, eqNat(mkApps(Const('Nat.add'), [nV, zero]), nV)));
  tru('Nat.zero_add', Pi('n', NatT, eqNat(mkApps(Const('Nat.add'), [zero, nV]), nV)));
  tru('Nat.add_succ', Pi('n', NatT, Pi('m', NatT,
    eqNat(mkApps(Const('Nat.add'), [nV, succOf(mV)]), succOf(addMN)))));
  tru('Nat.succ_add', Pi('n', NatT, Pi('m', NatT,
    eqNat(mkApps(Const('Nat.add'), [succOf(nV), mV]), succOf(addMN)))));
  tru('Nat.mul_zero', Pi('n', NatT, eqNat(mkApps(Const('Nat.mul'), [nV, zero]), zero)));
  tru('Nat.zero_mul', Pi('n', NatT, eqNat(mkApps(Const('Nat.mul'), [zero, nV]), zero)));
  tru('Nat.mul_one', Pi('n', NatT, eqNat(mkApps(Const('Nat.mul'), [nV, succOf(zero)]), nV)));
  tru('Nat.one_mul', Pi('n', NatT, eqNat(mkApps(Const('Nat.mul'), [succOf(zero), nV]), nV)));
  tru('Nat.mul_succ', Pi('n', NatT, Pi('m', NatT,
    eqNat(mkApps(Const('Nat.mul'), [nV, succOf(mV)]),
      mkApps(Const('Nat.add'), [nV, mkApps(Const('Nat.mul'), [nV, mV])])))));

  // -- Trusted Prop equalities for rewriting (propext-style, consistent) --------
  const eqP = (a, b) => eqOf(P, a, b);
  const T = Const('True'), F = Const('False');
  const andPQ = mkApps(Const('And'), [p, q]);
  const orPQ = mkApps(Const('Or'), [p, q]);
  tru('Prop.and_true', Pi('p', P, eqP(mkApps(Const('And'), [p, T]), p)));
  tru('Prop.true_and', Pi('p', P, eqP(mkApps(Const('And'), [T, p]), p)));
  tru('Prop.and_false', Pi('p', P, eqP(mkApps(Const('And'), [p, F]), F)));
  tru('Prop.false_and', Pi('p', P, eqP(mkApps(Const('And'), [F, p]), F)));
  tru('Prop.or_true', Pi('p', P, eqP(mkApps(Const('Or'), [p, T]), T)));
  tru('Prop.true_or', Pi('p', P, eqP(mkApps(Const('Or'), [T, p]), T)));
  tru('Prop.or_false', Pi('p', P, eqP(mkApps(Const('Or'), [p, F]), p)));
  tru('Prop.false_or', Pi('p', P, eqP(mkApps(Const('Or'), [F, p]), p)));
  tru('Prop.not_true', eqP(arrow(T, F), F));
  tru('Prop.not_false', eqP(arrow(F, F), T));
  tru('Prop.imp_self', Pi('p', P, eqP(arrow(p, p), T)));
  tru('Prop.eq_self', Pi('α', S0, Pi('a', tyV, eqOf(tyV, aV, aV))));

  // The single sorry axiom (Lean-style): `sorryAx α : α`. Goals (Props) can be
  // supplied because Prop is definitionally Type 0 in this kernel.
  add('sorryAx', Pi('α', S0, Var('α')), undefined, 'sorryAx');

  return env;
}

// Lemmas the `simp` tactic may use (names must exist in the prelude).
export const SIMP_LEMMAS = [
  'Nat.add_zero', 'Nat.zero_add', 'Nat.add_succ', 'Nat.succ_add',
  'Nat.mul_zero', 'Nat.zero_mul', 'Nat.mul_one', 'Nat.one_mul',
  'Prop.and_true', 'Prop.true_and', 'Prop.and_false', 'Prop.false_and',
  'Prop.or_true', 'Prop.true_or', 'Prop.or_false', 'Prop.false_or',
  'Prop.not_true', 'Prop.not_false', 'Prop.imp_self',
];
