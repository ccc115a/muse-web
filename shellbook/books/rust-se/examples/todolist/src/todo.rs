use std::fs;
use std::path::PathBuf;

pub struct TodoList {
    tasks: Vec<(String, bool)>,
    path: PathBuf,
}

impl TodoList {
    pub fn new() -> Self {
        TodoList::with_path(PathBuf::from("todos.txt"))
    }

    pub fn with_path(path: PathBuf) -> Self {
        let mut list = TodoList {
            tasks: Vec::new(),
            path,
        };
        list.load();
        list
    }

    fn load(&mut self) {
        if let Ok(content) = fs::read_to_string(&self.path) {
            for line in content.lines() {
                if let Some((done, task)) = line.split_once('\t') {
                    self.tasks.push((task.to_string(), done == "1"));
                }
            }
        }
    }

    fn save(&self) {
        let content: String = self
            .tasks
            .iter()
            .map(|(task, done)| format!("{}\t{}\n", if *done { "1" } else { "0" }, task))
            .collect();
        fs::write(&self.path, content).expect("無法寫入 todos.txt");
    }

    pub fn add(&mut self, task: String) {
        self.tasks.push((task, false));
        self.save();
    }

    pub fn complete(&mut self, n: usize) -> Result<bool, String> {
        if n == 0 || n > self.tasks.len() {
            return Err(format!("index {n} out of range"));
        }
        self.tasks[n - 1].1 = true;
        self.save();
        Ok(true)
    }

    pub fn pending(&self) -> Vec<&String> {
        self.tasks
            .iter()
            .filter(|(_, done)| !done)
            .map(|(task, _)| task)
            .collect()
    }

    pub fn print(&self) {
        for (i, (task, done)) in self.tasks.iter().enumerate() {
            let mark = if *done { "✓" } else { " " };
            println!("{:>3}. [{mark}] {task}", i + 1);
        }
        println!("共 {} 項，未完成 {} 項", self.tasks.len(), self.pending().len());
    }
}

impl Default for TodoList {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_list() -> TodoList {
        TodoList::with_path(std::env::temp_dir().join(format!("todo-test-{}.txt", std::process::id())))
    }

    #[test]
    fn add_and_pending() {
        let mut list = tmp_list();
        list.add("寫測試".into());
        list.add("部署".into());
        assert_eq!(list.pending().len(), 2);
        let _ = fs::remove_file(&list.path);
    }

    #[test]
    fn complete_marks_done() {
        let mut list = tmp_list();
        list.add("寫測試".into());
        assert!(list.complete(1).unwrap());
        assert_eq!(list.pending().len(), 0);
        let _ = fs::remove_file(&list.path);
    }

    #[test]
    fn state_persists_across_instances() {
        let path = std::env::temp_dir().join(format!("todo-persist-{}.txt", std::process::id()));
        let mut list = TodoList::with_path(path.clone());
        list.add("跨 process 存活".into());
        drop(list);
        let reloaded = TodoList::with_path(path.clone());
        assert_eq!(reloaded.pending(), vec!["跨 process 存活"]);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn complete_out_of_range_is_err() {
        let mut list = tmp_list();
        assert!(list.complete(99).is_err());
        assert!(list.complete(0).is_err());
        let _ = fs::remove_file(&list.path);
    }
}
