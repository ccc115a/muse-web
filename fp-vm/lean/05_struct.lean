-- 05_struct.lean : structure（定義/實例/投影/with 更新）
-- 執行: node leanc.js lean/05_struct.lean && node fpvm.js lean/05_struct.fbc

structure Point where
  x : Nat
  y : Nat

def origin : Point := { x := 0, y := 0 }

def moveX (p : Point) (dx : Nat) : Point :=
  { p with x := Point.x p + dx }

def main : IO Unit := do
  println (Point.x origin)
  println (Point.y origin)
  let q := moveX origin 5
  println (Point.x q)
  println (Point.y q)
  println (Point.x { y := 7, x := 1 })
