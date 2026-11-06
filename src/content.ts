export { pecas } from './extra.js';

// Todo o texto do site fica aqui. Uma fonte unica, sem CMS.
// Trocar copy = editar este arquivo e redeployar.

export const empresa = {
  nome: 'Afirma E-vias',
  razaoSocial: 'Afirma E-vias Engenharia Viária Ltda.',
  cnpj: '05.205.684/0001-81',
  assinatura: 'engenharia viária',
  telefoneCelular: '(41) 98713-7780',
  telefoneFixo: '(41) 3123-8550',
  whatsapp: '5541987137780',
  email: 'comercial@afirmaevias.com.br',
  emailEncarregado: 'privacidade@afirmaevias.com.br',
  linkedin: 'https://www.linkedin.com/company/afirmaeviasengenhariaviaria/',
  instagram: 'https://www.instagram.com/afirmaevias/',
  enderecos: [
    {
      cidade: 'Curitiba',
      uf: 'PR',
      linha1: 'R. Baltazar Carrasco dos Reis, 2345',
      linha2: 'Rebouças — Curitiba/PR, 80230-070',
      mapsUrl:
        'https://www.google.com/maps/search/?api=1&query=R.+Baltazar+Carrasco+dos+Reis%2C+2345%2C+Rebou%C3%A7as%2C+Curitiba%2FPR%2C+80230-070'
    },
    {
      cidade: 'Marília',
      uf: 'SP',
      linha1: 'R. Benedito Alves Delfino, 1527',
      linha2: 'Distrito Industrial — Marília/SP, 17512-043',
      mapsUrl:
        'https://www.google.com/maps/search/?api=1&query=R.+Benedito+Alves+Delfino%2C+1527%2C+Distrito+Industrial%2C+Mar%C3%ADlia%2FSP%2C+17512-043'
    }
  ]
};

export const navegacao = [
  { rotulo: 'A empresa', href: '/afirma-evias' },
  { rotulo: 'Serviços', href: '/servicos' },
  { rotulo: 'Aplicativo', href: '/aplicativo' },
  { rotulo: 'Acreditação', href: '/acreditacao-e-certificacao' },
  { rotulo: 'Integridade', href: '/programa-de-integridade' },
  { rotulo: 'Contato', href: '/contato' }
];

export const indicadores = [
  { valor: '50.000', unidade: 'km', rotulo: 'de obras fiscalizadas' },
  { valor: '10.000', unidade: 'km', rotulo: 'em projetos viários' },
  { valor: '100.000', unidade: 'km', rotulo: 'de levantamentos' },
  { valor: '700', unidade: 'contratos', rotulo: 'concluídos' }
];

export const home = {
  eyebrow: 'Engenharia viária desde 2002',
  titulo: 'Abrindo caminhos,<br>construindo o futuro.',
  chamada:
    'Mais de 20 anos de tradição e inovação em estudos, projetos, supervisão e gerenciamento de obras rodoviárias e urbanas.',
  apoio:
    'Somos movidos pela excelência técnica, inovação e um compromisso inabalável com a qualidade para atender órgãos públicos e empresas privadas.',
  servicosResumo: [
    {
      titulo: 'Supervisão e controle tecnológico',
      href: '/servicos#supervisao',
      texto: 'Fiscalização de obra com laboratório e app próprios, em tempo real.'
    },
    {
      titulo: 'Projetos em BIM',
      href: '/servicos#bim',
      texto: 'Rodovias e vias urbanas modeladas do LOD 100 ao LOD 400.'
    },
    {
      titulo: 'Ensaios de laboratório',
      href: '/servicos#ensaios',
      texto: 'Laboratório central de alta performance e unidades móveis em campo.'
    },
    {
      titulo: 'Levantamentos e cadastro',
      href: '/servicos#levantamentos',
      texto: 'Fotogrametria georreferenciada, perfilômetro a laser e SIG.'
    }
  ],
  // faixa de fotos da home: rola na horizontal no celular e vira grade no desktop
  galeria: [
    {
      arquivo: 'obra-pavimentacao.webp',
      largura: 1000,
      altura: 834,
      rotulo: 'Pavimentação',
      legenda: 'Supervisão e controle tecnológico da camada asfáltica.',
      alt: 'Rolo compactador sobre pavimento asfáltico recém-aplicado, em primeiro plano o agregado da camada.'
    },
    {
      arquivo: 'obra-entroncamento.webp',
      largura: 739,
      altura: 595,
      rotulo: 'Projetos viários',
      legenda: 'Rodovias, acessos e entroncamentos modelados em BIM.',
      alt: 'Vista aérea de um entroncamento rodoviário com viaduto e alças de acesso.'
    },
    {
      arquivo: 'campo-ensaio.webp',
      largura: 555,
      altura: 469,
      rotulo: 'Em campo',
      legenda: 'O ensaio é registrado no app no ponto de coleta.',
      alt: 'Técnico registra no celular a leitura de uma amostra de asfalto apoiada na balança, durante ensaio em campo.'
    },
    {
      arquivo: 'laboratorio-ensaio.webp',
      largura: 595,
      altura: 469,
      rotulo: 'Na bancada',
      legenda: 'Laboratório central e unidades móveis sob procedimento controlado.',
      alt: 'Técnica de laboratório, de óculos de proteção e luvas, verte líquido de um béquer em um cilindro metálico sobre a bancada.'
    }
  ]
};

