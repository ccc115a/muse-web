-- 03_io.lean : do-notation、let、main 自動執行
-- 執行: node leanc.js lean/03_io.lean && node lispvm.js lean/03_io.lbc

def double (x : Nat) : Nat := x * 2

def main : IO Unit := do
  println "Hello, Lean!"
  println 42
  let x := 6 * 7
  println x
  println (double x)
  let y ← x + 8
  println y
