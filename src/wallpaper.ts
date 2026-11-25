// Painel Infra (papel de parede da segunda tela): GET /api/wallpaper/usuarios devolve só números agregados das contas do
// painel /admin (as únicas contas com login no site; visitantes, leads e candidatos não contam). Chamado de servidor para
// servidor a cada 5 minutos, com `Authorization: Bearer <WALLPAPER_STATS_TOKEN>`.
//
// - Sem a variável, ou com menos de 32 caracteres, a rota responde sempre 401: nunca fica aberta. Comparação em tempo
//   constante (sha-256 dos dois lados + timingSafeEqual, para o tamanho também não vazar).
// - O Bearer é a única autenticação: sem sessão, cookie, CSRF ou aceite. Sem CORS (o site não registra plugin de CORS).
// - Fora do rate limit (`rateLimit: false`) e sem log de acesso (`logLevel: 'silent'`). Cache de 60 s em memória.
// - Resposta: id, nome, gerado_em, total_usuarios, ativos_24h e serie_24h (24 horas cheias em UTC, a última é a atual).
//   Nunca nome, e-mail ou id de conta.
//
// O registro de atividade (tabela atividade_usuario_hora: id da conta + início da hora) é feito em src/auth.ts, no ponto
// em que a sessão é reconhecida e no login, uma gravação por conta e hora, sem segurar a resposta. Este módulo não importa
// config nem banco: quem chama passa o banco (o pool em produção, um Postgres temporário ou um falso nos testes).
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

type Banco = { query: (sql: string, parametros?: unknown[]) => Promise<{ rows: any[] }> };

export const ROTA_WALLPAPER = '/api/wallpaper/usuarios';
export const ID_SISTEMA = 'institucional';
export const NOME_SISTEMA = 'Site';
export const TOKEN_MINIMO = 32;
const CACHE_MS = 60_000;
const HORA_MS = 3_600_000;

export type PontoSerie = { hora: string; ativos: number };
export type EstatisticasUsuarios = {
  id: string;
  nome: string;
  gerado_em: string;
  total_usuarios: number;
  ativos_24h: number;
  serie_24h: PontoSerie[];
};

/** Início da hora em UTC (epoch em ms). */
export const inicioDaHora = (ms: number) => Math.floor(ms / HORA_MS) * HORA_MS;

/** ISO 8601 em UTC com Z, sem milissegundos (2026-11-25T12:00:00Z). */
export const isoUtc = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';

const resumo = (texto: string) => crypto.createHash('sha256').update(texto, 'utf8').digest();

/**
 * `Authorization: Bearer <token>` confere com o segredo? Segredo ausente ou com menos de 32 caracteres: sempre não.
 * Os dois lados passam por sha-256 antes do timingSafeEqual, então nem o tamanho do token recebido muda o tempo.
 */
export function tokenConfere(cabecalho: string | undefined, segredo: string | undefined): boolean {
  if (!segredo || segredo.length < TOKEN_MINIMO) return false;
  const achado = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(cabecalho ?? '');
  const recebido = achado?.[1] ?? '';
  const iguais = crypto.timingSafeEqual(resumo(recebido), resumo(segredo));
  return iguais && recebido.length > 0;
}

/**
 * Registro de atividade: uma linha por conta e hora (INSERT ... ON CONFLICT DO NOTHING). Os pares conta:hora já gravados
 * ficam em memória e a lista é limpa quando a hora vira, então só a primeira requisição autenticada de cada hora vai ao
 * banco. A função volta na hora (não devolve promessa): a gravação corre por fora e uma falha não derruba a requisição; o
 * par sai da lista para a próxima requisição tentar de novo, e o aviso no log sai no máximo uma vez por hora, sem dado da
 * conta.
 */
