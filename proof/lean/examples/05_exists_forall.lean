-- 05_exists_forall.lean — 存在與全稱：Exists.intro / cases / apply
-- ∃ x : T, p x 會 elaborates 成 Exists T (fun x : T => p x)；
-- 匿名建構子 ⟨w, h⟩ 需要由目標的型別來決定含義。

-- 存在引入：直接給見證 0 和它滿足性質的證明
theorem ex_zero : ∃ n : Nat, n = 0 := by
  exact ⟨0, Eq.refl Nat 0⟩

-- 存在引入的另一種寫法：見證直接寫進匿名建構子
theorem ex_succ (m : Nat) : ∃ n : Nat, n = Nat.succ m := by
  exact ⟨Nat.succ m, Eq.refl Nat (Nat.succ m)⟩

-- 存在消去：cases 把見證與性質一起取出來
theorem ex_elim_demo (h : ∃ n : Nat, n = 0) : True := by
  cases h with w hw
  exact True.intro

-- 用取出的等式改寫：把 0 的性質搬到目標上
theorem ex_use (h : ∃ n : Nat, n + 0 = n) : True := by
  cases h with w hw
  exact True.intro

-- 全稱消去：apply 全稱假設，系統自動解出實例
theorem forall_use (p : Nat -> Prop) (h : ∀ n : Nat, p n) : p 5 := by
  apply h

-- 全稱引入：intro 之後目標是 p x
theorem forall_intro_demo (p : Nat -> Prop) (h : ∀ n : Nat, p n) : ∀ x : Nat, p x := by
  intro x
  apply h

-- 存在與合取混用
theorem ex_and (p q : Prop) (hp : p) (hq : ∃ n : Nat, q) : p ∧ q := by
  cases hq with w hw
  constructor
  · exact hp
  · exact hw

#check (Exists.intro Nat (fun n : Nat => n = n) 3 (Eq.refl Nat 3))
