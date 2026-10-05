use todolist::todo::TodoList;

#[test]
fn full_workflow() {
    let path = std::env::temp_dir().join(format!("todo-cli-{}.txt", std::process::id()));
    let mut list = TodoList::with_path(path.clone());
    list.add("寫功能".into());
    list.add("寫測試".into());
    list.complete(1).unwrap();
    assert_eq!(list.pending(), vec!["寫測試"]);
    std::fs::remove_file(path).unwrap();
}