export function criarRegistroAtividade(banco: Banco, agora: () => number = Date.now, avisar: (msg: string) => void = console.warn) {
  let horaDaLista = -1;
  let avisoNaHora = -1;
  const gravados = new Set<string>();
  return function registrarAtividade(usuarioId: string): void {
    const hora = inicioDaHora(agora());
    if (hora !== horaDaLista) {
      gravados.clear();
      horaDaLista = hora;
    }
    const chave = `${usuarioId}:${hora}`;
    if (gravados.has(chave)) return;
    gravados.add(chave);
    let pendente: Promise<unknown>;
    try {
      pendente = banco.query('INSERT INTO atividade_usuario_hora (usuario_id, hora) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        usuarioId,
        new Date(hora).toISOString()
      ]);
    } catch (erro) {
      pendente = Promise.reject(erro);
    }
    pendente.catch((erro: unknown) => {
      gravados.delete(chave);
      if (avisoNaHora === hora) return;
      avisoNaHora = hora;
      avisar(`[aviso] wallpaper: registro de atividade falhou (${erro instanceof Error ? erro.message : 'erro'})`);
    });
  };
}

/**
 * Contagens no banco. A janela é a hora atual (parcial) e as 23 anteriores, calculadas pelo relógio do processo, o mesmo
 * do registro. Só entram contas ativas (admin_usuarios.ativo): uma conta desativada sai do total e da atividade, o que
 * mantém ativos_24h <= total_usuarios e cada ponto da série <= ativos_24h.
 */
export async function calcularEstatisticas(banco: Banco, agoraMs: number): Promise<EstatisticasUsuarios> {
  const horaAtual = inicioDaHora(agoraMs);
  const inicio = horaAtual - 23 * HORA_MS;
  const faixa = [new Date(inicio).toISOString(), new Date(horaAtual).toISOString()];
  const ativas = `FROM atividade_usuario_hora a JOIN admin_usuarios u ON u.id = a.usuario_id
                 WHERE u.ativo AND a.hora BETWEEN $1::timestamptz AND $2::timestamptz`;
  // em sequência: o banco pode ser um Client só (sem consultas simultâneas); cada uma leva poucos ms
  const totais = await banco.query(
    `SELECT (SELECT count(*) FROM admin_usuarios WHERE ativo)::int AS total_usuarios,
            (SELECT count(DISTINCT a.usuario_id) ${ativas})::int AS ativos_24h`,
    faixa
  );
  const porHora = await banco.query(`SELECT a.hora, count(DISTINCT a.usuario_id)::int AS ativos ${ativas} GROUP BY a.hora`, faixa);
  const mapa = new Map<number, number>();
  for (const linha of porHora.rows) mapa.set(new Date(linha.hora).getTime(), Number(linha.ativos) || 0);
  const serie: PontoSerie[] = [];
  for (let i = 0; i < 24; i++) {
    const hora = inicio + i * HORA_MS;
    serie.push({ hora: isoUtc(hora), ativos: mapa.get(hora) ?? 0 });
  }
  return {
    id: ID_SISTEMA,
    nome: NOME_SISTEMA,
    gerado_em: isoUtc(agoraMs),
    total_usuarios: Number(totais.rows[0]?.total_usuarios) || 0,
    ativos_24h: Number(totais.rows[0]?.ativos_24h) || 0,
    serie_24h: serie
  };
}

/** Registra GET /api/wallpaper/usuarios. O segredo é lido a cada chamada (padrão: process.env.WALLPAPER_STATS_TOKEN). */
export function rotaWallpaper(
  app: FastifyInstance,
  opcoes: { banco: Banco; segredo?: () => string | undefined; agora?: () => number }
) {
  const segredo = opcoes.segredo ?? (() => process.env.WALLPAPER_STATS_TOKEN);
  const agora = opcoes.agora ?? Date.now;
  let cache: { expira: number; corpo: EstatisticasUsuarios } | null = null;
  let emAndamento: Promise<EstatisticasUsuarios> | null = null;

  app.get(ROTA_WALLPAPER, { logLevel: 'silent', config: { rateLimit: false } }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!tokenConfere(request.headers.authorization, segredo())) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ erro: 'nao_autorizado' });
    }
    const instante = agora();
    if (cache && instante < cache.expira) return cache.corpo;
    try {
      emAndamento ??= calcularEstatisticas(opcoes.banco, instante).finally(() => {
        emAndamento = null;
      });
      const corpo = await emAndamento;
      cache = { expira: instante + CACHE_MS, corpo };
      return corpo;
    } catch {
      return reply.code(503).send({ erro: 'indisponivel' });
    }
  });
}
