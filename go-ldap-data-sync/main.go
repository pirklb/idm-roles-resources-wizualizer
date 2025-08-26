/**
 * Go-Programm zum Synchronisieren von LDAP-Daten mit einer PostgreSQL-Datenbank.
 *
 * Dieses Programm liest LDAP- und PostgreSQL-Verbindungsinformationen aus
 * Umgebungsvariablen, stellt eine Verbindung zu beiden her und kopiert die
 * Daten aus LDAP in die Datenbank.
 *
 * Um dieses Programm auszuführen:
 * 1. Stellen Sie sicher, dass Go installiert ist (go.dev/doc/install).
 * 2. Speichern Sie den Code als `main.go`.
 * 3. Initialisieren Sie das Go-Modul: `go mod init ldap-sync`.
 * 4. Installieren Sie die Abhängigkeiten:
 * `go get github.com/go-ldap/ldap/v3`
 * `go get github.com/jackc/pgx/v5`
 * 5. Erstellen Sie eine `.env`-Datei mit den Konfigurationen.
 * 6. Führen Sie das Programm aus:
 * - Für den normalen Betrieb: `go run main.go`
 * - Für den Trockenlauf (nur lesen, nicht schreiben): `DRY_RUN=true go run main.go`
 */
package main

import (
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"
	_ "github.com/jackc/pgx/v5/stdlib" // Wichtig: Blank Import zur Registrierung des "pgx"-Treibers
)

// LDAP-Suchbasen und Filter als Konstanten definieren, um Konsistenz zu gewährleisten
const (
	rolesSearchBase        = "cn=RoleDefs,cn=RoleConfig,cn=AppConfig,cn=UserApplication,cn=DriverSet,o=System"
	rolesFilter            = "(objectClass=nrfRole)"
	resourcesSearchBase    = "cn=ResourceDefs,cn=RoleConfig,cn=AppConfig,cn=UserApplication,cn=DriverSet,o=System"
	resourcesFilter        = "(objectClass=nrfResource)"
	associationsSearchBase = "cn=ResourceAssociations,cn=RoleConfig,cn=AppConfig,cn=UserApplication,cn=DriverSet,o=System"
	associationsFilter     = "(&(objectClass=nrfResourceAssociation)(nrfStatus=50))"
)

// Definition der Go-Struktur für die XML-Entität nrfEntitlementRef
type EntitlementRefXML struct {
	XMLName xml.Name `xml:"ref"`
	Src     string   `xml:"src"`
	ID      string   `xml:"id"`
	Param   string   `xml:"param"`
}

// Definition der Go-Struktur für das JSON-Objekt innerhalb von Param
type EntitlementParamJSON struct {
	ID  string `json:"ID"`
	ID2 string `json:"ID2"`
	ID3 string `json:"ID3"`
}

// Definition der Go-Struktur für den XML-Knoten in nrfdynamicparmvals
type DynamicParmValsXML struct {
	XMLName xml.Name `xml:"parameter"`
	Value   string   `xml:"value"`
}

// Konfiguration aus Umgebungsvariablen
type config struct {
	LDAPHost     string
	LDAPPort     string
	LDAPUser     string
	LDAPPassword string
	DBHost       string
	DBPort       string
	DBUser       string
	DBPassword   string
	DBDatabase   string
	DryRun       bool
	PurgeAgeInDays int
}

