use todolist::todo::TodoList;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut list = TodoList::new();

    match args.first().map(String::as_str) {
        Some("add") => {
            let task = args.get(1..).unwrap_or_default().join(" ");
            list.add(task.clone());
            println!("已加入：{}", task);
        }
        Some("list") => list.print(),
        Some("done") => {
            let n: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            match list.complete(n) {
                Ok(true) => println!("已完成第 {n} 項"),
                _ => println!("找不到第 {n} 項"),
            }
        }
        _ => {
            eprintln!("用法: todolist add <任務> | list | done <編號>");
            std::process::exit(1);
        }
    }
}
