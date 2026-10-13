-- 02_list.lean : inductive + match + 多參數方程式
-- 執行: node leanc.js lean/02_list.lean && node fpvm.js lean/02_list.fbc

inductive NatList
  | nil
  | cons (Nat) (NatList)

def sum : NatList → Nat
  | .nil => 0
  | .cons x xs => x + sum xs

def len : NatList → Nat
  | .nil => 0
  | .cons _ xs => len xs + 1

def mylist : NatList := .cons 1 (.cons 2 (.cons 3 .nil))

#eval sum mylist
#eval len mylist

def append : NatList → NatList → NatList
  | .nil, ys => ys
  | .cons x xs, ys => .cons x (append xs ys)

#eval append mylist mylist

def head? : NatList → Nat
  | .nil => 0
  | .cons x _ => x

#eval head? mylist
#eval head? .nil

def classify (xs : NatList) : Nat :=
  match xs with
  | .nil => 0
  | .cons _ .nil => 1
  | .cons _ _ => 2

#eval classify mylist
#eval classify .nil
