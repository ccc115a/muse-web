-- 03_recursion.ml : 尾遞迴 + 相互遞迴
-- 執行: node mlc.js ml/03_recursion.ml && node fpvm.js ml/03_recursion.fbc

letrec loop i acc = if i = 0 then acc else loop (i - 1) (acc + i);
display (loop 1000000 0); newline ();

letrec sum xs acc = match xs with [] -> acc | h :: t -> sum t (acc + h);
display (sum [1, 2, 3, 4, 5] 0); newline ();

-- 相互遞迴
letrec is_even n = if n = 0 then true else is_odd (n - 1);
letrec is_odd n = if n = 0 then false else is_even (n - 1);
display (is_even 10); newline ();
display (is_odd 10); newline ();

-- 常數 pattern
letrec fib n = match n with 0 -> 0 | 1 -> 1 | _ -> fib (n - 1) + fib (n - 2);
display (fib 20); newline ()
