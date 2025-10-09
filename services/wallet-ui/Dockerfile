FROM node:20-alpine
WORKDIR /workspace/services/wallet-ui
COPY services/ui-kit ../ui-kit
COPY services/wallet-ui/package*.json ./
RUN npm install
RUN ln -sfn /workspace/services/wallet-ui/node_modules /workspace/services/node_modules
COPY services/wallet-ui .
EXPOSE 5175
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5175"]