// initConfig liest die Konfiguration aus den Umgebungsvariablen.
func initConfig() config {
	cfg := config{
		LDAPHost:     os.Getenv("LDAP_HOST"),
		LDAPPort:     os.Getenv("LDAP_PORT"),
		LDAPUser:     os.Getenv("LDAP_USERNAME"),
		LDAPPassword: os.Getenv("LDAP_PASSWORD"),
		DBHost:       os.Getenv("DB_HOST"),
		DBPort:       os.Getenv("DB_PORT"),
		DBUser:       os.Getenv("DBUSER"),
		DBPassword:   os.Getenv("DB_PASSWORD"),
		DBDatabase:   os.Getenv("DB_DATABASE"),
		DryRun:       os.Getenv("DRY_RUN") == "true",
	}

	if cfg.LDAPPort == "" {
		cfg.LDAPPort = "389" // Geändert auf Standard-LDAP-Port
	}
	if cfg.DBPort == "" {
		cfg.DBPort = "5432"
	}
	if cfg.DBDatabase == "" {
		cfg.DBDatabase = "idm_rolemanagement_prod"
	}
	
	purgeAgeStr := os.Getenv("PURGE_AGE_IN_DAYS")
	if purgeAgeStr == "" {
		cfg.PurgeAgeInDays = 7
	} else {
		_, err := fmt.Sscan(purgeAgeStr, &cfg.PurgeAgeInDays)
		if err != nil {
			log.Printf("Ungültiger Wert für PURGE_AGE_IN_DAYS, verwende Standardwert 7. Fehler: %v", err)
			cfg.PurgeAgeInDays = 7
		}
	}


	if cfg.LDAPHost == "" || cfg.LDAPUser == "" || cfg.LDAPPassword == "" {
		log.Fatal("Bitte setzen Sie die erforderlichen Umgebungsvariablen für LDAP (LDAP_HOST, LDAP_USERNAME, LDAP_PASSWORD).")
	}

	return cfg
}

// main ist der Haupteinstiegspunkt des Programms.
func main() {
	cfg := initConfig()

	if cfg.DryRun {
		log.Println("Starte den Trockenlauf-Modus: Es werden KEINE Daten in die Datenbank geschrieben.")
	} else {
		if cfg.DBHost == "" || cfg.DBUser == "" || cfg.DBPassword == "" {
			log.Fatal("Bitte setzen Sie die erforderlichen Umgebungsvariablen für die Datenbank (DB_HOST, DBUSER, DB_PASSWORD).")
		}
		log.Println("Starte den normalen Modus: Daten werden von LDAP gelesen und in die Datenbank geschrieben.")
	}

	// Verbinde zur LDAP-Datenbank über unverschlüsselte Verbindung
	ldapConn, err := ldap.DialURL(fmt.Sprintf("ldap://%s:%s", cfg.LDAPHost, cfg.LDAPPort))
	if err != nil {
		log.Fatalf("Fehler beim Verbinden zu LDAP: %v", err)
	}
	defer ldapConn.Close()

	err = ldapConn.Bind(cfg.LDAPUser, cfg.LDAPPassword)
	if err != nil {
		log.Fatalf("Fehler beim Binden an LDAP: %v", err)
	}

	if !cfg.DryRun {
		// Verbinde zur PostgreSQL-Datenbank
		dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
			cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBDatabase)

		db, err := sql.Open("pgx", dsn)
		if err != nil {
			log.Fatalf("Fehler beim Öffnen der Datenbank: %v", err)
		}
		defer db.Close()

		// Prüfe die Datenbankverbindung
		err = db.Ping()
		if err != nil {
			log.Fatalf("Fehler beim Verbinden zur Datenbank: %v", err)
		}

		log.Println("Erfolgreich mit LDAP und PostgreSQL verbunden.")
		
		// Sicherstellen, dass die Tabellen existieren, bevor Daten eingefügt werden
		createTables(db)

		// Hole den Zeitstempel für den aktuellen Synchronisationslauf
		syncStartTimestamp := time.Now()

		// Synchronisiere alle Daten
		syncRoles(ldapConn, db, syncStartTimestamp)
		syncResources(ldapConn, db, syncStartTimestamp)
		syncAssociations(ldapConn, db, syncStartTimestamp)

		// Führe die Markierungs- und Löschlogik aus
		markAndPurge(db, syncStartTimestamp, cfg.PurgeAgeInDays)

	} else {
		// Im Trockenlauf-Modus nur die Anzahl der Einträge ausgeben
		log.Println("Verbindung zu PostgreSQL übersprungen.")
		countRoles(ldapConn)
		countResources(ldapConn)
		countAssociations(ldapConn)
	}

	log.Println("Synchronisation abgeschlossen. Programm wird beendet.")
}

