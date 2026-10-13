-- 10_subset.lean : SUBSET.md P0 綜合（attribute/修飾詞/mutual/具名參數/sorry/have/hex/set_option）
-- 執行: node leanc.js lean/10_subset.lean && node fpvm.js lean/10_subset.fbc

set_option maxRecDepth 1000

@[simp] private def answer : Nat := 41

mutual
def isEven : Nat → Nat
  | 0 => 1
  | n => isOdd (n - 1)
def isOdd : Nat → Nat
  | 0 => 0
  | n => isEven (n - 1)
end

partial def add (x : Nat) (y : Nat) : Nat := x + y

def main : IO Unit := do
  println answer
  println (isEven 10)
  println (add (x := 10) (y := 20))
  println (try sorry catch e => "caught")
  println (have h : Nat := 6;
  h * 7)
  println 0xFF
  println 0o77
  println 0b101
  println (add (@add 1 2) 3)
