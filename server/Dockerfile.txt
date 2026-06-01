FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --only=production && npx prisma generate

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN node node_modules/typescript/bin/tsc

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Prisma engines require OpenSSL on Alpine
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

# Create user, then chown everything so the nodejs user can write Prisma engine cache
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4000
# db push syncs the schema to the DB without needing migration files.
# Switch to `prisma migrate deploy` once you generate migrations with `prisma migrate dev`.
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --accept-data-loss && node dist/index.js"]
