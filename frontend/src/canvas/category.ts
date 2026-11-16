import type { Category } from './catalog'

// 元件類別色（index.css 的變數，兩個主題各自調深淺），元件面板的組名圓點和 CategoryIcon 的圖示方塊共用

export const CATEGORY_TILE: Record<Category, string> = {
  TRAFFIC: 'bg-traffic-bg text-traffic',
  COMPUTE: 'bg-compute-bg text-compute',
  DATA: 'bg-data-bg text-data',
  ASYNC: 'bg-async-bg text-async',
}

export const CATEGORY_DOT: Record<Category, string> = {
  TRAFFIC: 'bg-traffic',
  COMPUTE: 'bg-compute',
  DATA: 'bg-data',
  ASYNC: 'bg-async',
}
