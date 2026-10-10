-- 04_nat_add_comm.lean — 加法交換律（經典的歸納證明）
-- 策略：先證兩個輔助引理，再對 n 歸納；歸納步驟中用 ih 改寫。

theorem add_succ_right (n m : Nat) : n + Nat.succ m = Nat.succ (n + m) := by
  rw [Nat.add_succ]

theorem succ_add_left (n m : Nat) : Nat.succ n + m = Nat.succ (n + m) := by
  rw [Nat.succ_add]

theorem zero_add_left (n : Nat) : 0 + n = n := by
  induction n with k ih
  · rfl
  · rw [Nat.add_succ, ih]

theorem add_zero_right (n : Nat) : n + 0 = n := by
  rw [Nat.add_zero]

-- 主定理：a + b = b + a
theorem add_comm_thm (a b : Nat) : a + b = b + a := by
  induction a with k ih
  · rw [Nat.zero_add, Nat.add_zero]
  · rw [Nat.succ_add, ih, Nat.add_succ]

-- 推論：加法結合律（對第三個變數歸納）
theorem add_assoc_thm (a b c : Nat) : a + b + c = a + (b + c) := by
  induction c with k ih
  · rw [Nat.add_zero, Nat.add_zero]
  · rw [Nat.add_succ, ih, Nat.add_succ]

-- 推論：加法右交換（結合律 + 交換律 + 反向改寫）
theorem add_right_comm_thm (a b c : Nat) : a + b + c = a + c + b := by
  rw [add_assoc_thm, add_comm_thm b c, <- add_assoc_thm]
