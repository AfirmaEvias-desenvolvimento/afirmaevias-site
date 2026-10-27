import crypto from 'node:crypto';

export function gerarProtocolo(prefixo: string) {
  const agora = new Date();
  const ano = agora.getFullYear();
  const aleatorio = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefixo}-${ano}-${aleatorio}`;
}

export function hashIp(ip: string) {
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

// Controles a remover: os C0 sem \n e \t, o DEL e a faixa C1. O trim() so
// limpava as pontas, entao um caractere de controle no meio do texto seguia
// para o banco, para a exportacao e para o e-mail de aviso.
//
// O byte nulo e o caso que passa de estetico: o Postgres recusa esse byte em
// coluna de texto e devolve erro, entao um campo com ele derrubava o envio
// inteiro com 500 em vez de gravar.
//
// \n e \t ficam de proposito: mensagem, relato e detalhes sao texto livre, e
// tirar a quebra de linha embolaria o que a pessoa escreveu em paragrafos.
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export function limpar(valor: unknown, tamanhoMaximo = 2000) {
  if (typeof valor !== 'string') return '';
  return valor.replace(/\r\n?/g, '\n').replace(CONTROLES, '').trim().slice(0, tamanhoMaximo);
}

export function emailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function formatarData(valor: Date | string | null) {
  if (!valor) return '—';
  const data = typeof valor === 'string' ? new Date(valor) : valor;
  return data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function formatarDataCurta(valor: Date | string | null) {
  if (!valor) return '—';
  const data = typeof valor === 'string' ? new Date(valor) : valor;
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function paraCsv(linhas: Record<string, any>[]) {
  if (linhas.length === 0) return '';
  const colunas = Object.keys(linhas[0]);
  // Injecao de formula: o texto vem de formulario publico e a planilha avalia
  // celulas que comecam com = + - @ (e com tab ou CR antes desses). As aspas
  // do CSV nao protegem, porque o Excel as remove ao abrir. O apostrofo na
  // frente faz a planilha tratar a celula como texto.
  const perigoso = /^[\u0009\u000d]*[=+\-@]/;
  const escapar = (valor: any) => {
    if (valor === null || valor === undefined) return '';
    const bruto = String(valor);
    const seguro = perigoso.test(bruto) ? `'${bruto}` : bruto;
    return `"${seguro.replace(/"/g, '""')}"`;
  };
  const corpo = linhas.map((linha) => colunas.map((coluna) => escapar(linha[coluna])).join(';'));
  return [colunas.join(';'), ...corpo].join('\r\n');
}

/**
 * Confere se o conteudo do arquivo bate com a extensao declarada.
 *
 * A validacao por MIME sozinha nao serve: o celular manda octet-stream para
 * PDF legitimo, entao o tipo declarado precisa ceder para a extensao. Mas ai
 * qualquer arquivo renomeado para .pdf passaria. Ler os primeiros bytes fecha
 * a brecha - eles sao fixos por formato e nao dependem do que o cliente diz.
 *
 * Nao substitui antivirus: um PDF pode ser valido e malicioso ao mesmo tempo.
 */
export function assinaturaConfere(dados: Buffer, extensao: string) {
  const comeca = (bytes: number[]) => bytes.every((b, i) => dados[i] === b);

  switch (extensao.toLowerCase()) {
    case 'pdf':
      // %PDF-
      return comeca([0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'docx':
      // OOXML e um zip: PK\x03\x04
      return comeca([0x50, 0x4b, 0x03, 0x04]);
    case 'doc':
      // formato OLE2 do Word antigo
      return comeca([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    default:
      return false;
  }
}

/**
 * Monta o Content-Disposition de um anexo.
 *
 * Dois problemas resolvidos aqui. O nome do arquivo vem do visitante e o
 * limpar() so tira espaco das pontas: uma quebra de linha no meio sobrevivia
 * e ia parar dentro de um cabecalho HTTP, onde o Node recusa o caractere e
 * derruba o download com erro 500. E nome com acento — "Curriculo Jose.pdf" e
 * o caso comum aqui — nao cabe em cabecalho ASCII: sem a forma RFC 5987 o
 * navegador salva o arquivo com o nome corrompido.
 */
export function cabecalhoAnexo(nome: string) {
  const proibidos = /[\u0000-\u001f\u007f\u0022\u005c]/g;
  const limpo = nome.replace(proibidos, '').trim() || 'arquivo';
  const semAcento = limpo.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const ascii = semAcento.replace(/[^\u0020-\u007e]/g, '_') || 'arquivo';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(limpo)}`;
}

/**
 * Aceita só endereço https. Serve ao link da área do cliente, cujo destino
 * vem de variável de ambiente: um valor com http, javascript: ou texto solto
 * nunca vira href. Devolve o endereço normalizado, ou '' para "sem link".
 */
export function urlHttps(valor: unknown) {
  if (typeof valor !== 'string' || valor.trim() === '') return '';
  try {
    const url = new URL(valor.trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/**
 * Quebra um título com <br> em linhas mascaradas, para a entrada linha a linha
 * do herói. É feito no servidor e não no navegador: se o site.js montasse as
 * linhas, o título apareceria inteiro, sumiria e entraria de novo.
 *
 * Recebe HTML confiável (o texto vem de content.ts e das views), não entrada
 * de visitante.
 */
export function linhasDeTitulo(html: string) {
  return html
    .split(/<br\s*\/?>/i)
    .map((linha) => `<span class="linha"><span class="linha__texto">${linha.trim()}</span></span>`)
    .join(' ');
}
