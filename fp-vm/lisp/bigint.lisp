; bigint: N 後綴整數字面量，精確整數運算 (v1.2)
(define (fact n) (if (<= n 1) 1 (* n (fact (- n 1)))))
(display (fact 30N)) (newline)              ; 265252859812191058636308480000000
(display 123456789012345678901234567890N) (newline)
(display (+ 1N 2)) (newline)                ; 3 (混合自動提升)
(display (= 5 5N)) (newline)                ; #t (跨型別數值相等)
(display (quotient 17N 5)) (newline)        ; 3
(display (* 2N 3N)) (newline)               ; 6
(display (fact 20)) (newline)               ; 舊行為不變 (浮點): 2432902008176640000