export const sobre = {
  eyebrow: 'A empresa',
  titulo: 'Duas trajetórias,<br>uma engenharia só.',
  linhaDoTempo: [
    {
      ano: '2002',
      titulo: 'Nasce a Afirma Engenharia',
      texto:
        'Fundada pelo Prof. Mario Henrique Furtado Andrade, marcou presença em grandes projetos de infraestrutura viária por mais de duas décadas. Com sedes em Curitiba, São Paulo e Minas Gerais, construiu reputação sólida em estudos, projetos, supervisão e controle tecnológico de obras rodoviárias, urbanas, aeroportuárias e industriais.'
    },
    {
      ano: '2016',
      titulo: 'Nasce a E-vias',
      texto:
        'Criada em Curitiba/PR, conquistou reconhecimento pela excelência nos ensaios laboratoriais e no controle de qualidade de materiais, com destaque para sua estrutura moderna e laboratórios móveis. Especializou-se em pavimentação asfáltica e tecnologia aplicada à engenharia viária.'
    },
    {
      ano: '2024',
      titulo: 'A fusão',
      texto:
        'Em dezembro de 2024 as duas trajetórias se consolidam na Afirma E-vias, unificando forças, equipes e propósitos. A integração ampliou a capacidade operacional e técnica: rede de laboratórios móveis, laboratório central de alta performance e presença em diferentes estados.'
    },
    {
      ano: 'Hoje',
      titulo: 'Para onde estamos indo',
      texto:
        'A fusão não é um ponto de chegada, mas um novo começo. Seguimos investindo em tecnologia, capacitação contínua e expansão estratégica para desenvolver soluções inteligentes e sustentáveis que contribuam para uma infraestrutura mais segura, eficiente e conectada.'
    }
  ]
};

export const servicos = [
  {
    id: 'supervisao',
    titulo: 'Supervisão e controle tecnológico de obras',
    resumo:
      'Garantimos o cumprimento de normas e a qualidade das obras por meio de supervisão e gestão especializadas. Nossa infraestrutura combina laboratórios de alta precisão e o aplicativo exclusivo Afirma E-vias para controle em tempo real.',
    itens: [
      'Planejamento, programação e controle da execução dos serviços',
      'Controle tecnológico e geométrico e realização de ensaios geotécnicos e de materiais',
      'Assistência técnica e auditoria de obras',
      'Elaboração de planos e sistemas de controle de qualidade',
      'Acompanhamento em tempo real das atividades e resultados',
      'Diagnóstico ágil de não conformidades com emissão de alertas',
      'Dashboards analíticos para visão organizada do banco de dados'
    ]
  },
  {
    id: 'bim',
    titulo: 'Soluções em infraestrutura com tecnologia BIM',
    resumo:
      'Projetos de infraestrutura para rodovias e vias urbanas com metodologia BIM, garantindo precisão, interoperabilidade e controle do ciclo de vida do empreendimento. Usamos Revit, Civil 3D, Navisworks e InfraWorks para modelagem avançada, detecção de interferências e otimização da execução, com detalhamento do LOD 100 ao LOD 400.',
    grupos: [
      {
        titulo: 'Estudos técnicos e viabilidade',
        itens: [
          'Estudo de viabilidade de concessões',
          'Estudos de viabilidade técnica, econômica e ambiental (EVTEA)',
          'Estudos preliminares: topográficos, geológicos, geotécnicos, tráfego, traçado, hidrológicos e ambientais'
        ]
      },
      {
        titulo: 'Projetos executivos',
        itens: [
          'Rodoviários, urbanos e aeroportuários',
          'Implantação, ampliação de capacidade e restauração de pavimentos flexíveis e rígidos'
        ]
      }
    ]
  },
  {
    id: 'consultoria',
    titulo: 'Consultoria técnica especializada',
    resumo:
      'Suporte técnico com foco em auditorias e revisão de projetos, assegurando excelência e mitigação de riscos.',
    itens: [
      'Controle de Qualidade de Projetos (CQP)',
      'Assistência Técnica de Obras (ATO)',
      'Laudos, pareceres e auditorias técnicas',
      'Revisão de especificações e projetos',
      'Avaliação técnica e econômica de alternativas de pavimentação'
    ]
  },
  {
    id: 'laboratorios',
    titulo: 'Laboratórios fixos e móveis',
    resumo:
      'Estruturas completas de controle de qualidade, dimensionadas para cada projeto — no canteiro, na usina ou acompanhando a frente de serviço.',
    grupos: [
      {
        titulo: 'Laboratórios fixos',
        itens: [
          'Estruturas completas para controle de qualidade em usinas de asfalto ou canteiros de obras',
          'Equipamentos dimensionados para as especificidades de cada projeto',
          'Equipe qualificada alinhada aos padrões mais rigorosos'
        ]
      },
      {
        titulo: 'Laboratórios móveis',
        itens: [
          'Pioneiros no desenvolvimento de unidades que acompanham as frentes de trabalho',
          'Análises imediatas no local de aplicação',
          'Decisões mais rápidas e assertivas, com redução de custos e prazos'
        ]
      }
    ]
  },
  {
    id: 'sondagens',
    titulo: 'Sondagens e investigações geotécnicas',
    resumo:
      'Estudos precisos de solo e subsuperfície para embasar decisões de engenharia com segurança.',
    itens: [
      'Sondagem a trado',
      'Sondagem a percussão',
      'Sondagens rotativas e mistas',
      'Poços de inspeção',
      'Prospecção de jazidas',
      'Ensaio de densidade in situ',
      'Ensaio de CBR in situ'
    ]
  },
  {
    id: 'ensaios',
    titulo: 'Ensaios de laboratório',
    resumo:
      'Ensaios de alta complexidade, da caracterização de materiais a projetos avançados de dosagem.',
    grupos: [
      {
        titulo: 'Escopo',
        itens: [
          'Solos e agregados: caracterização e dosagens de camadas granulares',
          'Ligantes asfálticos: investigação de emulsões e ligantes',
          'Misturas asfálticas: densidade, reciclagem e misturas MRAF',
          'Concreto: ensaios de resistência e dosagens',
          'Ensaios especiais: desempenho em misturas asfálticas e estabilizadas'
        ]
      },
      {
        titulo: 'Ensaios especiais',
        itens: [
          'Extração e recuperação de ligante pelo evaporador rotativo — Abson',
          'HWTD — Simulador de tráfego Hamburgo',
          'Módulo de resiliência de solos e misturas asfálticas',
          'Flow Number e Vida de Fadiga',
          'Atendimento ao método de dimensionamento MeDiNa',
          'Projetos de dosagem de camadas de base, sub-base granular',
          'Solo-cimento e Brita Graduada Tratada com Cimento (BGTC)'
        ]
      }
    ]
  },
  {
    id: 'levantamentos',
    titulo: 'Levantamentos de condição funcional, estrutural e segurança',
    resumo:
      'Avaliação do pavimento em serviço com instrumentação de alta resolução.',
    itens: [
      'Condições de superfície por fotogrametria georreferenciada de alta resolução',
      'Irregularidade longitudinal e ATR por perfilômetro a laser',
      'Condições de aderência e segurança (pêndulo britânico e mancha de areia)'
    ]
  },
  {
    id: 'cadastro',
    titulo: 'Cadastro e monitoramento de elementos viários',
    resumo:
      'Gestão detalhada de elementos viários com sistemas integrados para manutenção e controle.',
    itens: [
      'Cadastro georreferenciado e avaliação de OAE, drenagem e OAC, terraplenos, sinalização, faixa de domínio e passivos ambientais',
      'Criação e disponibilização de bancos de dados e relatórios',
      'Implantação de sistemas de informação geográfica e de gerência de pavimentos (SIG)',
      'Retrorrefletância horizontal e vertical de elementos de sinalização viária'
    ]
  }
];

