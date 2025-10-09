FROM node:20-alpine
WORKDIR /workspace/services/verifier-ui
COPY services/ui-kit ../ui-kit
COPY services/verifier-ui/package*.json ./
RUN npm install
RUN ln -sfn /workspace/services/verifier-ui/node_modules /workspace/services/node_modules
COPY services/verifier-ui .
EXPOSE 5176
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5176"]
