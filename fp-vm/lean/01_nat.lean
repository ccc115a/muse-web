-- 01_nat.lean : Nat 遞迴、多方程式、#eval
-- 執行: node leanc.js lean/01_nat.lean && node lispvm.js lean/01_nat.lbc

def fact : Nat → Nat
  | 0 => 1
  | n => n * fact (n - 1)

def fib : Nat → Nat
  | 0 => 0
  | 1 => 1
  | n => fib (n - 1) + fib (n - 2)

#eval fact 20
#eval fib 20

def isEven : Nat → Nat
  | 0 => 1
  | 1 => 0
  | n => isEven (n - 2)

#eval isEven 10
#eval isEven 7
#eval 1000000 - 1
#eval 7 / 2
