-- 07_monad.lean : Option/Except/List + Monad + do[M]
-- 執行: node leanc.js lean/07_monad.lean && node fpvm.js lean/07_monad.fbc

inductive Option where
  | none
  | some (Nat)

inductive Except where
  | ok (Nat)
  | err (Nat)

inductive NatList where
  | nil
  | cons (Nat) (NatList)

class Monad where
  pure : Nat
  bind : Nat → Nat

instance : Monad Option where
  pure x := some x
  bind o f := match o with | none => none | some x => f x

instance : Monad Except where
  pure x := ok x
  bind e f := match e with | ok x => f x | err e => err e

def safeDiv (x : Nat) (y : Nat) : Nat :=
  do[Option]
    if y == 0 then none else some (x / y)

def chainDemo : Nat :=
  do[Option]
    a ← safeDiv 10 2
    b ← safeDiv a 2
    return (a + b)

def shortCircuit : Nat :=
  do[Except]
    a ← ok 10
    b ← err 99
    return (a + b)

def main : IO Unit := do
  println (chainDemo)
  println (safeDiv 7 0)
  println (shortCircuit)
  println (List.map (fun x => x * 2) (cons 1 (cons 2 nil)))
  println (List.length (cons 1 (cons 2 (cons 3 nil))))
  println (Option.getD none 42)
  println (Except.toOption (ok 7))
