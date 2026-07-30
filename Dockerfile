FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# The prisma CLI on its own, at the version the lockfile pins. Copying just
# node_modules/prisma out of the build stage is not enough: the CLI pulls in
# transitive deps (effect, @prisma/config, ...) that live elsewhere in the tree.
FROM node:22-alpine AS prisma-cli
WORKDIR /cli
COPY package-lock.json /tmp/package-lock.json
RUN npm init -y > /dev/null \
 && npm i --no-audit --no-fund \
      prisma@"$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")"

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Next's standalone bundle: server.js plus only the traced node_modules.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Generated client + query engine, and the schema/migrations the CLI applies.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY --from=prisma-cli /cli/node_modules ./prisma-cli/node_modules
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
