<<<<<<< HEAD
# Linguagem em Jogo — Back-end (Etapa 1)

API modular em Node.js com SQLite. **Sem dependências externas**: usa apenas módulos nativos do Node (`http`, `crypto`, `node:sqlite`, `node:test`). Não há `npm install` a fazer.

Requisito: **Node.js 22.13 ou superior** (confira com `node -v`).

## Como rodar (Windows ou Linux)

Dentro da pasta `server`:

```
copy .env.example .env        (no Linux/macOS: cp .env.example .env)
npm run migrate
npm run seed
npm run dev
```

- `npm run seed` cria o administrador e um professor de demonstração e mostra as senhas **uma única vez** no terminal. Anote-as.
- A API sobe em `http://127.0.0.1:3001`. Teste em `http://127.0.0.1:3001/api/health`.
- A documentação dos endpoints (OpenAPI) fica em `http://127.0.0.1:3001/api/docs.json`; para ver em formato visual, cole o conteúdo em https://editor.swagger.io.
- `npm test` executa os testes automatizados.

## Ligando ao front-end (desenvolvimento)

No `vite.config.js` do front-end, acrescente o proxy para que o navegador fale com a API na mesma origem:

```js
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
})
```

Assim o front chama `fetch('/api/auth/login', { method: 'POST', credentials: 'include', ... })` sem problemas de CORS. A conexão das telas à API será feita na etapa de integração.

## Arquitetura

Um processo, módulos separados. Cada "serviço" do plano é um módulo em `src/modules/` com rotas e regras próprias, e a camada `src/app.js` faz o papel de **gateway** (CORS, limite de requisições, identificador de requisição, autenticação, erros padronizados).

```
src/
  app.js            gateway: pipeline de cada requisição
  config.js         variáveis de ambiente (.env)
  index.js          inicia o servidor
  openapi.js        documentação dos endpoints
  db/               conexão SQLite, migrações (.sql), seed
  lib/              router, validação, segurança, limite, logs, auditoria, e-mail
  modules/
    health/  auth/  admin/        (etapa 1)
```

Os módulos seguintes entram na mesma estrutura, nas próximas etapas: estudantes e turmas, biblioteca de textos, adaptação de textos, atividades, progresso e relatórios, narração, preferências de acessibilidade.

## Endpoints da etapa 1

| Método | Rota | Acesso |
|---|---|---|
| GET | `/api/health` | público |
| POST | `/api/auth/register` | público (professor ou responsável) |
| POST | `/api/auth/login` | público (e-mail ou código de acesso) |
| POST | `/api/auth/logout` | sessão |
| GET | `/api/auth/me` | sessão |
| POST | `/api/auth/change-password` | sessão |
| POST | `/api/auth/forgot-password` | público |
| POST | `/api/auth/reset-password` | público (com token) |
| GET | `/api/admin/audit-logs` | administrador |

Respostas: `{ "data": ..., "meta"?: ... }` em caso de sucesso; `{ "error": { "code", "message", "details"? }, "requestId" }` em caso de erro.

## Decisões de segurança

- **Senhas**: hash `scrypt` com salt aleatório; nunca em texto puro. Política: 8 a 128 caracteres, sem senhas comuns.
- **Sessão**: token aleatório em cookie `HttpOnly` + `SameSite=Lax` (`Secure` em produção). No banco fica só o SHA-256 do token. Nada de token em `localStorage`. Expira em 8 h e por inatividade (2 h); logout e troca de senha revogam sessões.
- **Força bruta**: 5 falhas por identificador bloqueiam o login por 15 min (as falhas guardam só o hash do identificador); limite de requisições por IP, mais rígido nas rotas de autenticação.
- **Sem enumeração de contas**: erro de login igual para e-mail inexistente e senha errada (com gasto de tempo equivalente); recuperação de senha responde igual exista ou não o e-mail.
- **CSRF**: `Origin` conferida em métodos que alteram dados, mais exigência de `application/json` e cookie `SameSite=Lax`.
- **Entrada**: validação no servidor, SQL sempre parametrizado, limite de 100 KB por requisição.
- **Logs e auditoria**: JSON estruturado; senhas, tokens, cookies e e-mails nunca são gravados; a query string não vai para o log.
- **Papéis**: `admin`, `teacher`, `guardian`, `student`. Não é possível se cadastrar como administrador ou estudante.

## Limitações conhecidas (etapa 1)

- **E-mail**: não há SMTP. Em desenvolvimento o link de recuperação aparece no terminal; em produção a mensagem é descartada. Verificação de e-mail ainda não existe (a coluna `email_verified_at` está reservada).
- **Estudantes**: o acesso simplificado por código (criado pelo professor) entra na etapa de turmas e estudantes.
- **Limites de requisição** ficam em memória: valem para uma única instância.
- **Bloqueio por identificador** pode ser usado para travar a conta de outra pessoa por 15 minutos (a redefinição de senha desbloqueia). É um compromisso conhecido.
- **Proxy reverso**: só defina `TRUST_PROXY=true` se houver um proxy confiável na frente.
- **Backup**: o banco é o arquivo `data/linguagem.db`. Para copiar com a API parada, basta copiar o arquivo (e os arquivos `-wal`/`-shm`, se existirem). Para cópia com a API ligada, use `VACUUM INTO 'backup.db'` pelo SQLite.
- Esta etapa **não** foi conectada às telas do front-end.

## Migração para PostgreSQL

O SQL das migrações usa recursos simples. Para PostgreSQL, ajuste `datetime('now')`, `AUTOINCREMENT` e `COLLATE NOCASE`, e troque a camada `db/connection.js`.
=======
# Linguagem-em-jogo-
Plataforma educacional inclusiva e interativa que transforma a alfabetização em uma aventura! O Linguagem em Jogo utiliza atividades progressivas, narrador por voz e um mascote virtual para desenvolver consciência fonológica, junção silábica, formação de palavras e interpretação de textos, respeitando o ritmo e as necessidades de cada criança
>>>>>>> 4cdac8edcc69f78a49c8c898890c0230f124c58d