// ldapSearch führt eine LDAP-Abfrage aus und gibt die Ergebnisse zurück.
func ldapSearch(conn *ldap.Conn, searchBase, filter string, attributes []string) ([]*ldap.Entry, error) {
	searchRequest := ldap.NewSearchRequest(
		searchBase,
		ldap.ScopeWholeSubtree,
		ldap.NeverDerefAliases,
		0,
		0,
		false,
		filter,
		attributes,
		nil,
	)

	sr, err := conn.Search(searchRequest)
	if err != nil {
		return nil, fmt.Errorf("LDAP-Suchfehler: %w", err)
	}

	return sr.Entries, nil
}

// countRoles gibt nur die Anzahl der Rollen aus.
func countRoles(conn *ldap.Conn) {
	log.Println("Zähle Rollen...")
	entries, err := ldapSearch(
		conn,
		rolesSearchBase, // Verwendung der Konstante
		rolesFilter,     // Verwendung der Konstante
		[]string{"dn"},
	)
	if err != nil {
		log.Printf("Fehler beim Zählen der Rollen: %v", err)
		return
	}
	log.Printf("Anzahl der gefundenen Rollen: %d", len(entries))
}

// countResources gibt nur die Anzahl der Ressourcen aus.
func countResources(conn *ldap.Conn) {
	log.Println("Zähle Ressourcen...")
	entries, err := ldapSearch(
		conn,
		resourcesSearchBase, // Verwendung der Konstante
		resourcesFilter,     // Verwendung der Konstante
		[]string{"dn"},
	)
	if err != nil {
		log.Printf("Fehler beim Zählen der Ressourcen: %v", err)
		return
	}
	log.Printf("Anzahl der gefundenen Ressourcen: %d", len(entries))
}

// countAssociations gibt nur die Anzahl der Assoziationen aus.
func countAssociations(conn *ldap.Conn) {
	log.Println("Zähle Assoziationen...")
	entries, err := ldapSearch(
		conn,
		associationsSearchBase, // Verwendung der Konstante
		associationsFilter,     // Verwendung der Konstante
		[]string{"dn"},
	)
	if err != nil {
		log.Printf("Fehler beim Zählen der Assoziationen: %v", err)
		return
	}
	log.Printf("Anzahl der gefundenen Assoziationen: %d", len(entries))
}

