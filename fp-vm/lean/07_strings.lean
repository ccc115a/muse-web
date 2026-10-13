-- 07_strings.lean : 字串 ops、Char、比較
-- 執行: node leanc.js lean/07_strings.lean && node fpvm.js lean/07_strings.fbc

def main : IO Unit := do
  println (String.length "hello")
  println (String.length "λλ")
  println (Nat.toString (String.get "hello" 1))
  println (String.extract "hello" 1 4)
  println ("abc" < "abd")
  println ("b" < "a")
  println ("abc" == "abc")
  println (Char.toNat 'A')
  println (Char.ofNat 65)
  println (Char.ofNat (Char.toNat 'λ'))
  println (Nat.toString 42)
  println (String.append "a" "b")
  println (try String.get "hi" 9 catch e => "caught")
