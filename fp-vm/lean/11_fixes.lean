-- 11_fixes.lean : v2.6 修復迴歸 (let rec / 緊貼負號 / section / unicode / 底線數字 / apply)
-- 執行: node leanc.js lean/11_fixes.lean && node fpvm.js lean/11_fixes.fbc

import Std

inductive N where
  | nil
  | cons (Nat) (N)

def factRec (n : Nat) : Nat :=
  let rec go := fun m => if m == 0 then 1 else m * go (m - 1);
  go n

def αβ : Nat := 40

def myadd (x : Nat) (y : Nat) : Nat := x + y
def inc (x : Nat) : Nat := x + 1

def main : IO Unit := do
  println (factRec 5)
  let rec fib := fun n => if n < 2 then n else fib (n - 1) + fib (n - 2)
  println (fib 10)
  println -5
  println (10-3)
  println ((+) 20 22)
  println ((::) 1 nil)
  println (αβ + 2)
  println 1_000_000
  println (apply inc (list 41))
  println (apply (apply myadd (list 10)) (list 20))