// createTables stellt sicher, dass alle notwendigen Datenbanktabellen existieren.
func createTables(db *sql.DB) {
	log.Println("Überprüfe und erstelle Datenbanktabellen...")
	// Die Spalte `nrfParentRoles` wurde aus dieser Tabelle entfernt
	_, err := db.Exec(`
      CREATE TABLE IF NOT EXISTS viz_roles (
        dn TEXT PRIMARY KEY,
        nrfRoleLevel TEXT,
        nrfLocalizedNames TEXT,
        nrfLocalizedDescrs TEXT,
        nrfRoleCategoryKey TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        is_deleted BOOLEAN DEFAULT FALSE
      );
    `)
	if err != nil {
		log.Fatalf("Fehler beim Erstellen der Tabelle viz_roles: %v", err)
	}

	// Neue Junction-Tabelle für die Parent-Child-Beziehung
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS viz_roles_parents (
			child_dn TEXT REFERENCES viz_roles(dn) ON DELETE CASCADE,
			parent_dn TEXT REFERENCES viz_roles(dn) ON DELETE CASCADE,
			PRIMARY KEY (child_dn, parent_dn)
		);
	`)
	if err != nil {
		log.Fatalf("Fehler beim Erstellen der Tabelle viz_roles_parents: %v", err)
	}

	_, err = db.Exec(`
      CREATE TABLE IF NOT EXISTS viz_resources (
        dn TEXT PRIMARY KEY,
        nrfLocalizedNames TEXT,
        nrfLocalizedDescrs TEXT,
        nrfCategoryKey TEXT,
        nrfAllowMulti TEXT,
        entitlement_driver TEXT,
        entitlement_status TEXT,
        entitlement_xml TEXT,
        entitlement_xml_src TEXT,
        entitlement_xml_id TEXT,
        entitlement_xml_param_id TEXT,
        entitlement_xml_param_id2 TEXT,
        entitlement_xml_param_id3 TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        is_deleted BOOLEAN DEFAULT FALSE
      );
    `)
	if err != nil {
		log.Fatalf("Fehler beim Erstellen der Tabelle viz_resources: %v", err)
	}

	_, err = db.Exec(`
      CREATE TABLE IF NOT EXISTS viz_roles_resources (
        dn TEXT PRIMARY KEY,
        nrfRole TEXT,
        nrfResource TEXT,
        nrfDynamicParmVals TEXT,
        nrfdynamicparmvals_value_json TEXT,
        nrfStatus TEXT,
        createTimestamp TEXT,
        modifyTimestamp TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        is_deleted BOOLEAN DEFAULT FALSE
      );
    `)
	if err != nil {
		log.Fatalf("Fehler beim Erstellen der Tabelle viz_roles_resources: %v", err)
	}
	log.Println("Datenbanktabellen wurden erstellt oder existieren bereits.")
}

// writeJSONToFile saves data to a JSON file for debugging.
func writeJSONToFile(filename string, data interface{}) {
    file, err := os.Create(filename)
    if err != nil {
        log.Printf("Fehler beim Erstellen der Debug-Datei %s: %v", filename, err)
        return
    }
    defer file.Close()

    encoder := json.NewEncoder(file)
    encoder.SetIndent("", "  ")
    if err := encoder.Encode(data); err != nil {
        log.Printf("Fehler beim Schreiben in die Debug-Datei %s: %v", filename, err)
    } else {
        log.Printf("Raw LDAP-Daten in %s geschrieben.", filename)
    }
}

// markAndPurge markiert nicht aktualisierte Einträge als gelöscht und löscht alte Einträge.
func markAndPurge(db *sql.DB, syncStartTimestamp time.Time, purgeAgeInDays int) {
	// Zeitstempel für die Markierung
	timestampStr := syncStartTimestamp.Format(time.RFC3339)

	// Markiere veraltete Datensätze als gelöscht
	log.Println("Markiere veraltete Datensätze als gelöscht...")
	tables := []string{"viz_roles", "viz_resources", "viz_roles_resources"}
	for _, table := range tables {
		result, err := db.Exec(`UPDATE `+ table +` SET is_deleted = TRUE WHERE updated_at < $1`, timestampStr)
		if err != nil {
			log.Printf("Fehler beim Markieren von Datensätzen in Tabelle %s: %v", table, err)
			continue
		}
		rowsAffected, _ := result.RowsAffected()
		log.Printf("Tabelle %s: %d Datensätze als gelöscht markiert.", table, rowsAffected)
	}

	// Lösche alte Datensätze
	log.Println("Lösche alte, gelöschte Datensätze...")
	purgeTimestamp := syncStartTimestamp.AddDate(0, 0, -purgeAgeInDays).Format(time.RFC3339)
	for _, table := range tables {
		result, err := db.Exec(`DELETE FROM `+ table +` WHERE is_deleted = TRUE AND updated_at < $1`, purgeTimestamp)
		if err != nil {
			log.Printf("Fehler beim Löschen alter Datensätze in Tabelle %s: %v", table, err)
			continue
		}
		rowsAffected, _ := result.RowsAffected()
		log.Printf("Tabelle %s: %d alte Datensätze gelöscht.", table, rowsAffected)
	}
}

// syncRoles synchronisiert die Rollen von LDAP zur Datenbank.
func syncRoles(conn *ldap.Conn, db *sql.DB, syncStartTimestamp time.Time) {
	log.Println("Synchronisiere Rollen...")
	entries, err := ldapSearch(
		conn,
		rolesSearchBase, // Verwendung der Konstante
		rolesFilter,     // Verwendung der Konstante
		[]string{"dn", "nrfRoleLevel", "nrfLocalizedNames", "nrfLocalizedDescrs", "nrfRoleCategoryKey", "nrfParentRoles"},
	)
	if err != nil {
		log.Printf("Fehler beim Synchronisieren der Rollen: %v", err)
        writeJSONToFile("roles_raw_data.json", entries)
		return
	}
	log.Printf("Gefundene Rollen: %d", len(entries))
    writeJSONToFile("roles_raw_data.json", entries)

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Fehler beim Starten der Transaktion für Rollen: %v", err)
		return
	}
	defer tx.Rollback()

	// Phase 1: Rollen in die viz_roles-Tabelle einfügen
	log.Println("Phase 1: Füge Rollen in die Tabelle viz_roles ein...")
	roleStmt, err := tx.Prepare(
		`INSERT INTO viz_roles (dn, nrfRoleLevel, nrfLocalizedNames, nrfLocalizedDescrs, nrfRoleCategoryKey, created_at, updated_at, is_deleted) 
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
		 ON CONFLICT (dn) DO UPDATE SET 
		 	nrfrolelevel = EXCLUDED.nrfrolelevel, 
		 	nrflocalizednames = EXCLUDED.nrflocalizednames, 
		 	nrflocalizeddescrs = EXCLUDED.nrflocalizeddescrs, 
		 	nrfrolecategorykey = EXCLUDED.nrfrolecategorykey, 
			updated_at = $7,
			is_deleted = FALSE`,
	)
	if err != nil {
		log.Printf("Fehler beim Vorbereiten des Statements für Rollen: %v", err)
		return
	}
	defer roleStmt.Close()

	timestampStr := syncStartTimestamp.Format(time.RFC3339)

	for _, entry := range entries {
		var nrfRoleCategoryKey string
		// Geändertes Attribut-Parsing zur Vermeidung von Index-Fehlern
		nrfRoleLevel := entry.GetAttributeValue("nrfRoleLevel")
		nrfLocalizedNames := entry.GetAttributeValue("nrfLocalizedNames")
		nrfLocalizedDescrs := entry.GetAttributeValue("nrfLocalizedDescrs")
		
		roleCategoryKeys := entry.GetAttributeValues("nrfRoleCategoryKey")
		if len(roleCategoryKeys) > 0 {
			nrfRoleCategoryKey = strings.Join(roleCategoryKeys, "|")
		}

		localizedNamesJSON, _ := json.Marshal(parseLocalizedAttributes(nrfLocalizedNames))
		localizedDescrsJSON, _ := json.Marshal(parseLocalizedAttributes(nrfLocalizedDescrs))

		_, err := roleStmt.Exec(entry.DN, nrfRoleLevel, string(localizedNamesJSON), string(localizedDescrsJSON), nrfRoleCategoryKey, timestampStr, timestampStr, false)
		if err != nil {
			log.Printf("Fehler beim Einfügen der Rolle %s: %v", entry.DN, err)
			tx.Rollback()
			return
		}
	}
	log.Println("Phase 1 abgeschlossen. Rollen erfolgreich eingefügt.")

	// Phase 2: Junction-Tabelle mit den Parent-Beziehungen füllen
	log.Println("Phase 2: Füge Parent-Beziehungen in die Tabelle viz_roles_parents ein...")
	_, err = tx.Exec(`DELETE FROM viz_roles_parents`)
	if err != nil {
		log.Printf("Fehler beim Löschen alter Rollenbeziehungen: %v", err)
		tx.Rollback()
		return
	}
	parentStmt, err := tx.Prepare(
		`INSERT INTO viz_roles_parents (child_dn, parent_dn) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
	)
	if err != nil {
		log.Printf("Fehler beim Vorbereiten des Statements für Rollenbeziehungen: %v", err)
		tx.Rollback()
		return
	}
	defer parentStmt.Close()

	for _, entry := range entries {
		parentRoles := entry.GetAttributeValues("nrfParentRoles")
		if len(parentRoles) > 0 {
			for _, parentDN := range parentRoles {
				_, err := parentStmt.Exec(entry.DN, parentDN)
				if err != nil {
					log.Printf("Fehler beim Einfügen der Parent-Beziehung für %s: %v", entry.DN, err)
					// Bei einem Fehler hier wird die Transaktion abgebrochen. Wir loggen und rollen zurück.
					tx.Rollback()
					return
				}
			}
		}
	}
	log.Println("Phase 2 abgeschlossen. Parent-Beziehungen erfolgreich eingefügt.")

	tx.Commit()
	log.Println("Rollensynchronisation abgeschlossen.")
}

