import { Fragment } from 'react'
import {
  formatResult,
  groupSteps,
  hasTerms,
  substitutedFormula,
  symbolicFormula,
  type ExplanationStep,
} from './explanation'

type ExplanationStepsProps = {
  steps: ExplanationStep[]
  // 代入值來自別的節點時顯示它的名稱；找不到（例如已經刪掉）時只顯示數字
  nodeName: (id: string) => string | undefined
  onSelectNode: (id: string) => void
}

// 計算說明（spec 4.9）：依分組列出每一步，「名稱、公式、代入值、結果」各一行，窄的面板裡也不出現水平捲軸
export function ExplanationSteps({ steps, nodeName, onSelectNode }: ExplanationStepsProps) {
  return (
    <div className="grid gap-3">
      {groupSteps(steps).map(({ group, steps: grouped }, i) => (
        <section key={i} className="grid gap-2">
          <h4 className="text-xs font-semibold text-muted-foreground">{group}</h4>
          {grouped.map((step, j) => (
            <Step key={j} step={step} nodeName={nodeName} onSelectNode={onSelectNode} />
          ))}
        </section>
      ))}
    </div>
  )
}

function Step({ step, nodeName, onSelectNode }: { step: ExplanationStep } & Omit<ExplanationStepsProps, 'steps'>) {
  return (
    <div className="grid gap-0.5 border-l-2 pl-2 text-xs break-words">
      <div className="font-medium">{step.label}</div>
      {/* 沒有代入值的是純文字說明，例如過載時延遲沒有定義，只列文字和結果 */}
      <div className="text-muted-foreground">{symbolicFormula(step)}</div>
      {hasTerms(step) && (
        <div>
          ={' '}
          {substitutedFormula(step).map((part, i) => (
            <Fragment key={i}>
              {part.text}
              {part.kind === 'term' && part.nodeId != null && (
                <NodeLink id={part.nodeId} name={nodeName(part.nodeId)} onSelect={onSelectNode} />
              )}
            </Fragment>
          ))}
        </div>
      )}
      <div className="font-semibold">= {formatResult(step)}</div>
    </div>
  )
}

// 代入值旁邊的節點名稱，點了就選取那個節點，屬性面板換成它的算式
function NodeLink({ id, name, onSelect }: { id: string; name: string | undefined; onSelect: (id: string) => void }) {
  if (name === undefined) return null
  return (
    <button
      type="button"
      className="text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
      title={`選取 ${name}，看它的算式`}
      onClick={() => onSelect(id)}
    >
      （{name}）
    </button>
  )
}
