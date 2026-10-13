-- 04_array.lean : 原生 Array（建構/push/get/set/size/越界/persistent）
-- 執行: node leanc.js lean/04_array.lean && node fpvm.js lean/04_array.fbc

def main : IO Unit := do
  let a := #[1, 2, 3]
  println (Array.size a)
  println (Array.get a 0)
  println (Array.get a 2)
  let b := Array.push a 4
  println (Array.size b)
  println (Array.size a)
  println (Array.get b 3)
  -- set 回傳新 array，舊的不變
  let c := Array.set b 1 99
  println (Array.get c 1)
  println (Array.get b 1)
  println (array? c)
  println (array? 42)
  println (try Array.get a 99 catch e => "caught")
  println #[]
