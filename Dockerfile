FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/erp/package.json apps/erp/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL=http://127.0.0.1:54321
ARG VITE_SUPABASE_PUBLISHABLE_KEY=local-development-key
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN npm run build:storefront

FROM nginx:1.27-alpine AS runtime

COPY docker/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider --quiet http://127.0.0.1/ || exit 1
