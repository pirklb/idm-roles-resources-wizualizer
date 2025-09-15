// Version: 1.0.32
import express from 'express';
import { Pool, QueryResult } from 'pg';
import path from 'path'; // Pfad-Modul für den Dateisystemzugriff
import cors from 'cors';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors()); // CORS wieder aktiviert, um ursprungsübergreifende Anfragen zu ermöglichen

// Setze den Pfad zu den statischen Frontend-Dateien
const frontendDistPath = path.join(__dirname, '../frontend/dist');

// Middleware, um statische Dateien auszuliefern
app.use(express.static(frontendDistPath));

// Datenbankkonfiguration aus Umgebungsvariablen
const pool = new Pool({
    user: process.env.DBUSER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_DATABASE || 'idm_rolemanagement_prod',
});

// `db.query` Funktion zur Kapselung von Datenbankaufrufen
const db = {
    query: async (text: string, params: any[] = []): Promise<QueryResult<any>> => {
        const start = Date.now();
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        console.log({ funk: 'db.query', parameters: { params }, info: { text, duration, rows: res.rowCount } });
        return res;
    },
};

// Überprüft, ob alle benötigten Tabellen existieren und ob die Verbindung funktioniert.
const checkTables = async () => {
    console.log('Überprüfe die Datenbanktabellen...');
    const tableCounts = {
        roles: 0,
        resources: 0,
        associations: 0,
        parents: 0,
    };

    try {
        const roleCount = await db.query('SELECT COUNT(*) FROM viz_roles');
        tableCounts.roles = parseInt(roleCount.rows[0].count, 10);
        const resourceCount = await db.query('SELECT COUNT(*) FROM viz_resources');
        tableCounts.resources = parseInt(resourceCount.rows[0].count, 10);
        const associationCount = await db.query('SELECT COUNT(*) FROM viz_roles_resources');
        tableCounts.associations = parseInt(associationCount.rows[0].count, 10);
        const parentCount = await db.query('SELECT COUNT(*) FROM viz_roles_parents');
        tableCounts.parents = parseInt(parentCount.rows[0].count, 10);
        console.log(`Datenbanktabellen sind vorhanden und bereit.`);
        console.log(`Anzahl der Rollen: ${tableCounts.roles}`);
        console.log(`Anzahl der Ressourcen: ${tableCounts.resources}`);
        console.log(`Anzahl der Assoziationen: ${tableCounts.associations}`);
        console.log(`Anzahl der Parent-Beziehungen: ${tableCounts.parents}`);
    } catch (error) {
        console.error('Fehler beim Überprüfen der Tabellen:', error);
        process.exit(1);
    }
};