export const aplicativo = {
  eyebrow: 'Aplicativo Afirma E-vias',
  titulo: 'Conectando campo<br>e escritório.',
  chamada:
    'Inovação é o pilar para transformar a forma como a engenharia viária é planejada, executada e monitorada. Nosso aplicativo integra profissionais de campo, backoffice e clientes com transparência e agilidade.',
  recursos: [
    {
      titulo: 'Acompanhamento em tempo real',
      texto: 'Visualize ensaios e atividades diretamente no local, com georreferenciamento.'
    },
    {
      titulo: 'Diagnóstico ágil',
      texto: 'Receba alertas de não conformidades e tome decisões rápidas.'
    },
    {
      titulo: 'Registro e análise automatizados',
      texto:
        'Cadastre laboratoristas, obras e parâmetros de dosagem de concreto asfáltico e MRAF, com cálculo instantâneo dos resultados.'
    },
    {
      titulo: 'Dashboards inteligentes',
      texto: 'Organize, analise e exporte dados em PDF e CSV, gerando relatórios precisos.'
    }
  ],
  fecho:
    'Com o app você tem controle total da obra, acessando informações essenciais de qualquer lugar.',
  // Confirmados pelo Gustavo em 20/10/2026, a partir do relatorio do Controle
  // de 19/10 (17.864 registros, cerca de 212 mil fotos). Arredondados para
  // baixo. Atualize aqui quando quiser renovar.
  numeros: [
    { valor: '17.000', rotulo: 'registros técnicos no aplicativo' },
    { valor: '200.000', rotulo: 'fotos registradas em campo' }
  ],
  // Telas mostradas na moldura de celular (home e página do app). Os prints
  // são feitos com dados de demonstração: o site é público e não pode exibir
  // dado pessoal nem de cliente. Cada arquivo tem 640x1462 px, com uma faixa
  // de 77 px no topo na cor do cabeçalho do app, onde a moldura desenha a
  // barra de status. "barra" diz se essa faixa é clara ou escura, para a hora
  // e os ícones saírem em contraste. As que têm "vitrine" entram no disco de
  // celulares da home e do topo da página do app, na ordem do número (a 1
  // começa na frente); a galeria da página mostra todas.
  telas: [
    {
      arquivo: 'laboratorio-composicao-mistura.webp',
      app: 'Laboratório',
      titulo: 'Composição da mistura',
      alt: 'Cálculo automático da composição da mistura de agregados no aplicativo: percentual passante por peneira e gráfico da graduação da mistura dentro dos limites da especificação e da faixa de trabalho.',
      barra: 'escura',
      vitrine: 2
    },
    {
      arquivo: 'laboratorio-notificacoes.webp',
      app: 'Laboratório',
      titulo: 'Notificações',
      alt: 'Notificações do aplicativo do laboratório: alerta de não conformidade na verificação de uma balança, calibração vencendo, ensaio rejeitado na revisão e certificado aprovado.',
      barra: 'escura',
      vitrine: 4
    },
    {
      arquivo: 'laboratorio-equipamentos.webp',
      app: 'Laboratório',
      titulo: 'Equipamentos e calibração',
      alt: 'Lista de equipamentos do laboratório com alerta de calibração vencendo em até 30 dias, situação de uso e validade da calibração de cada equipamento.',
      barra: 'escura',
      vitrine: 6
    },
    {
      arquivo: 'laboratorio-inicio.webp',
      app: 'Laboratório',
      titulo: 'Tela inicial',
      alt: 'Tela inicial do aplicativo do laboratório: saudação ao usuário e indicadores de clientes, ensaios do catálogo, fichas de serviço e amostras recebidas na semana.',
      barra: 'escura',
      vitrine: 8
    },
    {
      arquivo: 'laboratorio-granulometria.webp',
      app: 'Laboratório',
      titulo: 'Ensaio de granulometria',
      alt: 'Ensaio de granulometria preenchido no aplicativo: peneiras com a porcentagem passante calculada automaticamente para as duas determinações.',
      barra: 'escura',
      vitrine: 10
    },
    {
      arquivo: 'controle-dashboard.webp',
      app: 'Controle de obra',
      titulo: 'Dashboard',
      alt: 'Dashboard do aplicativo de controle de obra: gráfico de barras dos registros por mês, comparando total e aprovados, e gráfico de rosca com a distribuição dos registros por tipo.',
      barra: 'clara',
      vitrine: 1
    },
    {
      arquivo: 'controle-nao-conformidades.webp',
      app: 'Controle de obra',
      titulo: 'Gestão de não conformidades',
      alt: 'Gestão de não conformidades no aplicativo: contadores de relatórios abertos, em tratativa e finalizados e a lista de RNCs com situação, rodovia e trecho.',
      barra: 'escura',
      vitrine: 3
    },
    {
      arquivo: 'controle-ensaios-realizados.webp',
      app: 'Controle de obra',
      titulo: 'Ensaios realizados',
      alt: 'Lista de ensaios realizados na obra: busca, filtros de período e registros com tipo, situação de aprovação, data e obra.',
      barra: 'escura',
      vitrine: 5
    },
    {
      arquivo: 'controle-checklist-concretagem.webp',
      app: 'Controle de obra',
      titulo: 'Checklist de concretagem',
      alt: 'Relatório de checklist de concretagem no aplicativo: dados da obra, condições climáticas, observações e ensaio de slump da carga de concreto, com resultado conforme.',
      barra: 'clara',
      vitrine: 7
    },
    {
      arquivo: 'controle-inicio.webp',
      app: 'Controle de obra',
      titulo: 'Tela inicial',
      alt: 'Tela inicial do aplicativo de controle de obra: faixa de boas-vindas com foto da equipe em campo e filtros por regional, obra, status, tipo de registro e período.',
      barra: 'escura',
      vitrine: 9
    }
  ] as TelaApp[]
};

