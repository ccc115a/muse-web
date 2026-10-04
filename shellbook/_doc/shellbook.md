1. 一個 markdown 的 renderer，可以選擇資料夾後，顯示其中的 README.md
2. 透過 README.md 可以點選連結文件(例如 01-chapter1.md)，按回到上一層後，回到 README.md

    文件的檢視，使用 fetch api 取得文件，就類似網誌或 github .md 那樣

3. 下方有個 terminal 可執行 shell
4. markdown 中有下列區塊的，可以在 shell 中被執行

    ```shell 
    ...
    ```

    shell 的執行，通訊協定使用 websocket ，要有連續性，同一個 shell 不會中斷

5. 透過這種方式，可以一邊看文章，一邊執行

