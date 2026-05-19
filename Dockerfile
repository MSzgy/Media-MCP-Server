FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV MCP_PORT=3333
ENV MEDIA_OUTPUT_DIR=/app/outputs

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public

RUN mkdir -p /app/outputs /app/config && chown -R node:node /app
USER node

EXPOSE 3333

CMD ["node", "dist/index.js"]
