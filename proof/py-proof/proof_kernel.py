"""LCF-style / Curry-Howard 定理證明器核心（Lean-like Python Kernel）"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Union, Dict

# ==========================================
# 1. 命題 AST (Propositions as Types)
# ==========================================

class Prop:
    def __and__(self, other: Prop) -> And: return And(self, other)
    def __or__(self, other: Prop) -> Or: return Or(self, other)
    def __rshift__(self, other: Prop) -> Impl: return Impl(self, other)
    def __eq__(self, other: object) -> bool:
        return type(self) == type(other) and self.__dict__ == other.__dict__
    def __hash__(self) -> int:
        return hash((type(self).__name__,) + tuple(sorted(self.__dict__.items())))

@dataclass(frozen=True)
class Var(Prop):
    name: str
    def __repr__(self): return self.name

@dataclass(frozen=True)
class Impl(Prop):  # P → Q
    P: Prop
    Q: Prop
    def __repr__(self): return f"({self.P} → {self.Q})"

@dataclass(frozen=True)
class And(Prop):   # P ∧ Q
    P: Prop
    Q: Prop
    def __repr__(self): return f"({self.P} ∧ {self.Q})"

@dataclass(frozen=True)
class Or(Prop):    # P ∨ Q
    P: Prop
    Q: Prop
    def __repr__(self): return f"({self.P} ∨ {self.Q})"

@dataclass(frozen=True)
class Top(Prop):   # ⊤ 恆真
    def __repr__(self): return "⊤"

@dataclass(frozen=True)
class Bot(Prop):   # ⊥ 恆假
    def __repr__(self): return "⊥"


# ==========================================
# 2. Proof Terms（證明項 + 型別檢查核心）
# ==========================================

class Proof:
    def type_check(self, ctx: Dict[str, Prop]) -> Prop:
        raise NotImplementedError
    def __call__(self, arg: Proof) -> App:   # 蘊涵消去 (Modus Ponens)
        return App(self, arg)
    def __and__(self, other: Proof) -> Pair: # 合取引進
        return Pair(self, other)

@dataclass
class VarProof(Proof):
    name: str
    def type_check(self, ctx):
        if self.name in ctx: return ctx[self.name]
        raise TypeError(f"【邏輯錯誤】未知的假設前提: {self.name}")

@dataclass
class Lam(Proof):  # 蘊涵引進 λx. body
    var_name: str
    var_type: Prop
    body: Proof
    def type_check(self, ctx):
        new_ctx = ctx.copy()
        new_ctx[self.var_name] = self.var_type
        return Impl(self.var_type, self.body.type_check(new_ctx))

@dataclass
class App(Proof):  # 蘊涵消去
    fn: Proof
    arg: Proof
    def type_check(self, ctx):
        fn_type = self.fn.type_check(ctx)
        arg_type = self.arg.type_check(ctx)
        match fn_type:
            case Impl(P, Q):
                if P == arg_type: return Q
                raise TypeError(f"【型別不匹配】無法將證明 {arg_type} 套用到要求 {P} 的函數")
            case _:
                raise TypeError(f"【非函數】{fn_type} 不是一個蘊涵 (→) 命題，無法呼叫")

@dataclass
class Pair(Proof):  # 合取引進
    left: Proof
    right: Proof
    def type_check(self, ctx):
        return And(self.left.type_check(ctx), self.right.type_check(ctx))

@dataclass
class Fst(Proof):  # 合取消去 1
    pair: Proof
    def type_check(self, ctx):
        match self.pair.type_check(ctx):
            case And(P, Q): return P
            case t: raise TypeError(f"【型別錯誤】期望 (∧) 命題，卻得到 {t}")

@dataclass
class Snd(Proof):  # 合取消去 2
    pair: Proof
    def type_check(self, ctx):
        match self.pair.type_check(ctx):
            case And(P, Q): return Q
            case t: raise TypeError(f"【型別錯誤】期望 (∧) 命題，卻得到 {t}")

@dataclass
class Inl(Proof):  # ∨ 引進左
    value: Proof
    or_type: Or
    def type_check(self, ctx):
        left_type = self.value.type_check(ctx)
        if left_type == self.or_type.P: return self.or_type
        raise TypeError(f"【型別不匹配】Inl 期望 {self.or_type.P}，卻得到 {left_type}")

@dataclass
class Inr(Proof):  # ∨ 引進右
    value: Proof
    or_type: Or
    def type_check(self, ctx):
        right_type = self.value.type_check(ctx)
        if right_type == self.or_type.Q: return self.or_type
        raise TypeError(f"【型別不匹配】Inr 期望 {self.or_type.Q}，卻得到 {right_type}")

@dataclass
class Case(Proof):  # ∨ 消去（case 分析）
    scrutinee: Proof   # : P ∨ Q
    left_name: str     # 假設 P 得到的名字
    left_body: Proof   # : R
    right_name: str    # 假設 Q 得到的名字
    right_body: Proof  # : R
    left_type: Prop    # P
    right_type: Prop   # Q
    def type_check(self, ctx):
        match self.scrutinee.type_check(ctx):
            case Or(P, Q):
                if P != self.left_type or Q != self.right_type:
                    raise TypeError(
                        f"【型別不匹配】Case 期望 {self.left_type} ∨ {self.right_type}，"
                        f"卻得到 {P} ∨ {Q}")
                lctx = ctx.copy(); lctx[self.left_name] = P
                l_type = self.left_body.type_check(lctx)
                rctx = ctx.copy(); rctx[self.right_name] = Q
                r_type = self.right_body.type_check(rctx)
                if l_type == r_type: return l_type
                raise TypeError(f"【型別不匹配】Case 兩分支型別不同: {l_type} vs {r_type}")
            case t:
                raise TypeError(f"【型別錯誤】期望 (∨) 命題，卻得到 {t}")

@dataclass
class Absurd(Proof):  # ⊥ 消去（爆炸原理 ex falso quodlibet）
    contradiction: Proof
    target: Prop
    def type_check(self, ctx):
        t = self.contradiction.type_check(ctx)
        if t == Bot(): return self.target
        raise TypeError(f"【型別錯誤】Absurd 期望 ⊥，卻得到 {t}")


# ==========================================
# 3. 語法糖 DSL
# ==========================================

def lam(var_name: str, var_type: Prop, body_fn) -> Lam:
    """蘊涵引進律： lam("h", P, lambda h: ...)"""
    return Lam(var_name, var_type, body_fn(VarProof(var_name)))

λ = lam  # 別名

def π1(proof: Proof) -> Fst: return Fst(proof)
def π2(proof: Proof) -> Snd: return Snd(proof)
# 全形別名

def inl(value: Proof, P: Prop, Q: Prop) -> Inl: return Inl(value, Or(P, Q))
def inr(value: Proof, P: Prop, Q: Prop) -> Inr: return Inr(value, Or(P, Q))

def case(scrutinee, left_name, left_body_fn, right_name, right_body_fn,
         P: Prop, Q: Prop) -> Case:
    """∨ 消去：case(s, "l", lambda l: ..., "r", lambda r: ..., P, Q)"""
    l_var = VarProof(left_name)
    r_var = VarProof(right_name)
    return Case(scrutinee, left_name, left_body_fn(l_var),
                right_name, right_body_fn(r_var), P, Q)


# ==========================================
# 4. Theorem 定理聲明與驗證
# ==========================================

def theorem(name: str, statement: Prop, proof: Proof) -> Prop:
    """Kernel 驗證：證明項的型別必須恰好等於聲明的定理"""
    actual = proof.type_check(ctx={})
    if actual == statement:
        print(f"✅ 定理 {name} 證明成功: {statement}")
        return actual
    raise TypeError(f"【定理驗證失敗】{name}\n  聲明: {statement}\n  實際: {actual}")
