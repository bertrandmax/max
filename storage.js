import { pushLocal } from './cloud.js?v=14';

const STORAGE_KEY = 'vox_tasks';

export function getTasks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveTasksRaw(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  pushLocal(STORAGE_KEY);
}

export function saveTasks(tasks) {
  saveTasksRaw(tasks);
}

export function addTask(task) {
  const tasks = getTasks();
  tasks.unshift(task);
  saveTasksRaw(tasks);
  return task;
}

export function deleteTask(id) {
  saveTasksRaw(getTasks().filter(t => t.id !== id));
}

export function toggleTask(id) {
  const tasks = getTasks().map(t =>
    t.id === id ? { ...t, completed: !t.completed } : t
  );
  saveTasksRaw(tasks);
  return tasks.find(t => t.id === id);
}

export function updateTask(id, updates) {
  saveTasksRaw(getTasks().map(t =>
    t.id === id ? { ...t, ...updates } : t
  ));
}

// ── Generic helpers (any tracker) ────────────
export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    pushLocal(key);
  } catch (err) {
    console.error('storage.set failed', key, err);
  }
}

export function push(key, item) {
  const arr = get(key, []);
  arr.unshift(item);
  set(key, arr);
  return item;
}

export function remove(key, id) {
  set(key, get(key, []).filter(x => x.id !== id));
}
