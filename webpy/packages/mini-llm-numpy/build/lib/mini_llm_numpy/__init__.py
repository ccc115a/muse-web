"""mini_llm_numpy — 純 numpy 微型 Transformer（瀏覽器 / 無 torch 環境可用）。"""
from .data import build_vocab, make_codec, get_batch
from .model import (
    adam_init,
    adam_step,
    build_rope,
    ce_loss_and_bwd,
    clip_grads,
    forward,
    generate,
    init_params,
    seed,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "seed",
    "init_params",
    "build_rope",
    "forward",
    "ce_loss_and_bwd",
    "adam_init",
    "clip_grads",
    "adam_step",
    "generate",
    "build_vocab",
    "make_codec",
    "get_batch",
]
