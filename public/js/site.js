// Comportamento do site. Sem dependência: só APIs do navegador.
//
// A CSP fecha style-src em 'self', então nada aqui escreve atributo style.
// Estilo dinâmico entra por element.style.setProperty, que a política
// permite, e quase sempre como variável CSS que o site.css já sabe usar.
//
// Cada recurso roda isolado: um erro num deles não derruba os outros.

const corpo = document.body;
const reduzirMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const temObservador = 'IntersectionObserver' in window;

function recurso(nome, iniciar) {
  try {
    iniciar();
  } catch (erro) {
    console.error(`[site] ${nome}:`, erro);
  }
}

// Um laço só de rolagem para tudo que depende dela: cada recurso registra
// uma função e todas rodam no mesmo quadro de animação.
const aoRolar = [];
let quadroPendente = 0;
function agendarRolagem() {
  if (quadroPendente) return;
  quadroPendente = requestAnimationFrame(() => {
    quadroPendente = 0;
    const y = window.scrollY;
    aoRolar.forEach((atualizar) => atualizar(y));
  });
}
window.addEventListener('scroll', agendarRolagem, { passive: true });
window.addEventListener('resize', agendarRolagem, { passive: true });

// ---------------------------------------------------------- menu mobile

recurso('menu', () => {
  const botao = document.getElementById('menu-botao');
  const navegacao = document.getElementById('navegacao');
  const cabecalho = document.getElementById('cabecalho');
  if (!botao || !navegacao) return;
  const rotulo = botao.querySelector('.sr');

  const alternar = (abrir) => {
    botao.setAttribute('aria-expanded', String(abrir));
    navegacao.classList.toggle('is-aberta', abrir);
    corpo.classList.toggle('menu-aberto', abrir);
    corpo.style.overflow = abrir ? 'hidden' : '';
    if (rotulo) rotulo.textContent = abrir ? 'Fechar menu' : 'Abrir menu';
    if (abrir) cabecalho?.classList.remove('is-oculto');
  };

  botao.addEventListener('click', () => alternar(botao.getAttribute('aria-expanded') !== 'true'));
  navegacao.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => alternar(false)));

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && navegacao.classList.contains('is-aberta')) {
      alternar(false);
      botao.focus();
    }
  });

  // virou desktop com o menu aberto: fecha para não travar a rolagem
  window.matchMedia('(min-width: 1100px)').addEventListener('change', (consulta) => {
    if (consulta.matches) alternar(false);
  });
});

// ------------------------------------------------------- tema claro/escuro

