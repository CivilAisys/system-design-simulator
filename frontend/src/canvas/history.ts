// 復原／重做的紀錄：present 是目前的狀態，past 的最後一個是上一步，future 的最後一個是下一步
export type History<T> = {
  past: T[]
  present: T
  future: T[]
  // 最後一步的合併群組和最後一次修改的時間，見 commit
  group: string | null
  at: number
}

// 最多記幾步，更早的丟掉
const LIMIT = 100
// 同一個群組的修改間隔不到這麼久就併成一步（連續打字、拖 slider）
export const MERGE_MS = 1000

export type Step = {
  // 同一個群組的連續修改併成一步；null 表示一定是新的一步
  group: string | null
  at: number
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], group: null, at: 0 }
}

// 記成新的一步，重做紀錄清空。和上一步同一個群組、離上一次修改不到 MERGE_MS 時併進上一步
export function commit<T>(history: History<T>, next: T, { group, at }: Step): History<T> {
  if (next === history.present) {
    return history
  }
  if (group != null && group === history.group && at - history.at < MERGE_MS) {
    return { ...history, present: next, future: [], at }
  }
  return {
    past: [...history.past, history.present].slice(-LIMIT),
    present: next,
    future: [],
    group,
    at,
  }
}

// 改狀態但不算一步（選取、量尺寸、拖動的中途）。不清重做紀錄，也不打斷正在合併的群組
export function replace<T>(history: History<T>, next: T): History<T> {
  return next === history.present ? history : { ...history, present: next }
}

// 復原或重做之後的修改都是新的一步，不會併進復原前的群組
export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1)
  if (previous === undefined) {
    return history
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [...history.future, history.present],
    group: null,
    at: 0,
  }
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future.at(-1)
  if (next === undefined) {
    return history
  }
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(0, -1),
    group: null,
    at: 0,
  }
}