// syncResources synchronisiert die Ressourcen von LDAP zur Datenbank.
func syncResources(conn *ldap.Conn, db *sql.DB, syncStartTimestamp time.Time) {
	log.Println("Synchronisiere Ressourcen...")
	entries, err := ldapSearch(
		conn,
		resourcesSearchBase, // Verwendung der Konstante
		resourcesFilter,     // Verwendung der Konstante
		[]string{"dn", "nrfLocalizedNames", "nrfLocalizedDescrs", "nrfCategoryKey", "nrfAllowMulti", "nrfEntitlementRef"},
	)
	if err != nil {
		log.Printf("Fehler beim Synchronisieren der Ressourcen: %v", err)
        writeJSONToFile("resources_raw_data.json", entries)
		return
	}
	log.Printf("Gefundene Ressourcen: %d", len(entries))
    writeJSONToFile("resources_raw_data.json", entries)

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Fehler beim Starten der Transaktion für Ressourcen: %v", err)
		return
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT INTO viz_resources (
            dn, nrfLocalizedNames, nrfLocalizedDescrs, nrfCategoryKey, nrfAllowMulti, 
            entitlement_driver, entitlement_status, entitlement_xml, entitlement_xml_src, 
            entitlement_xml_id, entitlement_xml_param_id, entitlement_xml_param_id2, entitlement_xml_param_id3,
            created_at, updated_at, is_deleted
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (dn) DO UPDATE SET 
            nrflocalizednames = EXCLUDED.nrflocalizednames, 
            nrflocalizeddescrs = EXCLUDED.nrflocalizeddescrs, 
            nrfcategorykey = EXCLUDED.nrfcategorykey, 
            nrfallowmulti = EXCLUDED.nrfallowmulti, 
            entitlement_driver = EXCLUDED.entitlement_driver,
            entitlement_status = EXCLUDED.entitlement_status,
            entitlement_xml = EXCLUDED.entitlement_xml,
            entitlement_xml_src = EXCLUDED.entitlement_xml_src,
            entitlement_xml_id = EXCLUDED.entitlement_xml_id,
            entitlement_xml_param_id = EXCLUDED.entitlement_xml_param_id,
            entitlement_xml_param_id2 = EXCLUDED.entitlement_xml_param_id2,
            entitlement_xml_param_id3 = EXCLUDED.entitlement_xml_param_id3,
            updated_at = $15,
            is_deleted = FALSE`,
	)
	if err != nil {
		log.Printf("Fehler beim Vorbereiten des Statements für Ressourcen: %v", err)
		return
	}
	defer stmt.Close()
	
	timestampStr := syncStartTimestamp.Format(time.RFC3339)

	for _, entry := range entries {
		// Ursprüngliche Attribute
		nrfLocalizedNames := entry.GetAttributeValue("nrfLocalizedNames")
		nrfLocalizedDescrs := entry.GetAttributeValue("nrfLocalizedDescrs")
		nrfCategoryKey := entry.GetAttributeValue("nrfCategoryKey")
		nrfAllowMulti := entry.GetAttributeValue("nrfAllowMulti")
		nrfEntitlementRef := entry.GetAttributeValue("nrfEntitlementRef")

		// Standardwerte für die neuen Felder
		var entitlementDriver, entitlementStatus, entitlementXML string
		var entitlementXMLSrc, entitlementXMLID string
		var entitlementXMLParamID, entitlementXMLParamID2, entitlementXMLParamID3 string

		// Schritt 1: Parsen des nrfEntitlementRef-Strings
		refParts := strings.SplitN(nrfEntitlementRef, "#", 3)
		if len(refParts) > 0 {
			entitlementDriver = refParts[0]
		}
		if len(refParts) > 1 {
			entitlementStatus = refParts[1]
		}
		if len(refParts) > 2 {
			entitlementXML = refParts[2]
		}

		// Schritt 2: Parsen des XML-Blocks
		if entitlementXML != "" {
			var ref EntitlementRefXML
			err := xml.Unmarshal([]byte(entitlementXML), &ref)
			if err == nil {
				entitlementXMLSrc = ref.Src
				entitlementXMLID = ref.ID

				// Schritt 3: Parsen des JSON-Blocks im Param-Feld
				if ref.Param != "" {
					var param EntitlementParamJSON
					err := json.Unmarshal([]byte(ref.Param), &param)
					if err == nil {
						entitlementXMLParamID = param.ID
						entitlementXMLParamID2 = param.ID2
						entitlementXMLParamID3 = param.ID3
					} else {
						// Wenn das Param-Feld kein JSON ist, versuchen wir, es direkt zu übernehmen.
						// Das ist in den Beispielen nicht der Fall, aber es ist eine gute
						// Absicherung gegen unerwartete Daten.
						entitlementXMLParamID = ref.Param
					}
				}
			}
		}

		localizedNamesJSON, _ := json.Marshal(parseLocalizedAttributes(nrfLocalizedNames))
		localizedDescrsJSON, _ := json.Marshal(parseLocalizedAttributes(nrfLocalizedDescrs))
		
		_, err = stmt.Exec(
			entry.DN,
			string(localizedNamesJSON),
			string(localizedDescrsJSON),
			nrfCategoryKey,
			nrfAllowMulti,
			entitlementDriver,
			entitlementStatus,
			entitlementXML,
			entitlementXMLSrc,
			entitlementXMLID,
			entitlementXMLParamID,
			entitlementXMLParamID2,
			entitlementXMLParamID3,
			timestampStr,
			timestampStr,
			false,
		)
		if err != nil {
			log.Printf("Fehler beim Einfügen der Ressource %s: %v", entry.DN, err)
			tx.Rollback()
			return
		}
	}
	tx.Commit()
	log.Println("Ressourcensynchronisation abgeschlossen.")
}

// syncAssociations synchronisiert die Assoziationen von LDAP zur Datenbank.
func syncAssociations(conn *ldap.Conn, db *sql.DB, syncStartTimestamp time.Time) {
	log.Println("Synchronisiere Assoziationen...")
	entries, err := ldapSearch(
		conn,
		associationsSearchBase, // Verwendung der Konstante
		associationsFilter,     // Verwendung der Konstante
		[]string{"dn", "nrfRole", "nrfResource", "nrfDynamicParmVals", "nrfStatus", "createTimestamp", "modifyTimestamp"},
	)
	if err != nil {
		log.Printf("Fehler beim Synchronisieren der Assoziationen: %v", err)
        writeJSONToFile("associations_raw_data.json", entries)
		return
	}
	log.Printf("Gefundene Assoziationen: %d", len(entries))
    writeJSONToFile("associations_raw_data.json", entries)

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Fehler beim Starten der Transaktion für Assoziationen: %v", err)
		return
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(
		`INSERT INTO viz_roles_resources (
			dn, nrfRole, nrfResource, nrfDynamicParmVals, nrfdynamicparmvals_value_json, nrfStatus, createTimestamp, modifyTimestamp, 
			created_at, updated_at, is_deleted
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
		 ON CONFLICT (dn) DO UPDATE SET 
		 	nrfrole = EXCLUDED.nrfrole, 
		 	nrfresource = EXCLUDED.nrfresource, 
		 	nrfdynamicparmvals = EXCLUDED.nrfdynamicparmvals, 
		 	nrfdynamicparmvals_value_json = EXCLUDED.nrfdynamicparmvals_value_json,
		 	nrfstatus = EXCLUDED.nrfstatus, 
		 	createTimestamp = EXCLUDED.createTimestamp, 
		 	modifyTimestamp = EXCLUDED.modifyTimestamp,
			updated_at = $10,
			is_deleted = FALSE`,
	)
	if err != nil {
		log.Printf("Fehler beim Vorbereiten des Statements für Assoziationen: %v", err)
		tx.Rollback()
		return
	}
	defer stmt.Close()
	
	timestampStr := syncStartTimestamp.Format(time.RFC3339)

	for _, entry := range entries {
		nrfRole := entry.GetAttributeValue("nrfRole")
		nrfResource := entry.GetAttributeValue("nrfResource")
		nrfDynamicParmVals := entry.GetAttributeValue("nrfDynamicParmVals")
		nrfStatus := entry.GetAttributeValue("nrfStatus")
		createTimestamp := entry.GetAttributeValue("createTimestamp")
		modifyTimestamp := entry.GetAttributeValue("modifyTimestamp")
		
		var nrfdynamicparmvalsValueJSON string
		if nrfDynamicParmVals != "" {
			// Extract the content of the <value> tag, which is the JSON string
			var dynamicParmValsXML DynamicParmValsXML
			if err := xml.Unmarshal([]byte(nrfDynamicParmVals), &dynamicParmValsXML); err == nil {
				// The JSON is HTML-encoded, so we need to decode it
				value := strings.ReplaceAll(dynamicParmValsXML.Value, "&quot;", "\"")
				value = strings.ReplaceAll(value, "&lt;", "<")
				value = strings.ReplaceAll(value, "&gt;", ">")
				// We need to unmarshal to check if it's an array or object
				var jsonValue interface{}
				if err := json.Unmarshal([]byte(value), &jsonValue); err == nil {
					// We can re-marshal it to be sure it's valid JSON
					jsonBytes, err := json.Marshal(jsonValue)
					if err == nil {
						nrfdynamicparmvalsValueJSON = string(jsonBytes)
					}
				}
			}
		}

		_, err := stmt.Exec(entry.DN, nrfRole, nrfResource, nrfDynamicParmVals, nrfdynamicparmvalsValueJSON, nrfStatus, createTimestamp, modifyTimestamp, timestampStr, timestampStr, false)
		if err != nil {
			log.Printf("Fehler beim Einfügen der Assoziation %s: %v", entry.DN, err)
			tx.Rollback()
			return
		}
	}
	tx.Commit()
	log.Println("Assoziationssynchronisation abgeschlossen.")
}

// parseLocalizedAttributes parst mehrsprachige Attribute.
func parseLocalizedAttributes(localizedString string) map[string]string {
	result := make(map[string]string)
	if localizedString == "" {
		return result
	}
	parts := strings.Split(localizedString, "|")
	for _, part := range parts {
		if strings.Contains(part, "~") {
			split := strings.SplitN(part, "~", 2)
			result[split[0]] = split[1]
		}
	}
	return result
}
