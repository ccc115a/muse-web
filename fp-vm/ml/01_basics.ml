-- 01_basics.ml : let / option / match / 基礎運算
-- 執行: node mlc.js ml/01_basics.ml && node fpvm.js ml/01_basics.fbc

datatype option = None | Some of 'a;

let safe_div x y = if y = 0 then None else Some (x / y);
let show o = match o with None -> "none" | Some v -> v;

display (show (safe_div 10 2)); newline ();
display (show (safe_div 10 0)); newline ();

let inc x = x + 1;
display (inc 41); newline ();
display (1 + 2 * 3); newline ();
display (if 3 < 5 then "yes" else "no"); newline ()