// Sem escolha gravada, o tema segue o sistema (prefers-color-scheme no CSS).
// O botão grava a escolha em localStorage e o tema.js a aplica no <head> da
// próxima página, antes da pintura.
recurso('tema', () => {
  const botao = document.getElementById('tema-botao');
  if (!botao) return;
  const raiz = document.documentElement;
  const sistemaEscuro = window.matchMedia('(prefers-color-scheme: dark)');
  const atual = () => raiz.dataset.tema || (sistemaEscuro.matches ? 'escuro' : 'claro');

  const rotular = () => {
    const escuro = atual() === 'escuro';
    botao.setAttribute('aria-pressed', String(escuro));
    botao.title = escuro ? 'Usar tema claro' : 'Usar tema escuro';
  };

  botao.addEventListener('click', () => {
    const novo = atual() === 'escuro' ? 'claro' : 'escuro';
    const aplicar = () => {
      raiz.dataset.tema = novo;
      try {
        localStorage.setItem('ae_tema', novo);
      } catch {
        // sem armazenamento a troca vale só para esta página
      }
      rotular();
    };

    if (
      reduzirMovimento || document.activeViewTransition ||
      typeof document.startViewTransition !== 'function'
    ) {
      aplicar();
      return;
    }

    // o tema novo se abre em círculo a partir do próprio botão
    const caixa = botao.getBoundingClientRect();
    const x = caixa.left + caixa.width / 2;
    const y = caixa.top + caixa.height / 2;
    const raio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    raiz.classList.add('trocando-tema');
    const transicao = document.startViewTransition(aplicar);
    transicao.ready
      .then(() => {
        raiz.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raio}px at ${x}px ${y}px)`] },
          { duration: 650, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
        );
      })
      .catch(() => {});
    transicao.finished
      .catch(() => {})
      .finally(() => raiz.classList.remove('trocando-tema'));
  });

  sistemaEscuro.addEventListener('change', rotular);
  rotular();
});

// ------------------------------------------ cabeçalho, progresso e topo

// O cabeçalho recolhe quando a pessoa desce e volta quando ela sobe: a tela
// do celular fica livre para o conteúdo sem esconder a navegação de vez.
recurso('cabecalho', () => {
  const cabecalho = document.getElementById('cabecalho');
  const progresso = document.getElementById('progresso');
  const botaoTopo = document.querySelector('[data-voltar-topo]');
  const anel = botaoTopo?.querySelector('.anel__progresso');
  let ultimoY = window.scrollY;

  const recolher = (sim) => {
    cabecalho?.classList.toggle('is-oculto', sim);
    corpo.classList.toggle('cabecalho-escondido', sim);
  };

  aoRolar.push((y) => {
    const altura = document.documentElement.scrollHeight - window.innerHeight;
    const razao = altura > 0 ? Math.min(1, Math.max(0, y / altura)) : 0;

    cabecalho?.classList.toggle('is-rolado', y > 8);

    const delta = y - ultimoY;
    if (y < 420 || corpo.classList.contains('menu-aberto')) {
      recolher(false);
      ultimoY = y;
    } else if (Math.abs(delta) > 8) {
      recolher(delta > 0);
      ultimoY = y;
    }

    if (progresso) progresso.style.transform = `scaleX(${razao})`;
    if (botaoTopo) botaoTopo.classList.toggle('is-visivel', y > window.innerHeight * 0.8);
    if (anel) anel.style.strokeDashoffset = String(100 - razao * 100);
  });

  // quem navega por teclado nunca fica com o foco num cabeçalho escondido
  cabecalho?.addEventListener('focusin', () => recolher(false));

  botaoTopo?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduzirMovimento ? 'auto' : 'smooth' });
  });
});

// ------------------------------------------------ revelar ao entrar na tela

// Blocos que entram juntos na tela (uma linha de cartões no desktop) chegam
// em cascata; um bloco que entra sozinho chega sem espera.
recurso('revelar', () => {
  const alvos = document.querySelectorAll('[data-revelar]');
  if (alvos.length === 0) return;

  if (reduzirMovimento || !temObservador) {
    alvos.forEach((alvo) => alvo.classList.add('is-visivel'));
    return;
  }

  const emOrdem = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

  const observador = new IntersectionObserver(
    (entradas) => {
      // o que já ficou para trás (recarregou no meio da página, link com #)
      // aparece direto, sem animar fora da vista
      entradas
        .filter((entrada) => !entrada.isIntersecting && entrada.boundingClientRect.bottom < 0)
        .forEach((entrada) => {
          entrada.target.classList.add('is-visivel');
          entrada.target.style.setProperty('--atraso', '0ms');
          observador.unobserve(entrada.target);
        });

      entradas
        .filter((entrada) => entrada.isIntersecting)
        .map((entrada) => entrada.target)
        .sort(emOrdem)
        .forEach((alvo, i) => {
          alvo.style.setProperty('--atraso', `${Math.min(i, 6) * 90}ms`);
          alvo.classList.add('is-visivel');
          observador.unobserve(alvo);
        });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0 }
  );

  alvos.forEach((alvo) => observador.observe(alvo));
});

// ----------------------------------------------------- números que contam

// O número final já vem no HTML (e numa cópia só para leitor de tela). Aqui
// ele volta a zero e sobe até o valor quando aparece.
recurso('contadores', () => {
  const numeros = document.querySelectorAll('[data-contar]');
  if (numeros.length === 0 || reduzirMovimento || !temObservador) return;

  const formato = new Intl.NumberFormat('pt-BR');
  const contar = (elemento) => {
    const alvo = Number(elemento.dataset.contar);
    if (!Number.isFinite(alvo)) return;
    const duracao = 1800;
    const inicio = performance.now();
    const passo = (agora) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      // sai rápido e freia no fim, como um odômetro chegando no número
      const suave = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      elemento.textContent = formato.format(Math.round(alvo * suave));
      if (t < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };

  const observador = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((entrada) => {
        if (!entrada.isIntersecting) return;
        observador.unobserve(entrada.target);
        contar(entrada.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px' }
  );

  numeros.forEach((numero) => {
    numero.textContent = '0';
    observador.observe(numero);
  });
});

// --------------------------------------------------------------- paralaxe

recurso('paralaxe', () => {
  if (reduzirMovimento) return;

  // foto do herói: desce mais devagar que a página
  const herois = [...document.querySelectorAll('.heroi--imagem')];
  // demais imagens: deslocamento proporcional à distância do centro da tela,
  // só a partir do tablet, onde há espaço para o efeito ser percebido
  const largo = window.matchMedia('(min-width: 900px)');
  const elementos = [...document.querySelectorAll('[data-paralaxe]')];

  aoRolar.push((y) => {
    herois.forEach((heroi) => {
      if (y > heroi.offsetTop + heroi.offsetHeight) return;
      heroi.style.setProperty('--paralaxe', `${(y * 0.32).toFixed(1)}px`);
    });

    if (!largo.matches) return;
    const meio = window.innerHeight / 2;
    elementos.forEach((elemento) => {
      const caixa = elemento.getBoundingClientRect();
      if (caixa.bottom < -100 || caixa.top > window.innerHeight + 100) return;
      const fator = Number(elemento.dataset.paralaxe) || 0.06;
      const distancia = caixa.top + caixa.height / 2 - meio;
      elemento.style.setProperty('--paralaxe', `${(distancia * -fator).toFixed(1)}px`);
    });
  });
});

// --------------------------------------------------------- linha do tempo

// A linha verde cresce com a rolagem e cada marco acende quando ela chega.
recurso('linha-do-tempo', () => {
  const linha = document.querySelector('.linha-tempo');
  if (!linha) return;
  const marcos = [...linha.querySelectorAll('.marco')];

  aoRolar.push(() => {
    const caixa = linha.getBoundingClientRect();
    const ponto = window.innerHeight * 0.62;
    const progresso = Math.min(1, Math.max(0, (ponto - caixa.top) / caixa.height));
    linha.style.setProperty('--progresso', progresso.toFixed(4));
    marcos.forEach((marco) => {
      marco.classList.toggle('is-ativo', marco.getBoundingClientRect().top + 12 < ponto);
    });
  });
});

// ------------------------------------------- faixa do rodapé anda na rolagem

recurso('faixa-rodape', () => {
  const faixa = document.querySelector('.rodape__faixa');
  if (!faixa || reduzirMovimento) return;
  aoRolar.push((y) => faixa.style.setProperty('--deslocamento', `${(-y * 0.35).toFixed(1)}px`));
});

// ---------------------------------------- índices que acompanham a rolagem

// Serviços (fita de pílulas) e documentos (sumário lateral) destacam a seção
// que está na tela. Na fita, a pílula ativa é trazida para o meio.
recurso('indices', () => {
  if (!temObservador) return;
  const links = [...document.querySelectorAll('.indice__lista a, .documento__indice a')];
  if (links.length === 0) return;

  const fita = document.querySelector('.indice__lista');
  const porId = new Map();
  links.forEach((link) => {
    const id = decodeURIComponent(link.getAttribute('href').slice(1));
    const secao = document.getElementById(id);
    if (secao) porId.set(secao, link);
  });

  const ativar = (link) => {
    links.forEach((outro) => outro.classList.toggle('is-ativo', outro === link));
    if (fita && fita.contains(link)) {
      const deslocamento =
        link.getBoundingClientRect().left - fita.getBoundingClientRect().left - (fita.clientWidth - link.offsetWidth) / 2;
      fita.scrollBy({ left: deslocamento, behavior: reduzirMovimento ? 'auto' : 'smooth' });
    }
  };

  const observador = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting) ativar(porId.get(entrada.target));
      });
    },
    { rootMargin: '-35% 0px -55% 0px' }
  );
  porId.forEach((_link, secao) => observador.observe(secao));
});

// ------------------------------------------------------ disco de celulares

// As telas ficam numa roda (partials/vitrine.ejs). Girar é só trocar o
// data-passo de cada vaga: o CSS leva o celular pelo arco. O relógio é a
// animação da barra da marca ativa: quando ela enche, a roda gira. Pausar no
// hover, no botão ou fora da tela pausa a barra, e com ela o giro.
recurso('vitrine', () => {
  document.querySelectorAll('[data-vitrine]').forEach((vitrine) => {
    const vagas = [...vitrine.querySelectorAll('.vitrine__vaga')];
    const marcas = [...vitrine.querySelectorAll('[data-vitrine-ir]')];
    const appLegenda = vitrine.querySelector('.vitrine__legenda-app');
    const tituloLegenda = vitrine.querySelector('.vitrine__legenda-titulo');
    const legenda = vitrine.querySelector('.vitrine__legenda');
    const botaoPausa = vitrine.querySelector('[data-vitrine-pausa]');
    const total = vagas.length;
    if (total < 2) return;
    let atual = 0;

    const mostrar = (indice) => {
      atual = (indice + total) % total;
      vagas.forEach((vaga, i) => {
        let passo = (i - atual + total) % total;
        if (passo > total / 2) passo -= total;
        const antes = Number(vaga.dataset.passo);
        // quem dá a volta por trás da roda troca de lado sem atravessar a frente
        if (Math.abs(passo - antes) > 1) {
          vaga.classList.add('sem-transicao');
          vaga.dataset.passo = String(passo);
          vaga.getBoundingClientRect();
          vaga.classList.remove('sem-transicao');
        } else {
          vaga.dataset.passo = String(passo);
        }
        if (passo === 0) vaga.removeAttribute('aria-hidden');
        else vaga.setAttribute('aria-hidden', 'true');
      });

      marcas.forEach((marca, i) => {
        marca.classList.toggle('is-ativo', i === atual);
        if (i === atual) marca.setAttribute('aria-current', 'true');
        else marca.removeAttribute('aria-current');
      });

      const frente = vagas[atual];
      if (appLegenda) appLegenda.textContent = frente.dataset.app;
      if (tituloLegenda) tituloLegenda.textContent = frente.dataset.titulo;
      if (legenda) {
        legenda.classList.remove('is-trocando');
        legenda.getBoundingClientRect();
        legenda.classList.add('is-trocando');
      }
    };

    vitrine.classList.add('is-girando');

    // com menos movimento a roda não gira sozinha (e a animação reduzida a
    // 0,01 ms faria a barra terminar na hora, girando sem parar)
    if (!reduzirMovimento) {
      vitrine.addEventListener('animationend', (evento) => {
        if (evento.animationName === 'tempo-vitrine') mostrar(atual + 1);
      });
    }

    vagas.forEach((vaga) => {
      vaga.addEventListener('click', () => {
        const passo = Number(vaga.dataset.passo);
        if (passo === 1 || passo === -1) mostrar(atual + passo);
      });
    });
    vitrine.querySelector('[data-vitrine-anterior]')?.addEventListener('click', () => mostrar(atual - 1));
    vitrine.querySelector('[data-vitrine-proxima]')?.addEventListener('click', () => mostrar(atual + 1));
    marcas.forEach((marca, i) => marca.addEventListener('click', () => mostrar(i)));

    botaoPausa?.addEventListener('click', () => {
      const pausada = vitrine.classList.toggle('is-pausada');
      botaoPausa.setAttribute('aria-pressed', String(pausada));
      botaoPausa.setAttribute('aria-label', pausada ? 'Retomar a troca de telas' : 'Pausar a troca de telas');
    });

    // fora da tela a barra para: ninguém perde telas que giraram sem ser vistas
    if (temObservador) {
      new IntersectionObserver((entradas) => {
        entradas.forEach((entrada) => vitrine.classList.toggle('is-fora', !entrada.isIntersecting));
      }, { threshold: 0.35 }).observe(vitrine);
    } else {
      vitrine.classList.remove('is-fora');
    }
  });
});

// ------------------------------------------- áreas de serviço no celular

// No celular cada área recolhe as listas atrás de um botão; do tablet para
// cima tudo fica aberto e o botão some. O conteúdo recolhido recebe inert:
// sai da ordem de tabulação e do leitor de tela até ser aberto.
recurso('servicos-recolher', () => {
  const botoes = [...document.querySelectorAll('.servico__alternar')];
  if (botoes.length === 0) return;
  const celular = window.matchMedia('(max-width: 899px)');

  const definir = (botao, aberto) => {
    const detalhes = document.getElementById(botao.getAttribute('aria-controls'));
    if (!detalhes) return;
    botao.setAttribute('aria-expanded', String(aberto));
    detalhes.classList.toggle('is-recolhido', !aberto);
    detalhes.inert = !aberto;
  };

  const aplicar = () => {
    botoes.forEach((botao) => {
      botao.hidden = !celular.matches;
      definir(botao, !celular.matches);
    });
  };

  botoes.forEach((botao) => {
    botao.addEventListener('click', () => definir(botao, botao.getAttribute('aria-expanded') !== 'true'));
  });

  // chegou por um link com #area: essa área já abre
  const alvo = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
  celular.addEventListener('change', aplicar);
  aplicar();
  if (alvo && celular.matches) {
    const botao = alvo.querySelector('.servico__alternar');
    if (botao) definir(botao, true);
  }
});

// --------------------------------------------- carrossel da galeria (home)

// vale para todo carrossel com data-galeria seguido da sua barra de progresso
recurso('galeria', () => {
  document.querySelectorAll('[data-galeria]').forEach((galeria) => {
    const barra = galeria.nextElementSibling?.matches('.galeria__progresso')
      ? galeria.nextElementSibling.querySelector('span')
      : null;
    if (!barra) return;

    let pendente = 0;
    const atualizar = () => {
      pendente = 0;
      const visto = (galeria.scrollLeft + galeria.clientWidth) / galeria.scrollWidth;
      barra.style.transform = `scaleX(${Math.min(1, visto).toFixed(3)})`;
    };
    galeria.addEventListener(
      'scroll',
      () => {
        if (!pendente) pendente = requestAnimationFrame(atualizar);
      },
      { passive: true }
    );
    window.addEventListener('resize', atualizar, { passive: true });
    atualizar();
  });
});

// ------------------------------------------------ pausa da esteira de marcas

recurso('pausar', () => {
  document.querySelectorAll('[data-pausar]').forEach((botao) => {
    const alvo = document.getElementById(botao.getAttribute('aria-controls'));
    const texto = botao.querySelector('span');
    if (!alvo) return;
    botao.addEventListener('click', () => {
      const pausado = alvo.classList.toggle('is-pausada');
      botao.setAttribute('aria-pressed', String(pausado));
      if (texto) texto.textContent = pausado ? 'Retomar animação' : 'Pausar animação';
    });
  });
});

// ---------------------------------------- luz que segue o cursor nos cartões

recurso('luz-cartoes', () => {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.addEventListener(
    'pointermove',
    (evento) => {
      const cartao = evento.target instanceof Element && evento.target.closest('.cartao, .recurso, .valor, .bloco-link');
      if (!cartao) return;
      const caixa = cartao.getBoundingClientRect();
      cartao.style.setProperty('--mx', `${evento.clientX - caixa.left}px`);
      cartao.style.setProperty('--my', `${evento.clientY - caixa.top}px`);
    },
    { passive: true }
  );
});

// --------------------------------------------------------------- formulários

// campo de identificacao do relato de integridade
recurso('relato-anonimo', () => {
  const opcoesAnonimo = document.querySelectorAll('input[name="anonimo"]');
  const blocoIdentificacao = document.querySelector('.identificacao');
  if (opcoesAnonimo.length === 0 || !blocoIdentificacao) return;
  const alternar = () => {
    const querSeIdentificar = document.querySelector('input[name="anonimo"]:checked')?.value === 'nao';
    blocoIdentificacao.hidden = !querSeIdentificar;
  };
  opcoesAnonimo.forEach((opcao) => opcao.addEventListener('change', alternar));
  alternar();
});

// currículo: confirma o arquivo escolhido e barra o tamanho antes do upload,
// para o candidato nao esperar 5 MB subirem so para receber recusa
recurso('arquivo', () => {
  document.querySelectorAll('input[type="file"][data-limite-mb]').forEach((campo) => {
    const alvo = document.querySelector(campo.dataset.alvo);
    if (!alvo) return;
    const padrao = alvo.textContent;
    const limite = Number(campo.dataset.limiteMb) * 1024 * 1024;

    campo.addEventListener('change', () => {
      const arquivo = campo.files[0];
      if (!arquivo) {
        alvo.textContent = padrao;
        alvo.classList.remove('campo__ajuda--erro', 'campo__ajuda--ok');
        return;
      }
      const mb = (arquivo.size / 1024 / 1024).toFixed(1).replace('.', ',');
      if (arquivo.size > limite) {
        campo.value = '';
        alvo.textContent = `${arquivo.name} tem ${mb} MB e o limite e 5 MB. Salve como PDF e anexe de novo.`;
        alvo.classList.add('campo__ajuda--erro');
        alvo.classList.remove('campo__ajuda--ok');
        return;
      }
      alvo.textContent = `${arquivo.name} · ${mb} MB`;
      alvo.classList.add('campo__ajuda--ok');
      alvo.classList.remove('campo__ajuda--erro');
    });
  });
});

// Consulta de protocolo. Ficava num onsubmit inline, que a CSP (script-src
// 'self') bloqueia: o formulário caía no GET padrão, /protocolo/?codigo=...,
// que não é rota nenhuma.
recurso('protocolo', () => {
  document.querySelectorAll('form[data-consulta-protocolo]').forEach((formulario) => {
    formulario.addEventListener('submit', (evento) => {
      evento.preventDefault();
      const codigo = formulario.elements.codigo.value.trim();
      if (codigo) window.location.href = `/protocolo/${encodeURIComponent(codigo)}`;
    });
  });
});

// Quando o formulário volta com erro, o aviso fica no topo e o visitante já
// rolou até o botão: sem mover o foco, quem usa teclado ou leitor de tela não
// descobre que algo falhou.
recurso('aviso-de-erro', () => {
  const avisoDeErro = document.querySelector('.alerta[role="alert"]');
  if (avisoDeErro) {
    avisoDeErro.scrollIntoView({ block: 'center' });
    avisoDeErro.focus({ preventScroll: true });
  }
});

agendarRolagem();
