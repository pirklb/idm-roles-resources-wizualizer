import React, { useState, useEffect } from 'react';
import { Search, ChevronLeft, Layers, User, Loader2, ChevronFirst, ChevronRight, ChevronLast } from 'lucide-react';

// ============================================================================================
// TYPEN UND SCHNITTSTELLEN
// ============================================================================================
// Definition der Datenstrukturen, die wir vom Backend erwarten
interface Role {
    dn: string;
    nrflocalizednames: string;
    nrflocalizeddescrs: string;
}

interface Resource {
    dn: string;
    nrflocalizednames: string;
    nrflocalizeddescrs: string;
}

interface RoleDetailsResponse {
    role: Role;
    hierarchy: Role[];
    resources: any[]; // Wir verwenden hier "any", bis die genaue Struktur bekannt ist
}

interface ResourceDetailsResponse {
    resource_dn: string;
    roles: any[]; // Wir verwenden hier "any", bis die genaue Struktur bekannt ist
}

interface Metadata {
    total_count: number;
    from: number;
    size: number;
    more: boolean;
}

// Generische API-Antwortstruktur für Endpunkte mit Pagination
interface ApiResponse<T> {
    data: T;
    metadata: Metadata;
}

// ============================================================================================
// HOOKS UND HILFSFUNKTIONEN
// ============================================================================================

/**
 * Hook zur Verwaltung des aktuellen App-Zustands.
 * @returns {object} Der aktuelle Zustand und die Funktionen zur Zustandsänderung.
 */
const useAppState = () => {
    const [currentView, setCurrentView] = useState<'search' | 'role' | 'resource'>('search');
    const [selectedRole, setSelectedRole] = useState<Role | null>(null);
    const [selectedResource, setSelectedResource] = useState<Resource | null>(null);

    const navigateToSearch = () => {
        setCurrentView('search');
        setSelectedRole(null);
        setSelectedResource(null);
    };

    const navigateToRoleDetails = (role: Role) => {
        setSelectedRole(role);
        setCurrentView('role');
    };

    const navigateToResourceDetails = (resource: Resource) => {
        setSelectedResource(resource);
        setCurrentView('resource');
    };

    return {
        currentView,
        selectedRole,
        selectedResource,
        navigateToSearch,
        navigateToRoleDetails,
        navigateToResourceDetails,
    };
};

/**
 * Funktion zur URL-Kodierung von DNs.
 * Wichtig, um Sonderzeichen sicher in URLs zu verwenden.
 * @param dn Der Distinguished Name-String.
 * @returns {string} Der URL-kodierte String.
 */
const encodeDn = (dn: string): string => {
    return encodeURIComponent(dn);
};

/**
 * Hilfsfunktion zum Abrufen eines lokalisierten Textes aus einem JSON-String.
 * Versucht, den Wert in der bevorzugten Sprache zu finden, andernfalls fällt es auf
 * eine Fallback-Sprache zurück.
 * @param jsonString Der JSON-String, z.B. '{"de":"Wert", "en":"Value"}'
 * @param preferredLangs Ein Array von Sprachen (ISO-Codes) in absteigender Priorität.
 * @param fallback Der Standardwert, wenn keine passende Sprache gefunden wird.
 * @returns {string} Der gefundene Wert oder der Fallback-Wert.
 */
const getLocalizedText = (jsonString: string, preferredLangs: string[], fallback: string = ''): string => {
    try {
        const localizedMap = JSON.parse(jsonString);
        for (const lang of preferredLangs) {
            if (localizedMap[lang]) {
                return localizedMap[lang];
            }
        }
    } catch (e) {
        console.error("Fehler beim Parsen des JSON-Strings für Lokalisierung:", e);
    }
    return fallback;
};


// ============================================================================================
// WIEDERVERWENDBARE KOMPONENTEN
// ============================================================================================

/**
 * @param {object} props - Komponenteneigenschaften
 * @param {string} props.title - Titel des Headers
 * @param {() => void} props.onBack - Callback für den Zurück-Button
 */
