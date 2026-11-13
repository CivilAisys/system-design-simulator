import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialTopology } from '@/canvas/initialTopology'
import { isAbortError, simulate } from './client'

// client 的 baseUrl 是空字串，靠瀏覽器用頁面網址補齊；Node 的 Request 不接受相對網址。
// openapi-fetch 建立 client 時就記下 globalThis.Request，所以要在 import 之前換掉
vi.hoisted(() => {
  const BaseRequest = globalThis.Request
  globalThis.Request = class extends BaseRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, 'http://localhost') : input, init)
    }
  }
})

const fetchMock = vi.fn<(request: Request) => Promise<Response>>()

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } })
}

describe('simulate', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功時回傳後端的結果', async () => {
    const body = { valid: true, errors: [], summary: null, nodes: [], edges: [] }
    fetchMock.mockResolvedValue(jsonResponse(200, body))

    await expect(simulate(initialTopology)).resolves.toEqual(body)
  })

  it('連線失敗時提示確認後端是否已啟動', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(simulate(initialTopology)).rejects.toThrow('連不到後端，請確認後端是否已啟動')
  })

  it.each([502, 503, 504])('proxy 回 %i 時也當成連不到後端', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status, headers: { 'Content-Type': 'text/plain' } }))

    await expect(simulate(initialTopology)).rejects.toThrow('連不到後端，請確認後端是否已啟動')
  })

  it('後端回 400 時顯示 ProblemDetail 的 detail', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { title: 'Bad Request', detail: 'Invalid value for nodes[0].params.rps' }, 'application/problem+json'),
    )

    await expect(simulate(initialTopology)).rejects.toThrow('Invalid value for nodes[0].params.rps')
  })

  it('其他錯誤狀態碼沒有說明時顯示狀態碼', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    await expect(simulate(initialTopology)).rejects.toThrow('Run 失敗（HTTP 500）')
  })

  it('取消時丟出 AbortError，不包成連不到後端', async () => {
    fetchMock.mockImplementation(
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason))
        }),
    )
    const controller = new AbortController()

    const pending = simulate(initialTopology, controller.signal)
    controller.abort()

    const error = await pending.catch((e: unknown) => e)
    expect(isAbortError(error)).toBe(true)
  })
})
