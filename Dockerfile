# Version: 1.0.10
# Stage 1: Build Frontend
# Nutze ein Node.js-Image als Basis für den Frontend-Build-Prozess.
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Kopiere die Package-Definitionen, um Abhängigkeiten zu cachen.
COPY frontend/package.json frontend/package-lock.json ./

# Installiere die Frontend-Abhängigkeiten.
RUN npm install

# Kopiere die restlichen Frontend-Dateien, um den Build zu starten.
# Beachte: index.html liegt jetzt direkt im "frontend"-Ordner.
COPY frontend/tsconfig.json ./
COPY frontend/vite.config.ts ./
COPY frontend/src/ ./src/
COPY frontend/index.html ./

# Führe den Vite-Build-Prozess aus, um die statischen Dateien zu erstellen.
RUN npm run build


# Stage 2: Build Backend
# Nutze ein Node.js-Image als Basis für den Backend-Build-Prozess.
FROM node:20-alpine AS backend-builder
WORKDIR /app

# Kopiere die Package-Definitionen für das Backend.
COPY package.json package-lock.json ./

# Installiere die Backend-Abhängigkeiten.
# Da 'tsc' eine devDependency ist, installieren wir alle Pakete.
RUN npm install

# Kopiere die TypeScript-Konfiguration und den Quellcode des Backends.
COPY tsconfig.json ./
COPY backend/ ./backend/

# Füge das Build-Skript für das Backend hinzu
RUN npm pkg set scripts.build:backend="tsc"

# Kompiliere den TypeScript-Code zu JavaScript.
RUN npm run build:backend


# Final Stage
# Erstelle das endgültige, schlanke Image für den Produktions-Server.
# Es enthält nur die kompilierten Dateien und die notwendigen Abhängigkeiten.
FROM node:20-alpine

# Setze das Arbeitsverzeichnis auf den Root des Servers.
WORKDIR /app

# Kopiere die Package-Definitionen für die Produktion.
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/package-lock.json ./

# Kopiere die kompilierten Backend-Dateien aus der Backend-Build-Stage.
COPY --from=backend-builder /app/dist ./dist

# Kopiere das Frontend aus der Frontend-Build-Stage.
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Installiere nur die Produktions-Abhängigkeiten.
RUN npm install --omit=dev

# Exponiere den Port, auf dem der Server lauscht.
EXPOSE 3000

# Definiere den Befehl, der beim Starten des Containers ausgeführt wird.
CMD ["node", "dist/server.js"]