const PageHeader = ({ title, onBack }: { title: string; onBack: () => void }) => (
    <div className="flex items-center p-4 bg-gray-100 dark:bg-gray-800 rounded-t-xl shadow-md">
        <button onClick={onBack} className="p-2 mr-4 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
            <ChevronLeft size={24} />
        </button>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h1>
    </div>
);

// ============================================================================================
// SEITEN-KOMPONENTEN
// ============================================================================================

/**
 * Komponente für die Start- und Suchansicht.
 * @param {object} props - Komponenteneigenschaften
 * @param {(role: Role) => void} props.onRoleSelect - Callback bei Auswahl einer Rolle
 * @param {(resource: Resource) => void} props.onResourceSelect - Callback bei Auswahl einer Ressource
 */
const SearchPage = ({ onRoleSelect, onResourceSelect }: { onRoleSelect: (role: Role) => void; onResourceSelect: (resource: Resource) => void }) => {
    const [roleSearch, setRoleSearch] = useState('');
    const [resourceSearch, setResourceSearch] = useState('');
    const [roles, setRoles] = useState<Role[]>([]);
    const [resources, setResources] = useState<Resource[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [roleMetadata, setRoleMetadata] = useState<Metadata | null>(null);
    const [resourceMetadata, setResourceMetadata] = useState<Metadata | null>(null);
    const [rolePage, setRolePage] = useState(1);
    const [resourcePage, setResourcePage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // useEffect für Rollen-Suche (mit Paginierung)
    useEffect(() => {
        const fetchRoles = async () => {
            if (roleSearch.length < 2) {
                setRoles([]);
                setRoleMetadata(null);
                return;
            }
            setIsLoading(true);
            setError(null);
            try {
                const fromRecord = (rolePage - 1) * itemsPerPage + 1; // Korrekte Startnummer berechnen
                const response = await fetch(`http://localhost:3000/api/roles?search=${encodeURIComponent(roleSearch)}&from=${fromRecord}&size=${itemsPerPage}`);
                if (!response.ok) throw new Error('Fehler beim Abrufen der Rollen');
                const data: ApiResponse<Role[]> = await response.json();
                setRoles(data.data);
                setRoleMetadata(data.metadata);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        const timeoutId = setTimeout(() => fetchRoles(), 500);
        return () => clearTimeout(timeoutId);
    }, [roleSearch, rolePage, itemsPerPage]);

    // useEffect für Ressourcen-Suche (mit Paginierung)
    useEffect(() => {
        const fetchResources = async () => {
            if (resourceSearch.length < 2) {
                setResources([]);
                setResourceMetadata(null);
                return;
            }
            setIsLoading(true);
            setError(null);
            try {
                const fromRecord = (resourcePage - 1) * itemsPerPage + 1; // Korrekte Startnummer berechnen
                const response = await fetch(`http://localhost:3000/api/resources?search=${encodeURIComponent(resourceSearch)}&from=${fromRecord}&size=${itemsPerPage}`);
                if (!response.ok) throw new Error('Fehler beim Abrufen der Ressourcen');
                const data: ApiResponse<Resource[]> = await response.json();
                setResources(data.data);
                setResourceMetadata(data.metadata);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        const timeoutId = setTimeout(() => fetchResources(), 500);
        return () => clearTimeout(timeoutId);
    }, [resourceSearch, resourcePage, itemsPerPage]);

    // Funktion zum Zurücksetzen der Seitenzahl bei einer neuen Suche
    const handleRoleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRoleSearch(e.target.value);
        setRolePage(1);
    };

    const handleResourceSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setResourceSearch(e.target.value);
        setResourcePage(1);
    };

    const handleItemsPerPageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setItemsPerPage(Number(e.target.value));
        setRolePage(1);
        setResourcePage(1);
    };

    const roleLastPage = roleMetadata ? Math.ceil(roleMetadata.total_count / itemsPerPage) : 1;
    const resourceLastPage = resourceMetadata ? Math.ceil(resourceMetadata.total_count / itemsPerPage) : 1;

    return (
        <div className="p-8 space-y-8 bg-gray-50 dark:bg-gray-900 rounded-xl shadow-lg h-full overflow-y-auto">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">LDAP Visualisierung</h1>
                <p className="text-gray-600 dark:text-gray-400">Suchen Sie nach einer Rolle oder einer Ressource, um die Beziehungen zu erkunden.</p>
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                    <User size={20} className="mr-2 text-blue-500" />
                    Rollen
                </h2>
                <div className="relative">
                    <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Nach Rolle suchen..."
                        value={roleSearch}
                        onChange={handleRoleSearchChange}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                {roleSearch.length >= 2 && (
                    <ul className="mt-4 space-y-2">
                        {isLoading && <li className="text-center text-gray-500 dark:text-gray-400 p-4 flex items-center justify-center"><Loader2 className="animate-spin mr-2" /> Suche...</li>}
                        {error && <li className="text-center text-red-500 p-4">Fehler: {error}</li>}
                        {!isLoading && roles.length > 0 && roles.map((role) => (
                            <li key={role.dn} className="cursor-pointer p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors" onClick={() => onRoleSelect(role)}>
                                <p className="font-medium text-gray-800 dark:text-white">{getLocalizedText(role.nrflocalizednames, ['en', 'de'], 'Kein Name')}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{role.dn}</p>
                            </li>
                        ))}
                        {!isLoading && roles.length === 0 && <li className="text-center text-gray-500 dark:text-gray-400 p-4">Keine Rollen gefunden.</li>}
                    </ul>
                )}
                {roleSearch.length >= 2 && roleMetadata && (
                    <div className="mt-4 flex justify-between items-center text-sm text-gray-600 dark:text-gray-400">
                        <span className="flex-grow">{`Ergebnisse: ${roleMetadata.from}-${roleMetadata.from + roles.length - 1} von ${roleMetadata.total_count}`}</span>
                        <div className="flex items-center space-x-2">
                            <label htmlFor="role-per-page" className="mr-2">Ergebnisse pro Seite:</label>
                            <select id="role-per-page" onChange={handleItemsPerPageChange} value={itemsPerPage} className="p-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                                <option value="10">10</option>
                                <option value="20">20</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                                <option value="200">200</option>
                                <option value="500">500</option>
                            </select>
                            <button title="Erste Seite" onClick={() => setRolePage(1)} disabled={rolePage === 1} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                <ChevronFirst size={16} />
                            </button>
                            <button title="Vorherige Seite" onClick={() => setRolePage(p => p - 1)} disabled={rolePage === 1} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                <ChevronLeft size={16} />
                            </button>
                            <button title="Nächste Seite" onClick={() => setRolePage(p => p + 1)} disabled={!roleMetadata.more} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                <ChevronRight size={16} />
                            </button>
                            <button title="Letzte Seite" onClick={() => setRolePage(roleLastPage)} disabled={rolePage === roleLastPage} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                <ChevronLast size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                    <Layers size={20} className="mr-2 text-green-500" />
                    Ressourcen
                </h2>
                <div className="relative">
                    <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Nach Ressource suchen..."
                        value={resourceSearch}
                        onChange={handleResourceSearchChange}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                </div>
                {resourceSearch.length >= 2 && (
                    <ul className="mt-4 space-y-2">
                        {isLoading && <li className="text-center text-gray-500 dark:text-gray-400 p-4 flex items-center justify-center"><Loader2 className="animate-spin mr-2" /> Suche...</li>}
                        {error && <li className="text-center text-red-500 p-4">Fehler: {error}</li>}
                        {!isLoading && resources.length > 0 && resources.map((resource) => (
                            <li key={resource.dn} className="cursor-pointer p-3 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-green-100 dark:hover:bg-green-800 transition-colors" onClick={() => onResourceSelect(resource)}>
                                <p className="font-medium text-gray-800 dark:text-white">{getLocalizedText(resource.nrflocalizednames, ['en', 'de'], 'Kein Name')}</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{resource.dn}</p>
                            </li>
                        ))}
                        {!isLoading && resources.length === 0 && <li className="text-center text-gray-500 dark:text-gray-400 p-4">Keine Ressourcen gefunden.</li>}
                    </ul>
                )}
                {resourceSearch.length >= 2 && resourceMetadata && (
                    <div className="mt-4 flex justify-between items-center text-sm text-gray-600 dark:text-gray-400">
                        <span className="flex-grow">{`Ergebnisse: ${resourceMetadata.from}-${resourceMetadata.from + resources.length - 1} von ${resourceMetadata.total_count}`}</span>
                        <div className="flex items-center space-x-2">
                            <label htmlFor="resource-per-page" className="mr-2">Ergebnisse pro Seite:</label>
                            <select id="resource-per-page" onChange={handleItemsPerPageChange} value={itemsPerPage} className="p-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                                <option value="10">10</option>
                                <option value="20">20</option>
                                <option value="50">50</option>
                                <option value="100">100</option>
                                <option value="200">200</option>
                                <option value="500">500</option>
                            </select>
                            <button title="Erste Seite" onClick={() => setResourcePage(1)} disabled={resourcePage === 1} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                <ChevronFirst size={16} />
                            </button>
                            <button title="Vorherige Seite" onClick={() => setResourcePage(p => p - 1)} disabled={resourcePage === 1} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                <ChevronLeft size={16} />
                            </button>
                            <button title="Nächste Seite" onClick={() => setResourcePage(p => p + 1)} disabled={!resourceMetadata.more} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                <ChevronRight size={16} />
                            </button>
                            <button title="Letzte Seite" onClick={() => setResourcePage(resourceLastPage)} disabled={resourcePage === resourceLastPage} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                <ChevronLast size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Komponente für die detaillierte Rollenansicht.
 * @param {object} props - Komponenteneigenschaften
 * @param {Role} props.role - Die ausgewählte Rolle
 * @param {() => void} props.onBack - Callback für den Zurück-Button
 */
const RoleDetailsPage = ({ role, onBack }: { role: Role; onBack: () => void }) => {
    const [details, setDetails] = useState<RoleDetailsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchDetails = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const encodedDn = encodeDn(role.dn);
                const response = await fetch(`http://localhost:3000/api/roles/${encodedDn}`);
                if (!response.ok) throw new Error('Fehler beim Abrufen der Rollendetails');
                const data: ApiResponse<RoleDetailsResponse> = await response.json();
                setDetails(data.data);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        fetchDetails();
    }, [role.dn]);

    return (
        <div className="p-4 bg-white dark:bg-gray-900 rounded-b-xl shadow-lg h-full overflow-y-auto">
            <PageHeader title={getLocalizedText(role.nrflocalizednames, ['en', 'de'], 'Kein Name')} onBack={onBack} />
            {isLoading ? (
                <div className="flex justify-center items-center h-full text-gray-500 dark:text-gray-400">
                    <Loader2 className="animate-spin mr-2" /> Details werden geladen...
                </div>
            ) : error ? (
                <div className="p-6 text-red-500">Fehler: {error}</div>
            ) : details ? (
                <div className="p-6">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{getLocalizedText(details.role.nrflocalizednames, ['en', 'de'], 'Kein Name')}</h2>
                    <p className="text-sm font-mono text-gray-500 dark:text-gray-400 break-all mb-4">{details.role.dn}</p>

                    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg shadow-inner">
                        <h3 className="font-semibold text-gray-800 dark:text-white mb-2">Details</h3>
                        <p className="text-gray-700 dark:text-gray-300">
                            <strong className="text-gray-900 dark:text-white">Beschreibung:</strong> {getLocalizedText(details.role.nrflocalizeddescrs, ['en', 'de'])}
                        </p>
                    </div>

                    <div className="mt-8">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Hierarchie & Ressourcen</h3>
                        {/* Hier würde die rekursive Abfrage zur Darstellung der Parent- und Child-Rollen sowie der zugehörigen Ressourcen angezeigt werden */}
                        <pre className="p-4 bg-gray-200 dark:bg-gray-700 rounded-lg text-gray-800 dark:text-gray-200 overflow-x-auto text-sm">
                            {JSON.stringify(details, null, 2)}
                        </pre>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

/**
 * Komponente für die detaillierte Ressourcenansicht.
 * @param {object} props - Komponenteneigenschaften
 * @param {Resource} props.resource - Die ausgewählte Ressource
 * @param {() => void} props.onBack - Callback für den Zurück-Button
 */
const ResourceDetailsPage = ({ resource, onBack }: { resource: Resource; onBack: () => void }) => {
    const [details, setDetails] = useState<ResourceDetailsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchDetails = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const encodedDn = encodeDn(resource.dn);
                const response = await fetch(`http://localhost:3000/api/resources/${encodedDn}/roles`);
                if (!response.ok) throw new Error('Fehler beim Abrufen der Ressourcendetails');
                const data: ApiResponse<ResourceDetailsResponse> = await response.json();
                setDetails(data.data);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        fetchDetails();
    }, [resource.dn]);

    return (
        <div className="p-4 bg-white dark:bg-gray-900 rounded-b-xl shadow-lg h-full overflow-y-auto">
            <PageHeader title={getLocalizedText(resource.nrflocalizednames, ['en', 'de'], 'Kein Name')} onBack={onBack} />
            {isLoading ? (
                <div className="flex justify-center items-center h-full text-gray-500 dark:text-gray-400">
                    <Loader2 className="animate-spin mr-2" /> Details werden geladen...
                </div>
            ) : error ? (
                <div className="p-6 text-red-500">Fehler: {error}</div>
            ) : details ? (
                <div className="p-6">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{getLocalizedText(resource.nrflocalizednames, ['en', 'de'], 'Kein Name')}</h2>
                    <p className="text-sm font-mono text-gray-500 dark:text-gray-400 break-all mb-4">{resource.dn}</p>

                    <div className="mt-8">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Zugehörige Rollen</h3>
                        {/* Hier würde die Liste der Rollen, die diese Ressource zuweisen, inklusive ihrer Parent-Hierarchie, angezeigt werden. */}
                        <pre className="p-4 bg-gray-200 dark:bg-gray-700 rounded-lg text-gray-800 dark:text-gray-200 overflow-x-auto text-sm">
                            {JSON.stringify(details, null, 2)}
                        </pre>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

// ============================================================================================
// HAUPT-ANWENDUNGSKOMPONENTE
// ============================================================================================

/**
 * Die Hauptkomponente der Anwendung. Sie verwaltet die Navigation
 * und rendert die entsprechende Seite basierend auf dem aktuellen Zustand.
 */
const App = () => {
    const {
        currentView,
        selectedRole,
        selectedResource,
        navigateToSearch,
        navigateToRoleDetails,
        navigateToResourceDetails
    } = useAppState();

    const renderContent = () => {
        switch (currentView) {
            case 'search':
                return <SearchPage onRoleSelect={navigateToRoleDetails} onResourceSelect={navigateToResourceDetails} />;
            case 'role':
                if (selectedRole) return <RoleDetailsPage role={selectedRole} onBack={navigateToSearch} />;
                return <SearchPage onRoleSelect={navigateToRoleDetails} onResourceSelect={navigateToResourceDetails} />;
            case 'resource':
                if (selectedResource) return <ResourceDetailsPage resource={selectedResource} onBack={navigateToSearch} />;
                return <SearchPage onRoleSelect={navigateToRoleDetails} onResourceSelect={navigateToResourceDetails} />;
            default:
                return <SearchPage onRoleSelect={navigateToRoleDetails} onResourceSelect={navigateToResourceDetails} />;
        }
    };

    return (
        <div className="w-full min-h-screen bg-gray-100 dark:bg-gray-900 flex justify-center items-center p-4 sm:p-8 font-sans">
            <div className="w-full max-w-4xl h-[90vh] bg-white dark:bg-gray-900 rounded-xl shadow-2xl flex flex-col">
                {renderContent()}
            </div>
        </div>
    );
};

export default App;
