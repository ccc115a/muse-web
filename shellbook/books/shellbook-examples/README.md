# shellbook 範例

這是一份可以「邊讀邊執行」的文件。按下程式碼區塊右上角的 **執行**，指令就會送進下方的終端機。

```shell
echo "hello from shellbook"
```

同一個 shell 不會中斷，所以前一步設定的變數，下一步還在：

```shell
export GREETING="你好"
```

```shell
echo "$GREETING, $(basename "$PWD")"
```

你也可以直接點進終端機輸入指令。

## 章節

- [第一章：基本指令](01-chapter1.md)
- [第二章：環境變數](02-chapter2.md#保持狀態)
- [子資料夾裡的文件](sub/deep.md)
- [不存在的文件](nope.md)

## 其他區塊

不是 shell 的程式碼只會顯示，不會有執行按鈕：

```js
console.log("not runnable");
```
