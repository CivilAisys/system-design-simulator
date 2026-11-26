import type { Category } from './catalog'

// 元件類別色（index.css 的變數），元件面板的組名圓點、CategoryIcon 的按鍵帽和節點的偏移陰影共用

// 按鍵帽的三個顏色（index.css 的 .category-icon）：正面漸層的底色、底部厚度、圖案
export const CATEGORY_TILE: Record<Category, string> = {
  TRAFFIC: '[--cap-top:var(--category-traffic-bg)] [--cap-side:var(--category-traffic-shadow)] [--cap-ink:var(--category-traffic)]',
  COMPUTE: '[--cap-top:var(--category-compute-bg)] [--cap-side:var(--category-compute-shadow)] [--cap-ink:var(--category-compute)]',
  DATA: '[--cap-top:var(--category-data-bg)] [--cap-side:var(--category-data-shadow)] [--cap-ink:var(--category-data)]',
  ASYNC: '[--cap-top:var(--category-async-bg)] [--cap-side:var(--category-async-shadow)] [--cap-ink:var(--category-async)]',
}

// 節點的實心偏移陰影色（SimNode 的 shadow 用 --cat-shadow）
export const CATEGORY_SHADOW: Record<Category, string> = {
  TRAFFIC: '[--cat-shadow:var(--category-traffic-shadow)]',
  COMPUTE: '[--cat-shadow:var(--category-compute-shadow)]',
  DATA: '[--cat-shadow:var(--category-data-shadow)]',
  ASYNC: '[--cat-shadow:var(--category-async-shadow)]',
}

export const CATEGORY_DOT: Record<Category, string> = {
  TRAFFIC: 'bg-traffic',
  COMPUTE: 'bg-compute',
  DATA: 'bg-data',
  ASYNC: 'bg-async',
}
