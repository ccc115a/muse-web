-- 06_typeclass.lean : class / instance / deriving（執行期標籤分派）
-- 執行: node leanc.js lean/06_typeclass.lean && node fpvm.js lean/06_typeclass.fbc

class Show where
  show : Nat → String

class BEq where
  beq : Nat → Nat → Bool

class Repr where
  repr : Nat → String

inductive NatList where
  | nil
  | cons (Nat) (NatList)
deriving Repr

instance : Show NatList where
  show xs := match xs with
    | .nil => "nil"
    | .cons x xs => String.append "cons " (Nat.toString x)

instance : BEq NatList where
  beq a b := a == b

inductive Color where
  | red
  | green
  | blue
deriving BEq, Repr

def main : IO Unit := do
  println (show (cons 1 (cons 2 nil)))
  println (show nil)
  println (beq (cons 1 nil) (cons 1 nil))
  println (beq (cons 1 nil) nil)
  println (beq red red)
  println (beq red green)
  println (repr (cons 1 nil))
  println (repr green)
  println (repr nil)
