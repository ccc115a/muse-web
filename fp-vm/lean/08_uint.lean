-- 08_uint.lean : UInt8/16/32/64（遮罩、移位、除零 guard）
-- 執行: node leanc.js lean/08_uint.lean && node fpvm.js lean/08_uint.fbc

def main : IO Unit := do
  println (UInt32.add 4294967295 1)
  println (UInt8.add 200 100)
  println (UInt16.mul 1000 1000)
  println (UInt64.sub 0 1)
  println (UInt32.shl 1 4)
  println (UInt32.shr 256 4)
  println (UInt32.and 12 10)
  println (UInt32.or 12 10)
  println (UInt32.xor 12 10)
  println (UInt8.not 0)
  println (UInt32.div 7 2)
  println (UInt32.mod 7 2)
  println (try UInt32.div 1 0 catch e => "div0")
  println (Nat.pow 2 10)
  println (UInt16.toNat 70000)
  println (UInt16.fromNat 70000)
