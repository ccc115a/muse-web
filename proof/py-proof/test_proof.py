"""自動測試：多個古典/直覺主義定理 + 錯誤攔截測試"""
from proof_kernel import *

P, Q, R = Var("P"), Var("Q"), Var("R")

passed = failed = 0

def check(name, statement, proof):
    global passed, failed
    try:
        actual = proof.type_check(ctx={})
        assert actual == statement, f"型別不符\n  期望: {statement}\n  實際: {actual}"
        print(f"✅ {name}: {statement}")
        passed += 1
    except Exception as e:
        print(f"❌ {name} 失敗: {e}")
        failed += 1

def check_reject(name, proof, keyword=""):
    """錯誤證明必須被 Kernel 攔截"""
    global passed, failed
    try:
        t = proof.type_check(ctx={})
        print(f"❌ {name} 失敗：錯誤證明竟通過檢查！得到 {t}")
        failed += 1
    except TypeError as e:
        if keyword and keyword not in str(e):
            print(f"❌ {name} 失敗：錯誤訊息缺少 '{keyword}': {e}")
            failed += 1
        else:
            print(f"✅ {name}: Kernel 攔截 → {e}")
            passed += 1

# ==========================================
# 範例 1：假言三段論 (Hypothetical Syllogism)
# ==========================================
check(
    "1. 假言三段論",
    ((P >> Q) >> ((Q >> R) >> (P >> R))),
    λ("h1", P >> Q, lambda h1:
      λ("h2", Q >> R, lambda h2:
        λ("hP", P, lambda hP: h2(h1(hP)))))
)

# ==========================================
# 範例 2：恆等律 I → I
# ==========================================
check(
    "2. 恆等律",
    P >> P,
    λ("hP", P, lambda hP: hP)
)

# ==========================================
# 範例 3：Modus Ponens 的一般化（應用律自身）
# ==========================================
check(
    "3. Modus Ponens",
    P >> ((P >> Q) >> Q),
    λ("hP", P, lambda hP:
      λ("hPQ", P >> Q, lambda hPQ: hPQ(hP)))
)

# ==========================================
# 範例 4：交換律 (P ∧ Q) → (Q ∧ P)
# ==========================================
check(
    "4. ∧ 交換律",
    (P & Q) >> (Q & P),
    λ("h", P & Q, lambda h: π2(h) & π1(h))
)

# ==========================================
# 範例 5：分配律 P ∧ (Q ∨ R) → (P ∧ Q) ∨ (P ∧ R)
# ==========================================
check(
    "5. ∧ 對 ∨ 分配律",
    (P & (Q | R)) >> ((P & Q) | (P & R)),
    λ("h", P & (Q | R), lambda h:
      case(π2(h),
           "hq", lambda hq: inl(π1(h) & hq, P & Q, P & R),
           "hr", lambda hr: inr(π1(h) & hr, P & Q, P & R), Q, R))
)

# ==========================================
# 範例 6：曲線因子 (Currying) P ∧ Q → R  ≅  P → Q → R
# ==========================================
check(
    "6a. Currying",
    ((P & Q) >> R) >> (P >> (Q >> R)),
    λ("h", (P & Q) >> R, lambda h:
      λ("hP", P, lambda hP:
        λ("hQ", Q, lambda hQ: h(hP & hQ))))
)
check(
    "6b. Uncurrying",
    ((P >> (Q >> R)) >> ((P & Q) >> R)),
    λ("h", P >> (Q >> R), lambda h:
      λ("hpq", P & Q, lambda hpq: h(π1(hpq))(π2(hpq))))
)

# ==========================================
# 範例 7：組合子 B, C, K, S（組合邏輯）
# ==========================================
check("7a. K 組合子", P >> (Q >> P),
      λ("a", P, lambda a: λ("b", Q, lambda b: a)))
check("7b. S 組合子", ((P >> (Q >> R)) >> ((P >> Q) >> (P >> R))),
      λ("f", P >> (Q >> R), lambda f:
        λ("g", P >> Q, lambda g:
          λ("x", P, lambda x: f(x)(g(x))))))
