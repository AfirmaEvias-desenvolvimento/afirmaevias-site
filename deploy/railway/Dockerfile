# Site institucional (Afirma E-vias) no projeto Railway `aevias-hipersistema`: serviços `site` e `site-migrate`.
# Dockerfile Path: deploy/railway/Dockerfile   Contexto: raiz do repositório.   Veja RAILWAY-PRONTO.md.
#   site:          node dist/server.js              (CMD da imagem; healthcheck /health/live no PORT)
#   site-migrate:  node dist/migrate.js --runtime   (schema + GRANTs do site_app; Restart Never)
#   1º admin:      node dist/admin-inicial.js ...   (railway ssh --service site; só com designação do dono)
# Fica fora da raiz de propósito: o railway.json da raiz (Nixpacks) é do projeto Railway antigo do site e não muda.
# Base Debian slim: tem sh, grep, tr e printenv (embrulho dos *_CONTEUDO) e /tmp gravável pelo usuário node.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src src
# tsc + postbuild (copia src/views para dist/views); os testes compilados não vão para a imagem
RUN npm run build && find dist -name '*.test.js' -delete && find dist -name '*.test.js.map' -delete

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# O embrulho de start da Railway (variáveis *_CONTEUDO -> /tmp/arq) usa sh, grep, tr, printenv e env.
RUN for b in sh grep tr printenv env; do command -v "$b" >/dev/null || { echo "falta $b"; exit 1; }; done
# layout igual ao do repositório: dist/../public, dist/../db, dist/../contracts e process.cwd()/public
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY --from=build /app/dist dist
COPY db db
COPY public public
# pacote de contrato do AUTH (feed do RH), byte a byte: o SHA-256 é conferido na subida
COPY contracts/vendor contracts/vendor
# Currículos ficam no Postgres (bytea): nada é gravado em disco, então não há volume.
USER node
# 8080: listener público (PORT; HTTP atrás da borda com PUBLIC_HTTP=1). 9557: feed do RH em mTLS (INTEGRACAO_PORT, opcional).
EXPOSE 8080 9557
CMD ["node", "dist/server.js"]
