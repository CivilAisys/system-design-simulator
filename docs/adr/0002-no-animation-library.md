# 動畫用 SVG 和 CSS，不用 Motion

spec 第 9 節 2026-11-12 的決策把 Motion 列進 UI 技術選型。實作階段一的畫布效果（流量粒子、節點發光、`OVERLOADED` 脈動）時，SVG 的 `animateMotion` 和 Tailwind 的 CSS animation 就夠用，所以從來沒有安裝 Motion。這份紀錄取代那一列裡的 Motion，其餘部分（shadcn/ui、Tailwind v4、ECharts）不變。

階段二要做數字過場、丟棄動畫這類需要 JS 控制時間軸的效果時，再重新評估要不要引入動畫函式庫。
