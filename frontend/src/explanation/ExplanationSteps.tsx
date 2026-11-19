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

// 計算說明（spec 4.9）：依分組列出，每一步一行「名稱 = 公式 = 代入值 = 結果」，太長時換行，不出現水平捲軸
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
  const result = <span className="font-semibold">{formatResult(step)}</span>
  return (
    <p className="border-l-2 pl-2 text-xs leading-relaxed break-words">
      <span className="font-medium">{step.label}</span>
      {hasTerms(step) ? (
        <>
          {' = '}
          <span className="text-muted-foreground">{symbolicFormula(step)}</span>
          {' = '}
          {substitutedFormula(step).map((part, i) => (
            <Fragment key={i}>
              {part.text}
              {part.kind === 'term' && part.nodeId != null && (
                <NodeLink id={part.nodeId} name={nodeName(part.nodeId)} onSelect={onSelectNode} />
              )}
            </Fragment>
          ))}
          {' = '}
          {result}
        </>
      ) : (
        // 純文字說明，例如過載時延遲沒有定義：結果後面接著說明
        <>
          {' = '}
          {result}
          <span className="text-muted-foreground">（{step.formula}）</span>
        </>
      )}
    </p>
  )
}

// 代入值旁邊的節點名稱，點了就選取那個節點，屬性面板換成它的算式
function NodeLink({ id, name, onSelect }: { id: string; name: string | undefined; onSelect: (id: string) => void }) {
  if (name === undefined) return null
  return (
    <button
      type="button"
      className="rounded-sm text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      title={`選取 ${name}，看它的算式`}
      onClick={() => onSelect(id)}
    >
      （{name}）
    </button>
  )
}
