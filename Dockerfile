FROM node:20-slim

# Install gcloud CLI
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -sSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz | tar -xz -C /opt && \
    /opt/google-cloud-sdk/install.sh --quiet --path-update=true && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/google-cloud-sdk/bin:${PATH}"

WORKDIR /app

# Copy package files
COPY package.json package-lock.json turbo.json ./
COPY packages/gcloud-mcp/package.json packages/gcloud-mcp/
COPY packages/observability-mcp/package.json packages/observability-mcp/
COPY packages/storage-mcp/package.json packages/storage-mcp/
COPY packages/backupdr-mcp/package.json packages/backupdr-mcp/

# Install dependencies
RUN npm ci --omit=dev

# Copy source and build
COPY . .
RUN npm run build

# Copy SSE wrapper
COPY sse-wrapper.mjs .

EXPOSE 3100

CMD ["node", "sse-wrapper.mjs"]
