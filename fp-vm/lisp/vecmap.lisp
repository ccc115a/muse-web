; vector / hash-map 原生建構 (v1.2，與 cljc 標籤表示共用，底層即 tagged list)
(display (vector 1 2 3)) (newline)          ; (%vec 1 2 3)
(display (vector)) (newline)                ; (%vec)
(display (hash-map 'a 1 'b 2)) (newline)    ; (%map (a 1) (b 2))
(display (hash-map 'a 1 'a 2)) (newline)    ; (%map (a 2))，重複鍵後贏
(display (car (vector 7 8))) (newline)      ; %vec
