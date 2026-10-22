import type { ErrorCode } from '../../../../shared/types'

// 서버의 에러 응답({ error: { code, message } })을 담는다. 화면은 code로 분기하고 message를 그대로 보여 준다 (API.md 공통 규칙)
export class ApiRequestError extends Error {
  code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