type TelaApp = {
  arquivo: string;
  app: string;
  titulo: string;
  alt: string;
  barra: 'clara' | 'escura';
  /** ordem no disco de celulares; sem número, a tela fica só na galeria */
  vitrine?: number;
};

/** Telas do disco de celulares, na ordem em que passam pela frente. */
export const telasVitrine = aplicativo.telas
  .filter((tela) => tela.vitrine)
  .sort((a, b) => (a.vitrine ?? 0) - (b.vitrine ?? 0));

export const acreditacao = {
  eyebrow: 'Acreditação e certificação',
  titulo: 'Compromisso<br>com a excelência.',
  chamada:
    'Nossas certificações e acreditações comprovam a conformidade com os mais altos padrões técnicos e regulatórios, garantindo segurança, eficiência e confiabilidade em cada projeto.',
  iso9001: {
    titulo: 'ISO 9001',
    texto:
      'A ISO 9001 é a norma internacional que define os requisitos para um Sistema de Gestão da Qualidade eficiente. Ela garante que a empresa atenda às expectativas dos clientes e melhore continuamente seus processos internos. Nossa certificação reflete o compromisso com a excelência, a satisfação do cliente e a melhoria contínua.',
    link: '/documentos/certificado-iso-9001.pdf',
    linkRotulo: 'Certificado de registro (PDF)'
  },
  politicaQualidade:
    'A Afirma E-vias está comprometida em fornecer soluções de engenharia, controle tecnológico e ensaios laboratoriais com imparcialidade e competência técnica. Buscamos sempre a satisfação dos clientes, atendendo aos requisitos aplicáveis das partes interessadas por meio do cumprimento das normas ABNT NBR ISO/IEC 17025 e ABNT NBR ISO 9001, garantindo uma operação consistente.',
  politicaQualidadeNota:
    'Nota: a acreditação ISO/IEC 17025 encontra-se temporariamente suspensa em razão da mudança de endereço. O Sistema de Gestão da Qualidade segue integralmente aplicado. Veja o comunicado completo ao final desta página.',
  missao:
    'Desenvolver soluções inovadoras e integradas de engenharia viária, impulsionando a eficiência, a qualidade e os resultados dos nossos clientes.',
  visao:
    'Ser a referência em engenharia viária na América Latina, reconhecida pela excelência, inovação e compromisso com a qualidade.',
  valores: [
    { titulo: 'Ética e integridade', texto: 'Agir com transparência e responsabilidade em todas as relações.' },
    { titulo: 'Melhoria contínua', texto: 'Buscar constantemente a excelência em processos, produtos e serviços.' },
    { titulo: 'Compromisso com a qualidade', texto: 'Atuar com rigor técnico e excelência.' },
    { titulo: 'Inovação', texto: 'Estimular a criatividade e aplicar tecnologias que transformem o setor viário.' },
    { titulo: 'Valorização das pessoas', texto: 'Reconhecer, desenvolver e respeitar talentos internos e parceiros.' },
    { titulo: 'Sustentabilidade', texto: 'Atuar de forma consciente, respeitando o meio ambiente e as gerações futuras.' },
    { titulo: 'Comunicação clara', texto: 'Promover diálogo aberto e direcionamento para a eficácia nos objetivos.' }
  ],
  comunicado17025: {
    titulo: 'ISO/IEC 17025 — comunicado aos clientes e parceiros',
    paragrafos: [
      'A Afirma E-vias informa que está em processo de mudança para um novo endereço, visando a modernização de nossas instalações e a contínua melhoria do atendimento.',
      'Em conformidade com os requisitos da CGCRE (Inmetro) e da norma ABNT NBR ISO/IEC 17025, nossa acreditação encontra-se temporariamente suspensa em virtude da alteração de endereço físico, aguardando a avaliação técnica das novas instalações pelo órgão acreditador.'
    ],
    durante: [
      'Os relatórios de ensaio serão emitidos sem o símbolo da acreditação.',
      'Os serviços realizados não serão considerados acreditados até a formalização da nova extensão de endereço pela CGCRE.',
      'Mantemos integralmente o Sistema de Gestão da Qualidade, o rigor técnico e a competência da equipe, garantindo a confiabilidade dos resultados entregues.'
    ],
    fecho:
      'Esta é uma etapa normativa prevista e necessária para assegurar a integridade do processo de acreditação. Assim que a avaliação das novas instalações for concluída e a suspensão levantada, faremos um novo comunicado.'
  }
};

