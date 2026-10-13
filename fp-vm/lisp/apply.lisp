; apply / tailapply: 動態參數個數呼叫 (v1.2, 無 10 個上限)
(display (apply + '(1 2 3 4))) (newline)                 ; 10
(display (apply + '())) (newline)                        ; 0
(display (apply list '(1 2 3))) (newline)                ; (1 2 3)
(define (add3 a b c) (+ a b c))
(display (apply add3 '(10 20 30))) (newline)             ; 60
(display (apply + '(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15))) (newline)  ; 120
; 尾位置的 apply -> TAILAPPLY (不長堆疊)
(define (my-apply f xs) (apply f xs))
(display (my-apply + '(5 6))) (newline)                  ; 11
(define (loop-apply n) (if (= n 0) 'done (apply loop-apply (list (- n 1)))))
(display (loop-apply 100000)) (newline)                  ; done
