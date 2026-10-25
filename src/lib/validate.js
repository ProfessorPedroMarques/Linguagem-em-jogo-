import { AppError } from './errors.js'
import { passwordProblem } from './security.js'

// Cada regra recebe o valor e devolve o valor limpo, ou lança uma STRING com a mensagem de erro.

export const rules = {
  string({ min = 1, max = 255, trim = true } = {}) {
    return (value) => {
      if (typeof value !== 'string') throw 'Informe um texto.'
      const text = trim ? value.trim() : value
      if (text.length < min) throw min === 1 ? 'Campo obrigatório.' : `Use pelo menos ${min} caracteres.`
      if (text.length > max) throw `Use no máximo ${max} caracteres.`
      return text
    }
  },
  email() {
    return (value) => {
      if (typeof value !== 'string') throw 'Informe um e-mail.'
      const email = value.trim().toLowerCase()
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw 'Informe um e-mail válido.'
      return email
    }
  },
  oneOf(options) {
    return (value) => {
      if (!options.includes(value)) throw `Valor inválido. Use: ${options.join(', ')}.`
      return value
    }
  },
  /** Senha nova: aplica a política de senhas. */
  newPassword(context = () => ({})) {
    return (value, input) => {
      const problem = passwordProblem(value, context(input))
      if (problem) throw problem
      return value
    }
  },
  /** Senha atual/de login: só checa tamanho (não revela a política). */
  anyPassword() {
    return (value) => {
      if (typeof value !== 'string' || value.length === 0) throw 'Informe a senha.'
      if (value.length > 128) throw 'Senha muito longa.'
      return value
    }
  },
  integer({ min = -Infinity, max = Infinity, fallback } = {}) {
    return (value) => {
      if ((value === undefined || value === '') && fallback !== undefined) return fallback
      const n = Number(value)
      if (!Number.isInteger(n)) throw 'Informe um número inteiro.'
      if (n < min || n > max) throw `Use um valor entre ${min} e ${max}.`
      return n
    }
  },
}

/** Valida `input` conforme o esquema e devolve apenas os campos esperados. */
export function validate(schema, input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const out = {}
  const details = []
  for (const [field, rule] of Object.entries(schema)) {
    try {
      out[field] = rule(source[field], source)
    } catch (err) {
      if (typeof err === 'string') details.push({ field, message: err })
      else throw err
    }
  }
  if (details.length) throw new AppError(422, 'VALIDATION_ERROR', 'Verifique os campos informados.', details)
  return out
}
