// Envio de teste pelo módulo de e-mail do Site (src/email.ts: SDK oficial do Resend, remetente EMAIL_FROM).
//
//   node --import tsx scripts/testar-email.mjs <destinatário> [<destinatário> ...]
//   (ou: npm run email:testar -- <destinatário> ...)
//
// Lê RESEND_API_KEY e EMAIL_FROM do ambiente (não lê .env sozinho: use variáveis do processo ou node --env-file=...).
// Manda 1 e-mail de teste para cada destinatário, separado, para cada caixa ter o próprio resultado, e imprime só o id
// devolvido pelo Resend ou o erro dele (nome, status e mensagem, sem a chave).
// Saída: 0 todos aceitos pelo Resend; 1 algum erro do Resend; 2 uso errado; 3 envio não configurado (nada foi enviado).
import { configuracaoEmail, enviarEmail } from '../src/email.ts';

const destinatarios = process.argv.slice(2);
const formato = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
if (!destinatarios.length || destinatarios.some((d) => !formato.test(d))) {
  console.error('Uso: node --import tsx scripts/testar-email.mjs <destinatário> [<destinatário> ...]');
  const invalidos = destinatarios.filter((d) => !formato.test(d));
  if (invalidos.length) console.error(`Endereço inválido: ${invalidos.join(', ')}`);
  process.exit(2);
}

const { configurado, faltando } = configuracaoEmail();
if (!configurado) {
  console.error(`E-mail não configurado: falta ${faltando.join(' e ')} no ambiente. Nada foi enviado.`);
  process.exit(3);
}

const agora = new Date().toISOString();
let falhas = 0;
for (const para of destinatarios) {
  const r = await enviarEmail({
    para,
    assunto: '[teste] Envio de e-mail do Site institucional pelo Resend',
    texto: `Mensagem de teste do Site institucional (afirmaevias-site), enviada pelo módulo src/email.ts com o SDK do Resend em ${agora}. Pode ignorar.`,
    html: `<p>Mensagem de teste do Site institucional (afirmaevias-site), enviada pelo módulo <code>src/email.ts</code> com o SDK do Resend em ${agora}.</p><p>Pode ignorar.</p>`
  }, { ref: 'teste-manual' });
  if (r.ok) console.log(`${para}: id ${r.id}`);
  else {
    falhas++;
    const erro = r.motivo === 'erro_resend' ? `${r.erro.nome}${r.erro.status ? ` (HTTP ${r.erro.status})` : ''}: ${r.erro.mensagem}` : r.motivo;
    console.log(`${para}: ERRO ${erro}`);
  }
}
process.exit(falhas ? 1 : 0);