// Datenbankfunktion zur Bestimmung des lokalisierten Namens
const createLocalizedFunction = async () => {
    try {
        await db.query(`
      CREATE OR REPLACE FUNCTION get_localized_text(localized_json JSONB, default_value TEXT)
      RETURNS TEXT AS $$
      BEGIN
          IF localized_json ? 'en' THEN
              RETURN localized_json ->> 'en';
          ELSIF localized_json ? 'de' THEN
              RETURN localized_json ->> 'de';
          ELSIF jsonb_array_length(localized_json) > 0 THEN
              RETURN (SELECT value FROM jsonb_each_text(localized_json) LIMIT 1);
          ELSE
              RETURN default_value;
          END IF;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);
        console.log('Datenbankfunktion get_localized_text wurde erstellt/aktualisiert.');
    } catch (error) {
        console.error('Fehler beim Erstellen der Datenbankfunktion:', error);
    }
};


// Startet den Server
app.listen(port, async () => {
    console.log(`Server läuft auf http://localhost:${port}`);
    await checkTables();
    await createLocalizedFunction();
});

// Endpunkt für Rollen-Suche mit Paginierung und erweiterter Suche
app.get('/api/roles', async (req, res) => {
    const { search, fields, from = 1, size = 10 } = req.query;
    const offset = Math.max(0, (parseInt(from as string, 10) || 1) - 1);
    const limit = parseInt(size as string, 10) || 10;

    let totalCountQuery = 'SELECT COUNT(*) FROM viz_roles';
    let dataQuery = `
    SELECT *, get_localized_text(nrflocalizednames, 'missing-name') as "sortname", get_localized_text(nrflocalizeddescrs, '') as "sortdesc" 
    FROM viz_roles 
  `;
    const queryParams: any[] = [];

    if (search) {
        let searchCondition = '';
        const searchFields = fields ? (fields as string).split(',') : ['dn', 'nrflocalizednames', 'nrflocalizeddescrs'];

        // Escaping the search term to treat _ and % as literal characters
        const escapedSearch = (search as string).replace(/%/g, '\\%').replace(/_/g, '\\_');
        const searchTerm = `%${escapedSearch}%`;

        searchFields.forEach((field, index) => {
            if (index > 0) {
                searchCondition += ' OR ';
            }
            if (['nrflocalizednames', 'nrflocalizeddescrs'].includes(field)) {
                searchCondition += `get_localized_text(${field}, '') ILIKE $${queryParams.length + 1} ESCAPE '\\'`;
            } else {
                searchCondition += `${field} ILIKE $${queryParams.length + 1} ESCAPE '\\'`;
            }
            queryParams.push(searchTerm);
        });

        totalCountQuery += ` WHERE ${searchCondition}`;
        dataQuery += ` WHERE ${searchCondition}`;
    }

    try {
        const totalCountResult = await db.query(totalCountQuery, queryParams);
        const totalCount = parseInt(totalCountResult.rows[0].count, 10);

        dataQuery += ` ORDER BY sortname ASC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(limit, offset);

        const rolesResult = await db.query(dataQuery, queryParams);

        const hasMore = totalCount > (offset + limit);

        res.json({
            data: rolesResult.rows,
            metadata: {
                total_count: totalCount,
                from: offset + 1,
                size: rolesResult.rows.length,
                more: hasMore,
            },
        });
    } catch (err: any) {
        console.error('Fehler beim Abrufen der Rollen:', err.message);
        res.status(500).json({ error: 'Fehler beim Abrufen der Rollen', details: err.message });
    }
});

// Endpunkt für Ressourcen-Suche mit Paginierung und erweiterter Suche
app.get('/api/resources', async (req, res) => {
    const { search, fields, from = 1, size = 10 } = req.query;
    const offset = Math.max(0, (parseInt(from as string, 10) || 1) - 1);
    const limit = parseInt(size as string, 10) || 10;

    let totalCountQuery = 'SELECT COUNT(*) FROM viz_resources';
    let dataQuery = `
    SELECT *, get_localized_text(nrflocalizednames, 'missing-name') as "sortname", get_localized_text(nrflocalizeddescrs, '') as "sortdesc" 
    FROM viz_resources
  `;
    const queryParams: any[] = [];

    if (search) {
        let searchCondition = '';
        const searchFields = fields ? (fields as string).split(',') : ['dn', 'nrflocalizednames', 'nrflocalizeddescrs', 'entitlement_xml_param_id', 'entitlement_xml_param_id2', 'entitlement_xml_param_id3'];

        // Escaping the search term to treat _ and % as literal characters
        const escapedSearch = (search as string).replace(/%/g, '\\%').replace(/_/g, '\\_');
        const searchTerm = `%${escapedSearch}%`;

        searchFields.forEach((field, index) => {
            if (index > 0) {
                searchCondition += ' OR ';
            }
            if (['nrflocalizednames', 'nrflocalizeddescrs'].includes(field)) {
                searchCondition += `get_localized_text(${field}, '') ILIKE $${queryParams.length + 1} ESCAPE '\\'`;
            } else {
                searchCondition += `${field} ILIKE $${queryParams.length + 1} ESCAPE '\\'`;
            }
            queryParams.push(searchTerm);
        });

        totalCountQuery += ` WHERE ${searchCondition}`;
        dataQuery += ` WHERE ${searchCondition}`;
    }

    try {
        const totalCountResult = await db.query(totalCountQuery, queryParams);
        const totalCount = parseInt(totalCountResult.rows[0].count, 10);

        dataQuery += ` ORDER BY sortname ASC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(limit, offset);

        const resourcesResult = await db.query(dataQuery, queryParams);

        const hasMore = totalCount > (offset + limit);

        res.json({
            data: resourcesResult.rows,
            metadata: {
                total_count: totalCount,
                from: offset + 1,
                size: resourcesResult.rows.length,
                more: hasMore,
            },
        });
    } catch (err: any) {
        console.error('Fehler beim Abrufen der Ressourcen:', err.message);
        res.status(500).json({ error: 'Fehler beim Abrufen der Ressourcen', details: err.message });
    }
});

// Endpunkt zum Abrufen einer spezifischen Rolle
app.get('/api/roles/:dn', async (req, res) => {
    const { dn } = req.params;
    try {
        const result = await db.query('SELECT *, get_localized_text(nrflocalizednames, \'missing-name\') as "sortname", get_localized_text(nrflocalizeddescrs, \'\') as "sortdesc" FROM viz_roles WHERE dn = $1', [dn]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).send('Rolle nicht gefunden.');
        }
    } catch (err) {
        res.status(500).send('Fehler beim Abrufen der Rolle.');
    }
});

// Endpunkt zum Abrufen einer spezifischen Ressource
app.get('/api/resources/:dn', async (req, res) => {
    const { dn } = req.params;
    try {
        const result = await db.query('SELECT *, get_localized_text(nrflocalizednames, \'missing-name\') as "sortname", get_localized_text(nrflocalizeddescrs, \'\') as "sortdesc" FROM viz_resources WHERE dn = $1', [dn]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).send('Ressource nicht gefunden.');
        }
    } catch (err) {
        res.status(500).send('Fehler beim Abrufen der Ressource.');
    }
});

