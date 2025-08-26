/**
 * Hauptserver-Datei für das Node.js Backend.
 *
 * Dieses Programm implementiert alle Backend-Funktionalitäten:
 * - REST-API-Endpunkte mit Paginierung, die die PostgreSQL-Datenbank verwenden.
 * - Spezifische Endpunkte zum Abrufen von Rollen- und Ressourcen-Hierarchien.
 *
 * WICHTIG: Die gesamte LDAP-Logik und die Synchronisation wurden in ein separates
 * Go-Programm ausgelagert. Dieses Backend agiert als reiner API-Server.
 *
 * Um dieses Backend auszuführen:
 * 1. Stellen Sie sicher, dass Node.js und npm installiert sind.
 * 2. Führen Sie `npm install` aus, um die Abhängigkeiten zu installieren.
 * 3. Erstellen Sie eine `.env`-Datei mit den PostgreSQL-Anmeldeinformationen.
 * 4. Stellen Sie sicher, dass das Go-Programm einmalig ausgeführt wurde, um die Datenbank zu befüllen.
 * 5. Führen Sie `npm start` aus, um den Server zu starten.
 */
import express from 'express';
import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';
import cors from 'cors';

// Umgebungsvariablen laden
dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors()); // CORS für Frontend-Anfragen aktivieren

// PostgreSQL-Datenbank-Pool initialisieren
if (!process.env.DBUSER || !process.env.DB_PASSWORD || !process.env.DB_HOST) {
    console.error('Bitte legen Sie die Umgebungsvariablen DBUSER, DB_PASSWORD und DB_HOST fest.');
    throw new Error('Fehlende Umgebungsvariablen für die Datenbankverbindung.');
}

const clientPool = new Pool({
    user: process.env.DBUSER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_DATABASE ?? 'idm_rolemanagement_prod',
});

// Wrapper-Funktion für Datenbankabfragen
const query = async (text: string, params?: any[]): Promise<QueryResult> => {
    const start = Date.now();
    const res = await clientPool.query(text, params);
    const duration = Date.now() - start;
    console.log({ funk: 'db.query', parameters: { params }, info: { text, duration, rows: res.rowCount } });
    return res;
};

// Überprüfen der Datenbanktabellen (sollte vom Go-Programm erstellt worden sein)
const checkTables = async () => {
    try {
        const rolesResult = await query("SELECT COUNT(*) FROM viz_roles");
        console.log(`Tabelle viz_roles hat ${rolesResult.rows[0].count} Datensätze.`);

        const resourcesResult = await query("SELECT COUNT(*) FROM viz_resources");
        console.log(`Tabelle viz_resources hat ${resourcesResult.rows[0].count} Datensätze.`);

        const rolesResourcesResult = await query("SELECT COUNT(*) FROM viz_roles_resources");
        console.log(`Tabelle viz_roles_resources hat ${rolesResourcesResult.rows[0].count} Datensätze.`);

        const rolesParentsResult = await query("SELECT COUNT(*) FROM viz_roles_parents");
        console.log(`Tabelle viz_roles_parents hat ${rolesParentsResult.rows[0].count} Datensätze.`);

        console.log('Datenbanktabellen sind vorhanden und bereit.');
    } catch (error) {
        console.error('Fehler beim Überprüfen der Datenbanktabellen. Bitte stellen Sie sicher, dass das Go-Synchronisationsprogramm ausgeführt wurde:', error);
    }
};

// =========================================================================
// API-Endpunkte für die Visualisierung
// =========================================================================

