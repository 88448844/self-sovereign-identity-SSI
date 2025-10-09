FROM node:20-alpine
WORKDIR /workspace/services/issuer-ui
COPY services/ui-kit ../ui-kit
COPY services/issuer-ui/package*.json ./
RUN npm install
RUN ln -sfn /workspace/services/issuer-ui/node_modules /workspace/services/node_modules
COPY services/issuer-ui .
EXPOSE 5174
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5174"]
