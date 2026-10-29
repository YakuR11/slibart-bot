# 1) compile l'interface du Plinko (Activity Discord)
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY activity ./activity
COPY scripts ./scripts
RUN node scripts/build-activity.js

# 2) image finale du bot (sans les outils de build)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
COPY --from=build /app/activity/dist ./activity/dist
USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
