-- 03_nat_basic.lean — 自然數基礎：induction / simp / rfl 計算
-- Nat.add 是用 Nat.rec 定義的，所以 2 + 3 這類具體計算可直接 rfl。

-- 具體計算：kernel 會把 Nat.add 展開並算出 5
theorem two_plus_three : 2 + 3 = 5 := by
  rfl

theorem zero_plus_zero : 0 + 0 = 0 := by
  rfl

-- 右加零：直接用函式庫引理
theorem add_zero_thm (n : Nat) : n + 0 = n := by
  rw [Nat.add_zero]

-- 左加零：需要對 n 做歸納
theorem zero_add_thm (n : Nat) : 0 + n = n := by
  induction n with k ih
  · rfl
  · rw [Nat.add_succ, ih]

-- 後繼分配：succ (n + m) 的兩種寫法
theorem succ_add_thm (n m : Nat) : Nat.succ n + m = Nat.succ (n + m) := by
  rw [Nat.succ_add]

-- simp 可以一次用多條化簡引理，並自動收尾
theorem simp_demo (n : Nat) : n + 0 + 0 = n := by
  simp

-- 自訂義：double，並用 rfl 驗證 double 0 的計算行為
def double (n : Nat) : Nat := n + n

theorem double_zero : double 0 = 0 := by
  rfl

#eval double 4
#eval 2 * 3
