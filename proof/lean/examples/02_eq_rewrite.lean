-- 02_eq_rewrite.lean — 等式推理：rfl / apply / rw / exact
-- 重點：rw [h] 會在目標中把 h 左邊換成右邊，並自動嘗試 rfl 收尾。

-- 自反性：rfl 只接受「定義上相等」的兩邊
theorem eq_refl_demo (a : Nat) : a = a := by
  rfl

-- 對稱性：apply Eq.symm 之後剩下一個前提子目標
theorem eq_symm_demo (a b : Nat) (h : a = b) : b = a := by
  apply Eq.symm
  exact h

-- 傳遞性：中間項 b 無法從結論 a = c 唯一決定，
-- 所以這裡用 exact 並把全部參數寫清楚（apply 只接受「結論能唯一決定參數」的情形）
theorem eq_trans_demo (a b c : Nat) (h1 : a = b) (h2 : b = c) : a = c := by
  exact Eq.trans Nat a b c h1 h2

-- 同餘：函數保持等式（型別參數同樣要寫清楚）
theorem congr_demo (f : Nat -> Nat) (a b : Nat) (h : a = b) : f a = f b := by
  exact congrArg Nat Nat f a b h

-- 用假設改寫目標：a -(h1)-> b，再用 h2 結尾
theorem rw_demo (a b c : Nat) (h1 : a = b) (h2 : b = c) : a = c := by
  rw [h1]
  exact h2

-- 反向改寫：<- 把右邊換回左邊
theorem rw_rev_demo (a b : Nat) (h : a = b) : b = a := by
  rw [<- h]

-- 用函式庫引理改寫（Nat.add_zero 是內建公理引理）
theorem add_zero_demo (n : Nat) : n + 0 = n := by
  rw [Nat.add_zero]

-- 連續改寫多條等式，最後自動 rfl
theorem rw_chain (a b : Nat) (h : a = b) : a + 0 = b := by
  rw [h, Nat.add_zero]

#check (Eq.refl Nat 3)
#eval 2 + 3
