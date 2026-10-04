(.venv) cccuser@cccimacdeiMac llm % ./run.sh
使用後端: tf0-pure-js (TensorFlow native CPU)
詞表大小: 210
模型參數總數: 19.5 K

=== 階段 1: 預訓練 (../corpus/pretrain.txt) ===
開始預訓練 (1000 步, 學習率 0.003)...
Step    0 | Loss: 5.3657
Step  100 | Loss: 1.8724
Step  200 | Loss: 1.1515
Step  300 | Loss: 0.9471
Step  400 | Loss: 0.6642
Step  500 | Loss: 0.5085
Step  600 | Loss: 0.4924
Step  700 | Loss: 0.4428
Step  800 | Loss: 0.5030
Step  900 | Loss: 0.4583
Step  999 | Loss: 0.4198

=== 預訓練後生成結果 (Prompt: '<Q>火星的大氣層怎樣？') ===
<Q>火星的大氣層怎樣？。
天王星的自轉方向與質量決定它們的大紅斑」。
行星的內部結構相似但有不同的密度。
地球的表面有七成被海洋覆蓋。
行星的內部結構相似但有不同的密度。
火星的大氣層很稀薄。
天王星的直徑約為四千八百公里

=== 階段 2: 微調 (Finetune: ../corpus/finetune.txt) ===
開始微調 (1000 步, 學習率 0.001)...
Step    0 | Loss: 5.2146
Step  100 | Loss: 1.9605
Step  200 | Loss: 1.4671
Step  300 | Loss: 0.9763
Step  400 | Loss: 0.7870
Step  500 | Loss: 0.7016
Step  600 | Loss: 0.5237
Step  700 | Loss: 0.4815
Step  800 | Loss: 0.4257
Step  900 | Loss: 0.3895
Step  999 | Loss: 0.3741

=== 最終生成結果 (Prompt: '<Q>火星的大氣層怎樣？') ===
<Q>火星的大氣層怎樣？<A>很稀薄
<Q>海王星的直徑約為多少？<A>四萬九千公里
<Q>行星的自轉速度影響什麼？<A>日夜長度
<Q>哪顆行星是太陽系中最熱的？<A>土星
<Q>金星的自轉方向與多數行星有什麼不同嗎？<A