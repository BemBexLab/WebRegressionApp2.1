FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG ADMIN_PASSWORD=""
ARG API_URL="http://api:4000"
ARG STORAGE_URL="http://supabase-storage:5000"
ARG LOGIN_USER="admin"
ARG LOGIN_PASSWORD=""
ARG AUTH_SESSION_SECRET=""
ENV ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV API_URL=$API_URL
ENV STORAGE_URL=$STORAGE_URL
ENV LOGIN_USER=$LOGIN_USER
ENV LOGIN_PASSWORD=$LOGIN_PASSWORD
ENV AUTH_SESSION_SECRET=$AUTH_SESSION_SECRET
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