// Neuer Endpunkt, um direkt zugeordnete Ressourcen für eine Rolle abzurufen
app.get('/api/roles/:dn/resources', async (req, res) => {
    const { dn } = req.params;
    try {
        const query = `
      SELECT
        res.*,
        get_localized_text(res.nrflocalizednames, 'missing-name') as "sortname",
        get_localized_text(res.nrflocalizeddescrs, '') as "sortdesc"
      FROM viz_roles_resources AS vrr
      JOIN viz_resources AS res ON vrr.nrfresource = res.dn
      WHERE vrr.nrfrole = $1;
    `;
        const result = await db.query(query, [dn]);
        res.json({ data: result.rows });
    } catch (err) {
        console.error('Fehler beim Abrufen der Ressourcen für die Rolle:', err);
        res.status(500).send('Fehler beim Abrufen der Ressourcen für die Rolle.');
    }
});


// Rekursiver Endpunkt zur Abfrage der gesamten Rollen-Hierarchie
app.get('/api/roles/:dn/full-hierarchy', async (req, res) => {
    const { dn } = req.params;

    try {
        const parentQuery = `
      WITH RECURSIVE parents_recursive AS (
        SELECT rp.parent_dn AS dn, 1 AS depth
        FROM viz_roles_parents AS rp
        WHERE rp.child_dn = $1
        UNION
        SELECT r.parent_dn AS dn, pr.depth + 1
        FROM viz_roles_parents AS r
        JOIN parents_recursive AS pr ON r.child_dn = pr.dn
      )
      SELECT r.*,
      get_localized_text(r.nrflocalizednames, 'missing-name') as "sortname",
      get_localized_text(r.nrflocalizeddescrs, '') as "sortdesc",
      pr.depth
      FROM viz_roles AS r
      JOIN parents_recursive AS pr ON r.dn = pr.dn;
    `;
        const parentsResult = await db.query(parentQuery, [dn]);

        const childrenQuery = `
      WITH RECURSIVE children_recursive AS (
        SELECT rp.child_dn AS dn, 1 AS depth
        FROM viz_roles_parents AS rp
        WHERE rp.parent_dn = $1
        UNION
        SELECT r.child_dn AS dn, cr.depth + 1
        FROM viz_roles_parents AS r
        JOIN children_recursive AS cr ON r.parent_dn = cr.dn
      )
      SELECT r.*,
      get_localized_text(r.nrflocalizednames, 'missing-name') as "sortname",
      get_localized_text(r.nrflocalizeddescrs, '') as "sortdesc",
      cr.depth
      FROM viz_roles AS r
      JOIN children_recursive AS cr ON r.dn = cr.dn;
    `;
        const childrenResult = await db.query(childrenQuery, [dn]);

        // Für jedes Child die direkt zugeordneten Ressourcen abrufen
        const childrenWithResources = await Promise.all(childrenResult.rows.map(async (child: any) => {
            const resourcesQuery = `
        SELECT res.*,
        get_localized_text(res.nrflocalizednames, 'missing-name') as "sortname",
        get_localized_text(res.nrflocalizeddescrs, '') as "sortdesc"
        FROM viz_roles_resources AS vrr
        JOIN viz_resources AS res ON vrr.nrfresource = res.dn
        WHERE vrr.nrfrole = $1;
      `;
            const resourcesResult = await db.query(resourcesQuery, [child.dn]);
            return { ...child, resources: resourcesResult.rows };
        }));

        res.json({
            data: {
                parents: parentsResult.rows,
                children: childrenWithResources,
            }
        });
    } catch (err) {
        console.error('Fehler beim Abrufen der Rollen-Hierarchie:', err);
        res.status(500).send('Fehler beim Abrufen der Rollen-Hierarchie.');
    }
});

// Endpunkt zum Abrufen aller Rollen, die eine Ressource zuweisen
app.get('/api/resources/:dn/roles', async (req, res) => {
    const { dn } = req.params;

    const query = `
    SELECT
      r.*,
      get_localized_text(r.nrflocalizednames, 'missing-name') as "sortname"
    FROM viz_roles_resources AS vrr
    JOIN viz_roles AS r ON vrr.nrfrole = r.dn
    WHERE vrr.nrfresource = $1
    ORDER BY sortname ASC;
  `;

    try {
        const result = await db.query(query, [dn]);
        res.json({ data: result.rows });
    } catch (err) {
        console.error('Fehler beim Abrufen der Rollen für die Ressource:', err);
        res.status(500).send('Fehler beim Abrufen der Rollen für die Ressource.');
    }
});

// Fallback-Route für das Frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
});