export const notaMarcas =
  'Revit, Civil 3D, Navisworks e InfraWorks são marcas da Autodesk, Inc. MeDiNa é método do DNIT/IPR. As demais marcas citadas pertencem aos respectivos titulares. A menção é descritiva e não indica parceria, patrocínio ou representação.';

export const integridade = {
  eyebrow: 'Programa de integridade',
  titulo: 'Ética e transparência<br>são a base de tudo.',
  chamada:
    'Nosso Programa de Integridade garante relações responsáveis e alinhadas às melhores práticas.',
  compliance: {
    titulo: 'Compliance',
    texto:
      'Nosso programa de Compliance garante que todas as práticas empresariais sigam os mais altos padrões éticos e as diretrizes da Lei Anticorrupção (Lei 12.846/2013). Com um Código de Ética e Conduta bem definido, alinhamos posturas e comportamentos a valores que reforçam nosso compromisso com clientes, fornecedores e agentes públicos.',
    link: '/documentos/codigo-de-etica-e-conduta.pdf',
    linkRotulo: 'Ler o código na íntegra (PDF)'
  },
  canal: {
    titulo: 'Canal de denúncias',
    texto:
      'Para garantir um ambiente ético e transparente, disponibilizamos um canal de denúncia anônimo e seguro, operado por uma empresa independente. Se identificar qualquer situação que viole nossos princípios de ética, integridade ou conduta, esse é o meio para relatar com total confidencialidade.',
    email: 'afirmaevias@denuncieonline.com.br',
    telefone: '0800 591 2420',
    url: 'https://denuncieonline.azurewebsites.net/CDs/AE/AE.html'
  },
  categoriasRelato: [
    'Conduta ética',
    'Assédio ou discriminação',
    'Conflito de interesses',
    'Fraude ou corrupção',
    'Segurança do trabalho',
    'Meio ambiente',
    'Outro'
  ]
};

export const vagas = {
  eyebrow: 'Trabalhe com a gente',
  titulo: 'Engenharia se faz<br>com gente boa.',
  chamada:
    'Se você quer trabalhar com obra de verdade, laboratório de ponta e tecnologia própria, manda seu currículo. A gente lê todos.',
  areas: [
    'Engenharia de projetos',
    'Supervisão e fiscalização de obras',
    'Laboratório e controle tecnológico',
    'Topografia e levantamentos',
    'BIM e modelagem',
    'Tecnologia da informação',
    'Administrativo e financeiro',
    'Estágio'
  ]
};

