/** Erro esperado, com status HTTP e código estável para o front-end. */
export class AppError extends Error {
  constructor(status, code, message, details, headers) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
    this.headers = headers
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details)
export const unauthorized = (message = 'É preciso entrar para continuar.') => new AppError(401, 'UNAUTHENTICATED', message)
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'FORBIDDEN', message)
export const notFound = (message = 'Recurso não encontrado.') => new AppError(404, 'NOT_FOUND', message)
