import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE_TASKS_KEY = 'cgold_store_tasks';

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadStoreTasks() {
  try {
    const raw = await AsyncStorage.getItem(STORE_TASKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

async function saveStoreTasks(tasksByStore) {
  await AsyncStorage.setItem(STORE_TASKS_KEY, JSON.stringify(tasksByStore));
}

export async function addStoreTask(store, text) {
  const trimmed = String(text || '').trim();
  if (!store || !trimmed) return null;

  const tasksByStore = await loadStoreTasks();
  const list = Array.isArray(tasksByStore[store]) ? tasksByStore[store] : [];
  const task = {
    id: makeId(),
    text: trimmed,
    done: false,
    createdAt: Date.now(),
  };
  const next = {
    ...tasksByStore,
    [store]: [...list, task],
  };
  await saveStoreTasks(next);
  return { tasksByStore: next, task };
}

export async function toggleStoreTask(store, taskId) {
  const tasksByStore = await loadStoreTasks();
  const list = Array.isArray(tasksByStore[store]) ? tasksByStore[store] : [];
  const nextList = list.map((task) =>
    task.id === taskId ? { ...task, done: !task.done } : task,
  );
  const next = { ...tasksByStore, [store]: nextList };
  await saveStoreTasks(next);
  return next;
}

export async function removeStoreTask(store, taskId) {
  const tasksByStore = await loadStoreTasks();
  const list = Array.isArray(tasksByStore[store]) ? tasksByStore[store] : [];
  const next = {
    ...tasksByStore,
    [store]: list.filter((task) => task.id !== taskId),
  };
  await saveStoreTasks(next);
  return next;
}
