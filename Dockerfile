FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

RUN npm install -g turbo

COPY . .

WORKDIR /app/apps/web

RUN pnpm install

RUN cd ../.. && turbo run build --filter={apps/web}


CMD ["pnpm", "start"]