// -------------------------------------------------------------------- LGPD
// TEXTO PROPOSTO, REVISAR COM O JURÍDICO (versão 1.2, 06/11/2026): acrescenta o compartilhamento do contato/orçamento com o
// sistema comercial da própria Afirma E-vias (conexão 1 do hipersistema). A data abaixo e config.versaoPolitica
// (AAAA-MM-DD) andam juntas: o teste comercial-privacidade.test.ts cobra a correspondência, porque é config.versaoPolitica
// que vai como privacy_version no lead entregue ao Comercial e como versão do consentimento de cookies.
export const privacidade = {
  atualizadoEm: '6 de novembro de 2026',
  versao: '1.2',
  secoes: [
    {
      titulo: 'Quem somos e a quem esta política se aplica',
      paragrafos: [
        'A Afirma E-vias Engenharia Viária Ltda., inscrita no CNPJ sob o nº 05.205.684/0001-81, com sede na R. Baltazar Carrasco dos Reis, 2345, Rebouças, Curitiba/PR, é a controladora dos dados pessoais tratados por meio deste site, nos termos da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD).',
        'Esta política se aplica a qualquer pessoa que acesse www.afirmaevias.com.br, preencha um de nossos formulários ou se comunique conosco pelos canais aqui indicados. Ela não se aplica a sistemas internos de clientes, que possuem contratos e políticas próprias.'
      ]
    },
    {
      titulo: 'Quais dados coletamos',
      lista: [
        'Dados de contato e de pedido de orçamento que você digita nos formulários: nome, sobrenome, e-mail, telefone, empresa, CNPJ (opcional), assunto e o conteúdo da mensagem.',
        'Currículo enviado na página Trabalhe com a gente, incluindo os dados que você optar por incluir no arquivo.',
        'Dados de requisição de titular: nome, e-mail e, opcionalmente, CPF — que pedimos apenas para localizar seus registros e confirmar que a requisição é sua.',
        'Relatos de integridade, que podem ser enviados de forma totalmente anônima.',
        'Dados técnicos de navegação: endereço IP, agente de usuário, páginas visitadas e data e hora do acesso.',
        'Registro do seu consentimento de cookies, guardado como prova de escolha.'
      ],
      paragrafos: [
        'Nenhum campo deste site pede dado pessoal sensível, e pedimos que você não inclua esse tipo de informação em mensagens ou currículos. Ainda assim, se um dado sensível chegar até nós — por exemplo, informação de saúde escrita em um currículo —, ele continua sob nossa responsabilidade como controlador: fica no mesmo armazenamento restrito dos demais registros, com acesso limitado à equipe que precisa dele, toda consulta anotada na trilha de auditoria, e é eliminado junto com o registro ao fim do prazo de guarda ou antes, se você pedir.'
      ]
    },
    {
      titulo: 'Candidatos menores de 18 anos',
      paragrafos: [
        'Abrimos vagas de estágio, que podem interessar a adolescentes a partir de 16 anos. O tratamento de dados de criança e adolescente exige cuidado próprio, previsto no art. 14 da LGPD, e deve atender ao melhor interesse do titular.',
        'Se você tem menos de 18 anos, envie o currículo somente com a ciência e a autorização de um dos seus pais ou do seu responsável legal. Antes de avançar com a candidatura, nossa equipe de Recursos Humanos solicita essa autorização por escrito ao responsável e a arquiva junto do processo seletivo.',
        'Não condicionamos a participação no processo seletivo ao fornecimento de mais dados do que o necessário para avaliar a candidatura, e o responsável legal pode, a qualquer momento, pedir acesso, correção ou eliminação dos dados pelo canal do Encarregado.'
      ]
    },
    {
      titulo: 'Dados de terceiros citados em relatos de integridade',
      paragrafos: [
        'Um relato de integridade quase sempre menciona outra pessoa além de quem relata. Essa pessoa também é titular de dados, e o tratamento dessas informações se apoia no legítimo interesse de manter o programa de compliance e apurar o que foi noticiado (art. 7º, IX), além do cumprimento da Lei 14.457/2022 quanto ao canal de denúncias.',
        'O conteúdo de um relato não circula por e-mail nem por caixa compartilhada: o aviso que a equipe recebe informa apenas o protocolo, a categoria e se o relato é anônimo, e a leitura acontece no painel administrativo, com acesso restrito e registro de quem abriu cada registro.',
        'Os direitos do art. 18 valem também para quem é citado em um relato. O exercício desses direitos, porém, é ponderado caso a caso com a proteção de quem relatou e com a integridade da apuração: atender um pedido de acesso não pode servir para identificar o denunciante nem para inviabilizar a investigação. Pedidos desse tipo devem ser dirigidos ao Encarregado, que responde no prazo legal explicando a decisão.'
      ]
    },
    {
      titulo: 'Seu pedido de contato ou de orçamento e o sistema comercial da Afirma E-vias',
      paragrafos: [
        'Quando você envia o formulário de contato ou de orçamento, os dados que você preencheu — nome, e-mail, telefone, empresa, CNPJ, assunto e mensagem — ficam registrados neste site e são enviados, de forma protegida, ao sistema comercial da própria Afirma E-vias, para que nossa equipe comercial atenda a sua solicitação e elabore a proposta. Esse sistema pertence à Afirma E-vias, que continua sendo a controladora desses dados: não se trata de envio a outra empresa.',
        'Usamos esses dados somente para essa finalidade (responder o seu pedido, esclarecer o escopo e preparar a proposta) e para registrar o histórico do atendimento. A base legal é a execução de procedimentos preliminares relacionados a contrato, a pedido do titular (art. 7º, V). Não usamos esses dados para publicidade de terceiros nem os vendemos.',
        'No sistema comercial, o seu pedido é guardado pelo mesmo prazo de 24 meses aplicado neste site, contado do recebimento do formulário. Se o pedido evoluir para uma proposta ou um contrato, os dados passam a ser tratados também para a execução desse contrato e para o cumprimento das obrigações legais dele, com os prazos próprios que a lei exige.',
        'Você pode pedir acesso, correção, eliminação, oposição ou qualquer outro direito do art. 18 pelo Portal do titular. O pedido de eliminação alcança também a cópia mantida no sistema comercial: nossa equipe providencia a eliminação nos dois lugares, ressalvados os dados que precisemos manter por obrigação legal ou para o exercício regular de direitos em contrato já firmado.'
      ]
    },
    {
      titulo: 'Por que tratamos seus dados e com qual base legal',
      lista: [
        'Responder contatos comerciais e enviar propostas, o que inclui registrar o pedido no sistema comercial da Afirma E-vias — execução de procedimentos preliminares a contrato (art. 7º, V).',
        'Avaliar candidaturas em processos seletivos — execução de procedimentos preliminares a contrato (art. 7º, V).',
        'Atender requisições de titulares e comprovar conformidade — cumprimento de obrigação legal (art. 7º, II).',
        'Apurar relatos de integridade — legítimo interesse na manutenção do programa de compliance (art. 7º, IX).',
        'Manter o site seguro e funcional e prevenir fraudes — legítimo interesse (art. 7º, IX).',
        'Cookies analíticos e de marketing — hoje não usamos. Se passarmos a usar, pediremos antes o seu consentimento (art. 7º, I), revogável a qualquer momento.'
      ]
    },
    {
      titulo: 'Com quem compartilhamos',
      paragrafos: [
        'Não vendemos dados pessoais. Dentro da própria Afirma E-vias, o contato e o pedido de orçamento seguem para o sistema comercial da empresa, como explicado acima. Fora dela, compartilhamos apenas o necessário com: provedores de infraestrutura e hospedagem que operam sob contrato de tratamento (hoje, a Railway, que hospeda o site e o banco de dados, e a Resend, que entrega os avisos por e-mail à nossa equipe — esses avisos informam que chegou uma mensagem, mas não trazem o conteúdo dela); a empresa independente que opera nosso canal de denúncias; e autoridades públicas, quando houver requisição legal.',
        'Nossos servidores de aplicação e banco de dados podem estar localizados fora do Brasil. Nessas hipóteses, a transferência internacional observa o art. 33 da LGPD e é acompanhada de cláusulas contratuais de proteção.'
      ]
    },
    {
      titulo: 'Por quanto tempo guardamos',
      lista: [
        'Contatos comerciais: 24 meses contados do recebimento do formulário, também na cópia mantida no sistema comercial da Afirma E-vias (se o pedido virar proposta ou contrato, valem ainda os prazos próprios do contrato e das obrigações legais).',
        'Currículos: 12 meses, salvo se você pedir a exclusão antes.',
        'Requisições de titular e registros de consentimento: 5 anos, para prova de conformidade.',
        'Relatos de integridade: pelo prazo da apuração e mais 5 anos.',
        'Logs de acesso: 6 meses, conforme o Marco Civil da Internet.',
        'Trilha de auditoria do painel administrativo (acessos e ações da nossa equipe): 12 meses.'
      ]
    },
    {
      titulo: 'Seus direitos como titular',
      paragrafos: [
        'A LGPD garante que você confirme a existência de tratamento, acesse seus dados, corrija dados incompletos ou desatualizados, solicite anonimização, bloqueio ou eliminação, peça a portabilidade, revogue o consentimento, obtenha informação sobre compartilhamentos e se oponha a tratamentos feitos com base no legítimo interesse.',
        'Para exercer qualquer um desses direitos use o Portal do titular. Respondemos em até 15 dias e você recebe um protocolo para acompanhar.'
      ]
    },
    {
      titulo: 'Segurança',
      paragrafos: [
        'Adotamos medidas técnicas e administrativas compatíveis com a natureza dos dados: tráfego cifrado por TLS, senhas armazenadas com hash, acesso ao painel administrativo restrito e registrado em trilha de auditoria, e princípio do menor privilégio para a equipe.',
        'Em caso de incidente de segurança com risco relevante, comunicaremos você e a ANPD nos prazos legais.'
      ]
    },
    {
      titulo: 'Encarregado pelo tratamento de dados (DPO)',
      paragrafos: [
        'Dúvidas, pedidos e reclamações podem ser encaminhados ao nosso Encarregado pelo e-mail privacidade@afirmaevias.com.br ou pelo telefone (41) 3123-8550.'
      ]
    },
    {
      titulo: 'Alterações desta política',
      paragrafos: [
        'Podemos atualizar esta política para refletir mudanças legais ou operacionais. A versão vigente e a data da última atualização ficam sempre indicadas no topo desta página. Mudanças relevantes serão avisadas no site.'
      ]
    }
  ]
};

