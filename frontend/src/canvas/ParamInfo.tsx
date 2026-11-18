import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatGuideRange, type ParamGuide } from './paramGuide'

type ParamInfoProps = {
  label: string
  guide: ParamGuide
  unit?: string
}

// 參數名稱後面的 ⓘ：滑過或用鍵盤聚焦時顯示常見範圍、說明和例子。
// 放在 Label 外面：按鈕包在 label 裡，點它會變成點輸入框
export function ParamInfo({ label, guide, unit }: ParamInfoProps) {
  const { range, note, example } = guide
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label}的說明`}
          className="shrink-0 rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="block">
        {range && <p className="font-semibold">常見：{formatGuideRange(range, unit)}</p>}
        <p>{note}</p>
        {example && <p className="mt-1 opacity-80">例：{example}</p>}
      </TooltipContent>
    </Tooltip>
  )
}
