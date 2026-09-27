(.venv) cccuser@cccimacdeiMac llm % ./run.sh
使用後端: tf0-pure-js (TensorFlow native CPU)
詞表大小: 210
模型參數總數: 19.5 K

=== 階段 1: 預訓練 (../corpus/pretrain.txt) ===
開始預訓練 (1000 步, 學習率 0.003)...
Step    0 | Loss: 5.3667
Step  100 | Loss: 1.8115
Step  200 | Loss: 1.0281
Step  300 | Loss: 0.8772
Step  400 | Loss: 0.6801
Step  500 | Loss: 0.5215
Step  600 | Loss: 0.5066
Step  700 | Loss: 0.4766
Step  800 | Loss: 0.4553
Step  900 | Loss: 0.4514
Step  999 | Loss: 0.4711

=== 預訓練後生成結果 (Prompt: '<Q>火星的大氣層怎樣？') ===
<Q>火星的大氣層怎樣？。
行星的質量決定它們的引力大小。
太陽系八大行星都圍繞太陽公轉。
海王星有至少14顆已知衛星。
海王星的大氣層有強烈的風暴。
天王星的大氣層含有甲烷，使它呈現藍綠色。
土星的一天大約是十點半小時。


=== 階段 2: 微調 (Finetune: ../corpus/finetune.txt) ===
開始微調 (1000 步, 學習率 0.001)...
Step    0 | Loss: 5.9150
Step  100 | Loss: 1.8763
Step  200 | Loss: 1.3231
Step  300 | Loss: 0.9716
Step  400 | Loss: 0.7020
Step  500 | Loss: 0.6283
Step  600 | Loss: 0.5687
Step  700 | Loss: 0.4654
Step  800 | Loss: 0.4461
Step  900 | Loss: 0.4113
Step  999 | Loss: 0.4393

=== 微調後生成結果 (Prompt: '<Q>火星的大氣層怎樣？') ===
<Q>火星的大氣層怎樣？<A>各有差異
<Q>木星的直徑約為多少？<A>十二萬公里
<Q>火星的表面是什麼？<A>隕石坑
<Q>水星的自轉速度怎樣？<A>很慢
<Q>地球的直徑約為多少？<A>十二萬公里
<Q>行星的內部結構
