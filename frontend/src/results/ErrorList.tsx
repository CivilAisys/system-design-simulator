import { CircleAlert } from 'lucide-react'
import type { ValidationError } from '@/api/client'
import { cn } from '@/lib/utils'

type ErrorListProps = {
  errors: ValidationError[]
  // 錯誤指到的節點或邊還在畫布上時才能聚焦（結果可能比畫布舊，NO_CLIENT 沒有指到任何東西）
  canFocus: (error: ValidationError) => boolean
  onFocus: (error: ValidationError) => void
}

export function ErrorList({ errors, canFocus, onFocus }: ErrorListProps) {
  if (errors.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">沒有驗證錯誤</p>
  }
  return (
    <ul className="divide-y text-sm">
      {errors.map((error, i) => {
        const focusable = canFocus(error)
        return (
          // 同一個節點可能有多個錯誤，id 不唯一
          <li key={i}>
            <button
              type="button"
              disabled={!focusable}
              onClick={() => onFocus(error)}
              title={focusable ? '在畫布上聚焦' : undefined}
              className={cn(
                'flex w-full items-start gap-2 px-3 py-2 text-left',
                focusable && 'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
              )}
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span className="min-w-0 flex-1">{error.message}</span>
              <code className="shrink-0 text-xs text-muted-foreground">{error.code}</code>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