// O site hoje só usa o essencial: sessão do painel, preferência de tema e a
// memória desta escolha. Não há analytics, pixel nem publicidade, então não se
// oferece "Analíticos" nem "Marketing" - o banner prometia o que não existia.
// Se uma ferramenta de medição for escolhida, a categoria volta aqui junto com
// o código que só carrega depois do consentimento, e a política é atualizada.
export const cookies = {
  categorias: [
    {
      chave: 'necessarios',
      titulo: 'Necessários',
      texto:
        'Mantêm o site funcionando: sessão, segurança do formulário e memória da sua escolha de cookies. Não podem ser desligados.',
      obrigatorio: true
    }
  ]
};

export const tiposSolicitacaoLgpd = [
  { valor: 'confirmacao', rotulo: 'Confirmar se vocês tratam meus dados' },
  { valor: 'acesso', rotulo: 'Acessar os dados que vocês têm sobre mim' },
  { valor: 'correcao', rotulo: 'Corrigir dados incompletos ou errados' },
  { valor: 'eliminacao', rotulo: 'Eliminar meus dados' },
  { valor: 'portabilidade', rotulo: 'Receber meus dados em formato portável' },
  { valor: 'revogacao', rotulo: 'Revogar um consentimento que dei' },
  { valor: 'oposicao', rotulo: 'Me opor a um tratamento' },
  { valor: 'compartilhamento', rotulo: 'Saber com quem meus dados foram compartilhados' }
];

export const termos = {
  atualizadoEm: '25 de agosto de 2026',
  secoes: [
    {
      titulo: 'Uso do site',
      paragrafos: [
        'Este site é mantido pela Afirma E-vias para apresentar a empresa, seus serviços e canais de relacionamento. Ao navegar, você concorda com estes termos e com a Política de Privacidade.',
        'É vedado usar o site para fins ilícitos, tentar obter acesso não autorizado a áreas restritas, ou aplicar mecanismos automatizados que degradem a disponibilidade do serviço.'
      ]
    },
    {
      titulo: 'Conteúdo e propriedade intelectual',
      paragrafos: [
        'Marca, logotipo, textos, imagens e materiais técnicos publicados aqui pertencem à Afirma E-vias ou a seus licenciadores. A reprodução depende de autorização prévia por escrito.',
        'Informações técnicas divulgadas neste site têm caráter institucional e não substituem projeto, laudo ou parecer específico assinado por profissional habilitado.'
      ]
    },
    {
      titulo: 'Disponibilidade',
      paragrafos: [
        'Trabalhamos para manter o site no ar, mas ele pode ficar indisponível por manutenção ou por fatores fora do nosso controle. Não há garantia de disponibilidade ininterrupta.'
      ]
    },
    {
      titulo: 'Foro',
      paragrafos: [
        'Estes termos são regidos pela lei brasileira. Fica eleito o foro da comarca de Curitiba/PR para dirimir controvérsias.'
      ]
    }
  ]
};

