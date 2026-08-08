FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && addgroup -S router && adduser -S router -G router
COPY --from=build /app/dist ./dist
USER router
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
