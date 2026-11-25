import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { consultar, consultarUm, pool } from './db.js';
import { producao } from './config.js';
import { criarRegistroAtividade } from './wallpaper.js';

export const COOKIE_SESSAO = 'ae_sessao';
const DURACAO_HORAS = 12;

// Painel Infra (src/wallpaper.ts): marca a conta como ativa na hora corrente. Uma gravação por conta e hora, sem segurar
// a resposta e sem derrubar a requisição se o banco falhar.
const registrarAtividade = criarRegistroAtividade(pool);

export type UsuarioAdmin = {
  id: string;
  nome: string;
  email: string;
  papel: string;
  ativo: boolean;
};

export async function gerarHashSenha(senha: string) {
  return bcrypt.hash(senha, 12);
}

// Hash descartavel, so para gastar tempo. Sem ele, um e-mail inexistente
// respondia na hora e um e-mail real levava os ~264ms do bcrypt: a diferenca e
// visivel pela rede e revela quais enderecos sao administradores. Comparar
// contra este hash iguala os dois caminhos.
const HASH_DE_ESPERA = bcrypt.hashSync('comparacao-de-tempo-constante', 12);

export async function autenticar(email: string, senha: string): Promise<UsuarioAdmin | null> {
  const usuario = await consultarUm<UsuarioAdmin & { senha_hash: string }>(
    'SELECT id, nome, email, papel, ativo, senha_hash FROM admin_usuarios WHERE lower(email) = lower($1)',
    [email.trim()]
  );
  if (!usuario || !usuario.ativo) {
    await bcrypt.compare(senha, HASH_DE_ESPERA);
    return null;
  }
  const confere = await bcrypt.compare(senha, usuario.senha_hash);
  if (!confere) return null;
  return { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel, ativo: usuario.ativo };
}

export async function abrirSessao(reply: FastifyReply, usuario: UsuarioAdmin, ip: string, userAgent: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DURACAO_HORAS * 3600 * 1000);
  await consultar(
    'INSERT INTO admin_sessoes (token, usuario_id, ip, user_agent, expira_em) VALUES ($1,$2,$3,$4,$5)',
    [token, usuario.id, ip, userAgent.slice(0, 400), expira]
  );
  await consultar('UPDATE admin_usuarios SET ultimo_acesso = now() WHERE id = $1', [usuario.id]);
  registrarAtividade(usuario.id);
  reply.setCookie(COOKIE_SESSAO, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: producao,
    signed: true,
    maxAge: DURACAO_HORAS * 3600
  });
}

export async function fecharSessao(request: FastifyRequest, reply: FastifyReply) {
  const bruto = request.cookies[COOKIE_SESSAO];
  if (bruto) {
    const aberto = request.unsignCookie(bruto);
    if (aberto.valid && aberto.value) {
      await consultar('DELETE FROM admin_sessoes WHERE token = $1', [aberto.value]);
    }
  }
  reply.clearCookie(COOKIE_SESSAO, { path: '/' });
}

export async function usuarioDaRequisicao(request: FastifyRequest): Promise<UsuarioAdmin | null> {
  const bruto = request.cookies[COOKIE_SESSAO];
  if (!bruto) return null;
  const aberto = request.unsignCookie(bruto);
  if (!aberto.valid || !aberto.value) return null;
  const linha = await consultarUm<UsuarioAdmin>(
    `SELECT u.id, u.nome, u.email, u.papel, u.ativo
       FROM admin_sessoes s
       JOIN admin_usuarios u ON u.id = s.usuario_id
      WHERE s.token = $1 AND s.expira_em > now() AND u.ativo = TRUE`,
    [aberto.value]
  );
  if (linha) registrarAtividade(linha.id);
  return linha;
}

export async function limparSessoesExpiradas() {
  await consultar('DELETE FROM admin_sessoes WHERE expira_em < now()');
}

// ------------------------------------------------------------ freio por conta
//
// O limite do @fastify/rate-limit conta por IP. Quem tem muitos IPs contorna,
// e o alvo obvio e a conta de administrador. Aqui a contagem e por e-mail.
//
// Duas decisoes deliberadas:
//
// 1. A janela expira sozinha. Nao ha bloqueio permanente nem desbloqueio
//    manual, porque conta travada de vez transforma o freio em negacao de
//    servico contra o proprio administrador - basta o atacante errar de
//    proposito para deixar a equipe de fora.
//
// 2. A contagem usa o e-mail digitado, exista ou nao. Contar so para contas
//    reais faria o site responder diferente para e-mail existente e inventado,
//    o que devolveria a enumeracao de usuario pela porta dos fundos.
const LIMITE_POR_CONTA = 8;
const JANELA_MINUTOS = 15;

export async function registrarTentativaFalha(email: string, ip: string) {
  await consultar('INSERT INTO tentativas_login (email, ip) VALUES (lower($1), $2)', [email.trim(), ip]);
}

export async function contaEstaFreada(email: string) {
  const linha = await consultarUm<{ total: string }>(
    `SELECT count(*) AS total FROM tentativas_login
      WHERE email = lower($1) AND criado_em > now() - ($2 || ' minutes')::interval`,
    [email.trim(), String(JANELA_MINUTOS)]
  );
  return Number(linha?.total ?? 0) >= LIMITE_POR_CONTA;
}

export async function limparTentativas(email: string) {
  await consultar('DELETE FROM tentativas_login WHERE email = lower($1)', [email.trim()]);
}