check("7c. B 組合子（藍括號）", ((Q >> R) >> ((P >> Q) >> (P >> R))),
      λ("f", Q >> R, lambda f:
        λ("g", P >> Q, lambda g:
          λ("x", P, lambda x: f(g(x))))))

# ==========================================
# 範例 8：⊥ 爆炸原理 (Ex Falso Quodlibet)
# ==========================================
check(
    "8. 爆炸原理",
    Bot() >> P,
    λ("contra", Bot(), lambda contra: Absurd(contra, P))
)
check(
    "8b. ⊥ 傳遞到複合命題",
    Bot() >> (Q >> (P & R)),
    λ("contra", Bot(), lambda contra:
      λ("hq", Q, lambda hq: Absurd(contra, P & R)))
)

# ==========================================
# 範例 9：三段式推論鏈 (P → Q) → (P ∧ Q)
# ==========================================
check(
    "9. 弱化合成",
    ((P >> Q) >> (P >> (Q & P))),
    λ("hPQ", P >> Q, lambda hPQ:
      λ("hP", P, lambda hP: hPQ(hP) & hP))
)

# ==========================================
# 範例 10：嵌套四層 λ 的高階定理
# (P → Q → R) → (P → Q) → (P → R) → (P → P ∧ R)
# ==========================================
check(
    "10. 高階組合",
    (P >> (Q >> R)) >> ((P >> Q) >> ((P >> R) >> (P >> (P & R)))),
    λ("f", P >> (Q >> R), lambda f:
      λ("g", P >> Q, lambda g:
        λ("h", P >> R, lambda h:
          λ("x", P, lambda x: x & h(x)))))
)

# ==========================================
# 錯誤攔截測試（Kernel 必須抓包）
# ==========================================

# 11. 假言三段論寫反了
check_reject(
    "11. 三段論套用順序錯誤",
    λ("h1", P >> Q, lambda h1:
      λ("h2", Q >> R, lambda h2:
        λ("hP", P, lambda hP: h1(h2(hP))))),
    keyword="型別不匹配"
)

# 12. 引用未定義的前提
check_reject(
    "12. 未知前提",
    λ("hP", P, lambda hP: VarProof("hGhost")),
    keyword="未知的假設前提"
)

# 13. 對非函數命題做 Modus Ponens
check_reject(
    "13. 非函數呼叫",
    λ("h", P & Q, lambda h: h(h)),
    keyword="非函數"
)

# 14. π1 作用在非合取命題上
check_reject(
    "14. π1 型別錯誤",
    λ("h", P, lambda h: π1(h)),
    keyword="型別錯誤"
)

# 15. Case 兩分支型別不同
check_reject(
    "15. Case 分支型別不一致",
    λ("h", P | Q, lambda h:
      case(h, "l", lambda l: l, "r", lambda r: VarProof("whatever"), P, Q)),
    keyword="未知的假設前提"
)

# 16. 爆炸原理用在非 ⊥ 上
check_reject(
    "16. Absurd 需要 ⊥",
    λ("h", P, lambda h: Absurd(h, Q)),
    keyword="Absurd 期望 ⊥"
)

# 17. 定理聲明與證明不符
global_failed_holder = []
try:
    theorem("fake_theorem", P >> Q, λ("h", P, lambda h: h))
    print("❌ 17. theorem() 失敗：聲明不符竟通過")
    failed += 1
except TypeError as e:
    print(f"✅ 17. theorem() 攔截聲明不符")
    passed += 1

# 18. Inl 型別不匹配
check_reject(
    "18. Inl 型別不匹配",
    λ("h", Q, lambda h: inl(h, P, R)),
    keyword="Inl 期望"
)

print()
print("=" * 50)
print(f"測試結果：{passed} 通過 / {failed} 失敗")
print("=" * 50)
raise SystemExit(0 if failed == 0 else 1)
