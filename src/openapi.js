const errorResponse = {
  description: 'Erro padronizado',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
            },
          },
          requestId: { type: 'string' },
        },
      },
    },
  },
}

const json = (schema) => ({ 'application/json': { schema } })
const userRef = { $ref: '#/components/schemas/User' }
const userResponse = { description: 'Usuário', content: json({ type: 'object', properties: { data: { type: 'object', properties: { user: userRef } } } }) }

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Linguagem em Jogo — API',
    version: '0.1.0',
    description: 'Etapa 1: saúde, autenticação e auditoria. Sessão por cookie HttpOnly. Respostas: { data, meta? } ou { error, requestId }.',
  },
  servers: [{ url: 'http://localhost:3001' }],
  components: {
    securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: 'lj_session' } },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string', nullable: true },
          loginCode: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['admin', 'teacher', 'guardian', 'student'] },
          isDemo: { type: 'boolean' },
          createdAt: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/api/health': { get: { summary: 'Verifica API e banco', responses: { 200: { description: 'ok' }, 503: errorResponse } } },
    '/api/auth/register': {
      post: {
        summary: 'Cadastro de professor ou responsável (e abre a sessão)',
        requestBody: { required: true, content: json({ type: 'object', required: ['name', 'email', 'password', 'role'], properties: { name: { type: 'string' }, email: { type: 'string' }, password: { type: 'string', minLength: 8 }, role: { type: 'string', enum: ['teacher', 'guardian'] } } }) },
        responses: { 201: userResponse, 403: errorResponse, 409: errorResponse, 422: errorResponse },
      },
    },
    '/api/auth/login': {
      post: {
        summary: 'Entrar (e-mail ou código de acesso)',
        requestBody: { required: true, content: json({ type: 'object', required: ['identifier', 'password'], properties: { identifier: { type: 'string' }, password: { type: 'string' } } }) },
        responses: { 200: userResponse, 401: errorResponse, 429: errorResponse },
      },
    },
    '/api/auth/logout': { post: { summary: 'Encerra a sessão atual', responses: { 204: { description: 'Sessão encerrada' } } } },
    '/api/auth/me': { get: { summary: 'Usuário da sessão', security: [{ sessionCookie: [] }], responses: { 200: userResponse, 401: errorResponse } } },
    '/api/auth/change-password': {
      post: {
        summary: 'Altera a senha (encerra as outras sessões)',
        security: [{ sessionCookie: [] }],
        requestBody: { required: true, content: json({ type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } } }) },
        responses: { 200: { description: 'Senha alterada' }, 401: errorResponse, 422: errorResponse },
      },
    },
    '/api/auth/forgot-password': {
      post: {
        summary: 'Pede link de recuperação (resposta igual exista ou não o e-mail)',
        requestBody: { required: true, content: json({ type: 'object', required: ['email'], properties: { email: { type: 'string' } } }) },
        responses: { 202: { description: 'Solicitação recebida' }, 422: errorResponse },
      },
    },
    '/api/auth/reset-password': {
      post: {
        summary: 'Define nova senha com o token recebido por e-mail',
        requestBody: { required: true, content: json({ type: 'object', required: ['token', 'password'], properties: { token: { type: 'string' }, password: { type: 'string' } } }) },
        responses: { 200: { description: 'Senha redefinida' }, 400: errorResponse, 422: errorResponse },
      },
    },
    '/api/admin/audit-logs': {
      get: {
        summary: 'Trilha de auditoria (somente administrador)',
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        ],
        responses: { 200: { description: 'Lista paginada' }, 401: errorResponse, 403: errorResponse },
      },
    },
  },
}
