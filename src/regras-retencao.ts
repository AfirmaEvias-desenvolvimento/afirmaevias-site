// Prazos de descarte, separados da execução de propósito: aqui não há acesso a
// banco nem a configuração, então o teste consegue importar as regras sozinhas
// e conferir a forma de cada uma sem precisar de um Postgres.
//
// Os prazos espelham a seção "Por quanto tempo guardamos" de content.ts.
// Mudou lá, mude aqui — há teste cobrando essa correspondência.
type Regra = { rotulo: string; sql: string };

export const REGRAS: Regra[] = [
  {
    rotulo: 'currículos com mais de 12 meses',
    sql: `DELETE FROM candidaturas WHERE criado_em < now() - interval '12 months'`
  },
  {
    rotulo: 'contatos comerciais com mais de 24 meses',
    sql: `DELETE FROM contatos WHERE criado_em < now() - interval '24 months'`
  },
  {
    // o Marco Civil pede 6 meses de guarda; passado o prazo o IP deixa de ser
    // necessario, entao some so a coluna e o registro em si e preservado
    rotulo: 'IPs de contato com mais de 6 meses',
    sql: `UPDATE contatos SET ip = NULL, user_agent = NULL
           WHERE ip IS NOT NULL AND criado_em < now() - interval '6 months'`
  },
  {
    rotulo: 'IPs de candidatura com mais de 6 meses',
    sql: `UPDATE candidaturas SET ip = NULL, user_agent = NULL
           WHERE ip IS NOT NULL AND criado_em < now() - interval '6 months'`
  },
  {
    rotulo: 'requisições de titular com mais de 5 anos',
    sql: `DELETE FROM solicitacoes_lgpd WHERE criado_em < now() - interval '5 years'`
  },
  {
    // o freio de login usa janela de 15 minutos; guardar mais que um dia so
    // faria a tabela crescer sem servir para nada
    rotulo: 'tentativas de login com mais de 24 horas',
    sql: `DELETE FROM tentativas_login WHERE criado_em < now() - interval '24 hours'`
  },
  {
    // trilha de auditoria do /admin: guarda e-mail e IP de quem agiu no painel.
    // 12 meses cobre a apuracao de qualquer incidente recente; antes a tabela
    // crescia sem limite. Prazo proposto, a confirmar com o dono.
    rotulo: 'trilha de auditoria do painel com mais de 12 meses',
    sql: `DELETE FROM auditoria WHERE criado_em < now() - interval '12 months'`
  },
  {
    rotulo: 'consentimentos de cookies com mais de 5 anos',
    sql: `DELETE FROM consentimentos_cookies WHERE criado_em < now() - interval '5 years'`
  },
  {
    // Painel Infra (src/wallpaper.ts): id da conta do painel + hora, so para a metrica agregada. A serie mostra 24 h;
    // 7 dias bastam. A coluna de data desta tabela e `hora` (inicio da hora em UTC), nao criado_em.
    rotulo: 'atividade por hora das contas do painel com mais de 7 dias',
    sql: `DELETE FROM atividade_usuario_hora WHERE hora < now() - interval '7 days'`
  }
];

// Relatos de integridade nao entram: o prazo conta a partir do fim da apuracao,
// que e decisao humana registrada no painel, nao data de criacao.