// Logomarcas exibidas com anuência dos contratantes, confirmada pela diretoria
// em 31/08/2026. Marca de terceiro: uso apenas identificador, sem sugestão de
// endosso. Se algum contrato mudar, retire a entrada daqui.
export const clientes = [
  { arquivo: 'arteris.webp', nome: 'Arteris' },
  { arquivo: 'epr.webp', nome: 'EPR' },
  { arquivo: 'via-brasil.webp', nome: 'Via Brasil MT-246' },
  { arquivo: 'tcp.webp', nome: 'TCP — Terminal de Contêineres de Paranaguá' },
  { arquivo: 'ellenco.webp', nome: 'Ellenco' },
  { arquivo: 'via-araucaria.webp', nome: 'Via Araucária' },
  { arquivo: 'eixo-sp.webp', nome: 'EIXO SP' },
  { arquivo: 'entrevias.webp', nome: 'Entrevias' },
  { arquivo: 'cart.webp', nome: 'CART — Concessionária Auto Raposo Tavares' },
  { arquivo: 'via-appia.webp', nome: 'Via Appia' },
  { arquivo: 'rodovias-do-tiete.webp', nome: 'Rodovias do Tietê' },
  { arquivo: 'ecorodovias.webp', nome: 'Ecorodovias' },
  { arquivo: 'ccr.webp', nome: 'CCR' },
  { arquivo: 'votorantim.webp', nome: 'Votorantim' },
  { arquivo: 'compasa.webp', nome: 'Compasa do Brasil' },
  { arquivo: 'prefeitura-curitiba.webp', nome: 'Prefeitura de Curitiba' },
  { arquivo: 'ippuc.webp', nome: 'IPPUC' },
  { arquivo: 'der-parana.webp', nome: 'DER Paraná' },
  { arquivo: 'klabin.webp', nome: 'Klabin' }
];

export const notaClientes =
  'As marcas acima pertencem aos respectivos titulares e são exibidas com anuência, ' +
  'apenas para identificar contratantes atendidos. A exibição não implica endosso, ' +
  'parceria comercial ou representação.';

// Declaração de acessibilidade. Só afirma o que foi efetivamente medido nas
// páginas públicas — sem declarar nível A ou AA da WCAG, o que exigiria
// auditoria completa com leitor de tela e viraria compromisso auditável em
// edital. Se um cliente exigir o nível formal, contrate a auditoria e troque
// este texto pelo laudo.
export const acessibilidade = {
  eyebrow: 'Acessibilidade',
  titulo: 'Declaração de acessibilidade',
  atualizadoEm: '31 de agosto de 2026',
  intro:
    'Este site foi construído para ser usado por qualquer pessoa, inclusive quem navega por teclado, ' +
    'usa leitor de tela, precisa ampliar a página ou tem sensibilidade a movimento. Abaixo está o que ' +
    'verificamos, o que ainda não verificamos e como falar conosco se algo não funcionar para você.',
  verificado: {
    titulo: 'O que foi verificado',
    lista: [
      'Todas as imagens têm texto alternativo descritivo, e as decorativas são marcadas como tal.',
      'Cada página tem um único título de nível 1 e não pula níveis de título.',
      'A página pode ser ampliada: não usamos parâmetros que bloqueiem o zoom no celular.',
      'Toda a navegação funciona por teclado, com indicador de foco visível, e há link para pular direto ao conteúdo.',
      'Todos os campos de formulário têm rótulo associado, e o erro de envio é anunciado e recebe o foco.',
      'O contraste de texto foi medido nas páginas públicas: o menor valor encontrado é 5,69:1, acima do mínimo de 4,5:1.',
      'Quem configura o sistema para reduzir movimento não vê as animações de entrada nem o movimento decorativo.',
      'As tabelas e blocos largos rolam dentro da própria caixa, sem empurrar a página para os lados.'
    ]
  },
  limites: {
    titulo: 'O que ainda não foi verificado',
    paragrafos: [
      'Não realizamos auditoria completa com leitor de tela em todas as páginas, e por isso não declaramos ' +
        'conformidade formal com um nível da WCAG 2.1. Declarar nível sem laudo seria assumir um compromisso ' +
        'que não podemos comprovar.',
      'Os documentos em PDF disponibilizados para download — certificado e código de conduta — não passaram ' +
        'por adequação de acessibilidade. Se você precisar do conteúdo deles em outro formato, peça pelo canal abaixo ' +
        'e enviamos.'
    ]
  },
  contato: {
    titulo: 'Encontrou uma barreira?',
    texto:
      'Escreva contando o que aconteceu, em qual página e com qual recurso de acessibilidade você navega. ' +
      'Respondemos e corrigimos o que estiver ao nosso alcance.'
  }
};

// Imagem de fundo de cada herói, por rota. Existe para o <head> conseguir
// pré-carregar a imagem: ela é definida em CSS (background-image), e o
// navegador só a descobre depois de baixar e interpretar a folha inteira —
// era o que segurava o LCP. Se mudar aqui, mude também a regra em site.css.
export const heroiPorRota: Record<string, string> = {
  '/': '/img/obra-viaduto.webp',
  '/afirma-evias': '/img/obra-entroncamento.webp',
  '/servicos': '/img/obra-pavimentacao.webp'
};
