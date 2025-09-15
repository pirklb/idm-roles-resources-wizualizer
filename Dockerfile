# Version: 1.0.1
# Stufe 1: Frontend-Build
# Wir verwenden ein Node.js-Image, das für den Frontend-Build optimiert ist.
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Kopiere package.json und installiere die Frontend-Abhängigkeiten
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --frozen-lockfile

# Kopiere den Frontend-Quellcode und führe den Build aus
COPY frontend/ ./
RUN npm run build


# Stufe 2: Backend-Build
# Wir verwenden ein Node.js-Image, das für den Backend-Build optimiert ist.
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Kopiere package.json und installiere die Backend-Abhängigkeiten
COPY package.json package-lock.json ./
RUN npm install --frozen-lockfile

# Kopiere den Backend-Quellcode und führe den TypeScript-Build aus
COPY backend/ ./backend/
COPY tsconfig.json ./
RUN tsc


# Stufe 3: Finales Image
# Wir verwenden ein schlankes Node.js-Image für den finalen Container.
FROM node:20-alpine

# Setze das Arbeitsverzeichnis
WORKDIR /app

# Kopiere den Backend-Code und die Frontend-Build-Artefakte
COPY --from=backend-builder /app/dist ./dist
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY --from=backend-builder /app/node_modules ./node_modules

# Füge die Startskripts und die .env-Datei hinzu
COPY package.json .env ./
RUN npm prune --production

# Definiere den Port, den der Container überwacht
EXPOSE 3000

# Führe den Startbefehl aus, wenn der Container gestartet wird
CMD ["npm", "run", "start"]
