-- 06_nat_mul.lean — 乘法與化簡：simp / rw / 自訂義的計算行為
-- Nat.mul x y 是用 Nat.rec 定義的：mul x 0 = 0，mul x (succ m) = x + mul x m。

theorem mul_zero_thm (n : Nat) : n * 0 = 0 := by
  rw [Nat.mul_zero]

theorem zero_mul_thm (n : Nat) : 0 * n = 0 := by
  induction n with k ih
  · rfl
  · simp [Nat.mul_succ, ih]

theorem mul_one_thm (n : Nat) : n * 1 = n := by
  rw [Nat.mul_one]

-- 乘法展開一層：n * succ m = n + n * m
theorem mul_succ_thm (n m : Nat) : n * Nat.succ m = n + n * m := by
  rw [Nat.mul_succ]

-- 具體乘法計算
theorem two_times_three : 2 * 3 = 6 := by
  rfl

-- simp 自動化簡：(n + 0) * 1 先後化簡為 n
theorem simp_mul_demo (n : Nat) : (n + 0) * 1 = n := by
  simp

-- 自訂義函數的計算行為：先用 show 把定義展開（定義展開是 definitional），再改寫
def double2 (n : Nat) : Nat := n + n

theorem double2_succ (n : Nat) : double2 (Nat.succ n) = Nat.succ (Nat.succ (double2 n)) := by
  show Nat.succ n + Nat.succ n = Nat.succ (Nat.succ (n + n))
  rw [Nat.add_succ, Nat.succ_add]

#eval 3 * 4
#eval 10 + 20
