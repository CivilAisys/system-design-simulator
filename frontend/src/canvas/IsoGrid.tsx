import { useStore, type ReactFlowState } from '@xyflow/react'

// 線和線的距離（px，縮放 100% 時）
const GAP = 32
const ANGLES = [30, -30]

const transformSelector = (state: ReactFlowState) => state.transform

// 畫布的等角菱形格線：±30° 兩組平行細線（spec 第 6 節）。
// React Flow 的 Background 只有點、直線和十字，這裡照它的做法用 SVG pattern，跟著平移和縮放移動
export function IsoGrid() {
  const [x, y, zoom] = useStore(transformSelector)
  return (
    <svg aria-hidden className="react-flow__background absolute inset-0 size-full">
      <defs>
        {ANGLES.map((angle) => (
          <pattern
            key={angle}
            id={`iso-grid${angle}`}
            patternUnits="userSpaceOnUse"
            width={GAP}
            height={GAP}
            patternTransform={`translate(${x} ${y}) scale(${zoom}) rotate(${angle})`}
          >
            {/* 線放在格子中間：貼著邊會被格子裁掉一半。縮放時線寬維持 1px */}
            <line
              x1={0}
              y1={GAP / 2}
              x2={GAP}
              y2={GAP / 2}
              style={{ stroke: 'var(--paper-grid)' }}
              strokeWidth={1 / zoom}
            />
          </pattern>
        ))}
      </defs>
      {ANGLES.map((angle) => (
        <rect key={angle} width="100%" height="100%" fill={`url(#iso-grid${angle})`} />
      ))}
    </svg>
  )
}