// Endpunkt für alle Rollen (optional mit Suchfilter)
app.get('/api/roles', async (req, res) => {
    try {
        const { search } = req.query;
        let sqlQuery = "SELECT dn, nrflocalizednames, nrflocalizeddescrs FROM viz_roles WHERE is_deleted = FALSE";
        const params = [];
        if (search) {
            sqlQuery += " AND (nrflocalizednames ILIKE $1 OR nrflocalizeddescrs ILIKE $1)";
            params.push(`%${search}%`);
        }
        const result = await query(sqlQuery, params);
        res.json(result.rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Endpunkt für eine spezifische Rolle, inklusive ihrer Hierarchie
app.get('/api/roles/:dn', async (req, res) => {
    try {
        const { dn } = req.params;

        // Recursive query to get all child roles (direct and indirect)
        const hierarchyQuery = `
      WITH RECURSIVE role_hierarchy AS (
        -- Base case: the selected role itself
        SELECT dn, nrflocalizednames, nrflocalizeddescrs
        FROM viz_roles
        WHERE dn = $1 AND is_deleted = FALSE
        UNION ALL
        -- Recursive step: find children of the roles in the hierarchy
        SELECT r.dn, r.nrflocalizednames, r.nrflocalizeddescrs
        FROM viz_roles r
        JOIN viz_roles_parents rp ON r.dn = rp.child_dn
        JOIN role_hierarchy rh ON rp.parent_dn = rh.dn
      )
      SELECT DISTINCT dn, nrflocalizednames, nrflocalizeddescrs FROM role_hierarchy;
    `;
        const hierarchyResult = await query(hierarchyQuery, [dn]);

        // Get all resources for the selected role and its children
        const resourcesQuery = `
      SELECT r.dn, r.nrflocalizednames, r.nrflocalizeddescrs, rra.nrfRole AS role_dn
      FROM viz_resources r
      JOIN viz_roles_resources rra ON r.dn = rra.nrfResource
      WHERE rra.nrfRole = ANY($1::TEXT[]) AND r.is_deleted = FALSE;
    `;
        const allDns = hierarchyResult.rows.map(row => row.dn);
        const resourcesResult = await query(resourcesQuery, [allDns]);

        res.json({
            role: hierarchyResult.rows.find(row => row.dn === dn),
            hierarchy: hierarchyResult.rows,
            resources: resourcesResult.rows,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Endpunkt für alle Ressourcen (optional mit Suchfilter)
app.get('/api/resources', async (req, res) => {
    try {
        const { search } = req.query;
        let sqlQuery = "SELECT dn, nrflocalizednames, nrflocalizeddescrs FROM viz_resources WHERE is_deleted = FALSE";
        const params = [];
        if (search) {
            sqlQuery += " AND (nrflocalizednames ILIKE $1 OR nrflocalizeddescrs ILIKE $1)";
            params.push(`%${search}%`);
        }
        const result = await query(sqlQuery, params);
        res.json(result.rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Endpunkt für eine spezifische Ressource, die alle zugehörigen Rollen auflistet
app.get('/api/resources/:dn/roles', async (req, res) => {
    try {
        const { dn } = req.params;

        // Find all roles directly associated with this resource
        const rolesQuery = `
      SELECT r.dn, r.nrflocalizednames, r.nrflocalizeddescrs
      FROM viz_roles r
      JOIN viz_roles_resources rra ON r.dn = rra.nrfRole
      WHERE rra.nrfResource = $1 AND r.is_deleted = FALSE;
    `;
        const rolesResult = await query(rolesQuery, [dn]);

        // For each role, find its parent hierarchy
        const rolesWithHierarchy = await Promise.all(rolesResult.rows.map(async (role) => {
            const parentHierarchyQuery = `
        WITH RECURSIVE parent_hierarchy AS (
          -- Base case: the current role
          SELECT dn, nrflocalizednames, nrflocalizeddescrs
          FROM viz_roles
          WHERE dn = $1
          UNION ALL
          -- Recursive step: find parents of the roles in the hierarchy
          SELECT r.dn, r.nrflocalizednames, r.nrflocalizeddescrs
          FROM viz_roles r
          JOIN viz_roles_parents rp ON r.dn = rp.parent_dn
          JOIN parent_hierarchy ph ON rp.child_dn = ph.dn
        )
        SELECT * FROM parent_hierarchy;
      `;
            const parentHierarchyResult = await query(parentHierarchyQuery, [role.dn]);
            return {
                ...role,
                parentHierarchy: parentHierarchyResult.rows,
            };
        }));

        res.json({
            resource_dn: dn,
            roles: rolesWithHierarchy,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Server starten
app.listen(port, async () => {
    console.log(`Server läuft auf http://localhost:${port}`);
    await checkTables();
});
