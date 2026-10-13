-- 09_io.lean : 參數列 + 結尾 exit（read-line/帶參/非零碼走手測，stdin 具消耗性）
-- 執行: node leanc.js lean/09_io.lean && node fpvm.js lean/09_io.fbc

def main : IO Unit := do
  println (IO.getArgs ())
  println "ending"
  IO.exit 0
