-- 01_prop_logic.lean — 命題邏輯：intro / cases / constructor / left / right / exact
-- 每個定理都由 kernel 重新檢查其證明項，因此 tactic 有 bug 也只能失敗、不能造假。

-- 合取引入與合取消去
theorem and_intro (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor
  · exact hp
  · exact hq

-- 合取交換律：先拆假設，再按相反順序組回去
theorem and_comm (p q : Prop) (h : p ∧ q) : q ∧ p := by
  cases h with hl hr
  constructor
  · exact hr
  · exact hl

-- 析取引入
theorem or_inl_demo (p q : Prop) (hp : p) : p ∨ q := by
  left
  exact hp

theorem or_inr_demo (p q : Prop) (hq : q) : p ∨ q := by
  right
  exact hq

-- 析取交換律：cases 會分裂成兩個子目標，用 · 分別處理
theorem or_comm (p q : Prop) (h : p ∨ q) : q ∨ p := by
  cases h with hl hr
  · right
    exact hl
  · left
    exact hr

-- modus ponens：apply 把蘊涵的前件變成新的子目標
theorem mp_demo (p q : Prop) (himp : p -> q) (hp : p) : q := by
  apply himp
  exact hp

-- apply 也可以用在已知引理上（結論能唯一決定參數時）
theorem and_apply_demo (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  apply And.intro
  · exact hp
  · exact hq

-- True 可由 trivial 關閉；False 可消去一切
theorem true_demo : True := by
  trivial

theorem false_elim_demo (p : Prop) (h : False) : p := by
  cases h

-- 蕴涵證明就是 intro
theorem imp_refl (p : Prop) : p -> p := by
  intro h
  exact h

#check (And.intro True True True.intro True.intro)
