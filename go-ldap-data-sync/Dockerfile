# Version: 1.0.4
# Build-Stage
# Wir verwenden das offizielle Go-Image, um den Quellcode zu kompilieren.
# Dieses Image enthält alle Build-Tools, die wir benötigen.
FROM golang:1.24-alpine AS builder

# Setze das Arbeitsverzeichnis im Container
WORKDIR /app

# Kopiere go.mod und go.sum, um die Abhängigkeiten zu cachen
COPY go.mod go.sum ./
# Lade die Abhängigkeiten herunter
RUN go mod download

# Kopiere den gesamten Quellcode in das Arbeitsverzeichnis
COPY . .

# Kompiliere das Go-Programm zu einer statischen ausführbaren Datei
# CGO_ENABLED=0 erstellt ein statisches Binary, das keine C-Bibliotheken benötigt.
# Dies ist entscheidend für das 'scratch'-Basis-Image.
RUN CGO_ENABLED=0 GOOS=linux go build -o main ./main.go


# Final-Stage
# Wir verwenden ein minimalistisches 'scratch'-Image, das nur die ausführbare Datei enthält.
# Das resultierende Image ist sehr klein und hat keine unnötigen Tools oder Bibliotheken.
FROM scratch

# Setze das Arbeitsverzeichnis im Container
WORKDIR /

# Füge die Zertifikate des Betriebssystems hinzu, damit HTTPS-Verbindungen funktionieren
# Dies ist wichtig für den ldaps-Server oder andere HTTPS-Aufrufe.
# Es kann weggelassen werden, wenn nur unverschlüsseltes ldap verwendet wird.
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Kopiere die ausführbare Datei aus der Build-Stage in das Final-Image
COPY --from=builder /app/main .

# Definiere den Befehl, der beim Starten des Containers ausgeführt wird
ENTRYPOINT ["./main"]
