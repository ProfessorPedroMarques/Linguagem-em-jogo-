/**
 * Envio de e-mails. Ainda NÃO há SMTP configurado:
 *  - desenvolvimento: a mensagem é impressa no terminal (para você copiar o link de recuperação);
 *  - testes: fica em `outbox`;
 *  - produção: nada é enviado e um aviso é registrado (sem o conteúdo da mensagem).
 */
export function createMailer({ config, logger }) {
  const outbox = []
  return {
    outbox,
    async send({ to, subject, text }) {
      if (config.env === 'test') {
        outbox.push({ to, subject, text })
        return
      }
      if (config.env === 'development') {
        console.log(`\n[e-mail de desenvolvimento]\nPara: ${to}\nAssunto: ${subject}\n${text}\n`)
        return
      }
      logger.warn('Envio de e-mail não configurado: mensagem descartada.', { subject })
    },
  }
}
