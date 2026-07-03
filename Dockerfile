FROM node:20-slim

# Install gcloud CLI
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -sSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz | tar -xz -C /opt && \
    /opt/google-cloud-sdk/install.sh --quiet --path-update=true && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/google-cloud-sdk/bin:${PATH}"

WORKDIR /app

# Install official GCP MCP packages directly
RUN npm init -y && \
    npm install @google-cloud/gcloud-mcp@latest \
                @google-cloud/storage-mcp@latest \
                @google-cloud/observability-mcp@latest \
                @google-cloud/cloud-run-mcp@latest

COPY sse-wrapper.mjs .

EXPOSE 3100

CMD ["node", "sse-wrapper.mjs"]
