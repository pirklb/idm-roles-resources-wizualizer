// Version: 1.0.33
import React, { useState, useEffect } from 'react';
import { LuChevronFirst, LuChevronLeft, LuChevronRight, LuChevronLast } from 'react-icons/lu';

interface LocalizedString {
    [key: string]: string;
}

interface Role {
    dn: string;
    nrfrolelevel: string;
    nrflocalizednames: LocalizedString;
    nrflocalizeddescrs: LocalizedString;
    sortname: string;
    sortdesc: string;
    depth: number;
    resources?: Resource[];
}

interface Resource {
    dn: string;
    nrflocalizednames: LocalizedString;
    nrflocalizeddescrs: LocalizedString;
    sortname: string;
    sortdesc: string;
}

interface PaginationMetadata {
    total_count: number;
    from: number;
    size: number;
    more: boolean;
}

interface SearchResponse<T> {
    data: T[];
    metadata: PaginationMetadata;
}

const getLocalizedText = (
    localized: any,
    defaultValue: string = '',
    preferredLanguages: string[] = ['en', 'de']
): string => {
    let localizedObject: LocalizedString | null = null;

    if (typeof localized === 'string') {
        try {
            localizedObject = JSON.parse(localized);
        } catch (e) {
            return defaultValue;
        }
    } else if (localized) {
        localizedObject = localized;
    }

    if (localizedObject) {
        for (const lang of preferredLanguages) {
            if (localizedObject[lang]) {
                return localizedObject[lang];
            }
        }
        const rawValue = Object.values(localizedObject).find(val => val !== null);
        return rawValue !== undefined ? rawValue.toString() : defaultValue;
    }
    return defaultValue;
};

// Haupt-App-Komponente
const App = () => {
    const [currentPage, setCurrentPage] = useState('search');
    const [selectedRoleDn, setSelectedRoleDn] = useState<string | null>(null);
    const [selectedResourceDn, setSelectedResourceDn] = useState<string | null>(null);

    const navigate = (page: string, dn: string | null = null) => {
        setCurrentPage(page);
        if (dn) {
            if (page === 'roleDetails') {
                setSelectedRoleDn(dn);
            } else if (page === 'resourceDetails') {
                setSelectedResourceDn(dn);
            }
        }
    };

    const renderPage = () => {
        switch (currentPage) {
            case 'search':
                return <SearchPage navigate={navigate} />;
            case 'roleDetails':
                return selectedRoleDn && <RoleDetailsPage dn={selectedRoleDn} navigate={navigate} />;
            case 'resourceDetails':
                return selectedResourceDn && <ResourceDetailsPage dn={selectedResourceDn} navigate={navigate} />;
            default:
                return <SearchPage navigate={navigate} />;
        }
    };

    const isDev = import.meta.env.VITE_STAGE === 'development';

    return (
        <div className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
            <div className="w-full max-w-4xl bg-white rounded-lg shadow-lg p-6 relative">
                {isDev && (
                    <div className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-bl-lg rounded-tr-lg">
                        DEV
                    </div>
                )}
                <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">
                    IDM Wizualizer
                </h1>
                {currentPage !== 'search' && (
                    <button
                        onClick={() => navigate('search')}
                        className="mb-4 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors duration-200"
                    >
                        ← Zurück zur Suche
                    </button>
                )}
                {renderPage()}
            </div>
        </div>
    );
};

// Suchseite mit Paginierung
const SearchPage = ({ navigate }: { navigate: (page: string, dn: string) => void }) => {
    const [roleSearchTerm, setRoleSearchTerm] = useState('');
    const [resourceSearchTerm, setResourceSearchTerm] = useState('');
    const [roles, setRoles] = useState<Role[]>([]);
    const [resources, setResources] = useState<Resource[]>([]);
    const [roleMetadata, setRoleMetadata] = useState<PaginationMetadata | null>(null);
    const [resourceMetadata, setResourceMetadata] = useState<PaginationMetadata | null>(null);
    const [roleFrom, setRoleFrom] = useState(1);
    const [resourceFrom, setResourceFrom] = useState(1);
    const [roleSize, setRoleSize] = useState(10);
    const [resourceSize, setResourceSize] = useState(10);
    const [isRoleLoading, setIsRoleLoading] = useState(false);
    const [isResourceLoading, setIsResourceLoading] = useState(false);
    const [roleError, setRoleError] = useState<string | null>(null);
    const [resourceError, setResourceError] = useState<string | null>(null);

    // Kapselung des Fetch-Aufrufs in einer Hilfsfunktion
    const fetchData = async (url: string) => {
        // Die Variable `VITE_STAGE` wird nur von Vite verarbeitet.
        // In der Build-Phase ist sie nicht verfügbar.
        const isDev = import.meta.env.VITE_STAGE === 'development';
        const baseURL = isDev ? 'http://localhost:3000' : '';
        const fullURL = `${baseURL}${url}`;

        const response = await fetch(fullURL);
        if (!response.ok) {
            throw new Error(`Fehler beim Abrufen von ${url}`);
        }
        return response.json();
    };

    useEffect(() => {
        const fetchRoles = async () => {
            if (roleSearchTerm.length < 2) return;
            setIsRoleLoading(true);
            setRoleError(null);
            try {
                const data: SearchResponse<Role> = await fetchData(`/api/roles?search=${roleSearchTerm}&from=${roleFrom}&size=${roleSize}`);
                setRoles(data.data);
                setRoleMetadata(data.metadata);
            } catch (err: any) {
                setRoleError(err.message);
            } finally {
                setIsRoleLoading(false);
            }
        };
        fetchRoles();
    }, [roleSearchTerm, roleFrom, roleSize]);

    useEffect(() => {
        const fetchResources = async () => {
            if (resourceSearchTerm.length < 2) return;
            setIsResourceLoading(true);
            setResourceError(null);
            try {
                const data: SearchResponse<Resource> = await fetchData(`/api/resources?search=${resourceSearchTerm}&from=${resourceFrom}&size=${resourceSize}`);
                setResources(data.data);
                setResourceMetadata(data.metadata);
            } catch (err: any) {
                setResourceError(err.message);
            } finally {
                setIsResourceLoading(false);
            }
        };
        fetchResources();
    }, [resourceSearchTerm, resourceFrom, resourceSize]);

    const renderPagination = (metadata: PaginationMetadata | null, pageFrom: number, setPageFrom: (from: number) => void, size: number) => {
        if (!metadata || metadata.total_count === 0) return null;
        const totalPages = Math.ceil(metadata.total_count / size);
        const currentPageNumber = Math.floor((pageFrom - 1) / size) + 1;

        return (
            <div className="flex justify-between items-center mt-4">
                <span className="text-sm text-gray-700">
                    Ergebnisse: {metadata.from} - {metadata.from + metadata.size - 1} von {metadata.total_count}
                </span>
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setPageFrom(1)}
                        disabled={currentPageNumber === 1}
                        className="p-2 rounded-md bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 transition-colors duration-200"
                        title="Erste Seite"
                    >
                        <LuChevronFirst />
                    </button>
                    <button
                        onClick={() => setPageFrom(Math.max(1, pageFrom - size))}
                        disabled={currentPageNumber === 1}
                        className="p-2 rounded-md bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 transition-colors duration-200"
                        title="Vorherige Seite"
                    >
                        <LuChevronLeft />
                    </button>
                    <button
                        onClick={() => setPageFrom(pageFrom + size)}
                        disabled={!metadata.more}
                        className="p-2 rounded-md bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 transition-colors duration-200"
                        title="Nächste Seite"
                    >
                        <LuChevronRight />
                    </button>
                    <button
                        onClick={() => setPageFrom((totalPages - 1) * size + 1)}
                        disabled={currentPageNumber === totalPages}
                        className="p-2 rounded-md bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 transition-colors duration-200"
                        title="Letzte Seite"
                    >
                        <LuChevronLast />
                    </button>
                </div>
                <select
                    onChange={(e) => {
                        const newSize = parseInt(e.target.value, 10);
                        setRoleSize(newSize);
                        setResourceSize(newSize);
                        setPageFrom(1);
                    }}
                    value={size}
                    className="p-2 rounded-md bg-gray-200 text-gray-700"
                >
                    {[10, 20, 50, 100, 200, 500].map(val => (
                        <option key={val} value={val}>{val}</option>
                    ))}
                </select>
            </div>
        );
    };

    return (
        <div className="flex flex-col space-y-8">
            <div>
                <h2 className="text-2xl font-bold text-gray-700 mb-4">Rollen-Suche</h2>
                <input
                    type="text"
                    placeholder="Rollen suchen (mind. 2 Zeichen)..."
                    value={roleSearchTerm}
                    onChange={(e) => setRoleSearchTerm(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {isRoleLoading && <p className="text-center text-gray-500 mt-4">Lädt...</p>}
                {roleError && <p className="text-center text-red-500 mt-4">Fehler: {roleError}</p>}
                {roleSearchTerm.length >= 2 && roles.length > 0 && (
                    <div className="mt-4">
                        <ul className="bg-white rounded-md shadow-sm border border-gray-200">
                            {roles.map(role => (
                                <li
                                    key={role.dn}
                                    onClick={() => navigate('roleDetails', role.dn)}
                                    className="p-4 border-b border-gray-200 last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                                >
                                    <p className="font-medium text-gray-800">{getLocalizedText(role.nrflocalizednames)}</p>
                                    <p className="text-sm text-gray-500 truncate">{getLocalizedText(role.nrflocalizeddescrs)}</p>
                                </li>
                            ))}
                        </ul>
                        {renderPagination(roleMetadata, roleFrom, setRoleFrom, roleSize)}
                    </div>
                )}
            </div>

            <div>
                <h2 className="text-2xl font-bold text-gray-700 mb-4">Ressourcen-Suche</h2>
                <input
                    type="text"
                    placeholder="Ressourcen suchen (mind. 2 Zeichen)..."
                    value={resourceSearchTerm}
                    onChange={(e) => setResourceSearchTerm(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {isResourceLoading && <p className="text-center text-gray-500 mt-4">Lädt...</p>}
                {resourceError && <p className="text-center text-red-500 mt-4">Fehler: {resourceError}</p>}
                {resourceSearchTerm.length >= 2 && resources.length > 0 && (
                    <div className="mt-4">
                        <ul className="bg-white rounded-md shadow-sm border border-gray-200">
                            {resources.map(resource => (
                                <li
                                    key={resource.dn}
                                    onClick={() => navigate('resourceDetails', resource.dn)}
                                    className="p-4 border-b border-gray-200 last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors duration-200"
                                >
                                    <p className="font-medium text-gray-800">{getLocalizedText(resource.nrflocalizednames)}</p>
                                    <p className="text-sm text-gray-500 truncate">{getLocalizedText(resource.nrflocalizeddescrs)}</p>
                                </li>
                            ))}
                        </ul>
                        {renderPagination(resourceMetadata, resourceFrom, setResourceFrom, resourceSize)}
                    </div>
                )}
            </div>
        </div>
    );
};

// Rollen-Detailansicht
const RoleDetailsPage = ({ dn, navigate }: { dn: string; navigate: (page: string, dn: string) => void }) => {
    const [role, setRole] = useState<any>(null);
    const [hierarchy, setHierarchy] = useState<{ parents: Role[], children: Role[] } | null>(null);
    const [directResources, setDirectResources] = useState<Resource[] | null>(null);
    const [activeTab, setActiveTab] = useState<'roles' | 'resources'>('roles');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchRoleDetails = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const roleResponse = await fetch(`http://localhost:3000/api/roles/${encodeURIComponent(dn)}`);
                if (!roleResponse.ok) throw new Error('Rolle nicht gefunden');
                const roleData = await roleResponse.json();
                setRole(roleData);

                const hierarchyResponse = await fetch(`http://localhost:3000/api/roles/${encodeURIComponent(dn)}/full-hierarchy`);
                if (!hierarchyResponse.ok) throw new Error('Fehler beim Abrufen der Hierarchie');
                const hierarchyData = await hierarchyResponse.json();
                setHierarchy(hierarchyData.data);
                console.log('Abgerufene Hierarchiedaten:', hierarchyData.data);

                const resourcesResponse = await fetch(`http://localhost:3000/api/roles/${encodeURIComponent(dn)}/resources`);
                if (!resourcesResponse.ok) throw new Error('Fehler beim Abrufen der Ressourcen');
                const resourcesData = await resourcesResponse.json();
                setDirectResources(resourcesData.data);

            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        fetchRoleDetails();
    }, [dn]);

    if (isLoading) {
        return <p className="text-center text-gray-500">Lädt Rollen-Details...</p>;
    }

    if (error) {
        return <p className="text-center text-red-500">Fehler: {error}</p>;
    }

    if (!role) {
        return <p className="text-center text-gray-500">Rolle nicht gefunden.</p>;
    }

    const renderTooltip = (text: string) => (
        <div className="absolute z-10 w-64 p-2 mt-2 text-sm text-white bg-gray-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            {text}
        </div>
    );

    const renderRoleItem = (roleItem: Role) => {
        const mlClass = `ml-${roleItem.depth * 4}`;
        return (
            <li key={roleItem.dn} className={`relative group ${mlClass}`}>
                <div className="cursor-pointer text-blue-600 hover:underline" onClick={() => navigate('roleDetails', roleItem.dn)}>
                    {getLocalizedText(roleItem.nrflocalizednames)}
                </div>
                {renderTooltip(getLocalizedText(roleItem.nrflocalizeddescrs, 'Keine Beschreibung'))}
                {roleItem.resources && roleItem.resources.length > 0 && (
                    <ul className={`space-y-1 ml-4`}>
                        {roleItem.resources.map((resource: Resource) => (
                            <li key={resource.dn} className="italic text-gray-600">
                                {getLocalizedText(resource.nrflocalizednames)}
                            </li>
                        ))}
                    </ul>
                )}
            </li>
        );
    };

    const renderResourceItem = (resourceItem: Resource) => {
        return (
            <li key={resourceItem.dn} className="italic text-gray-600 relative group ml-4">
                {getLocalizedText(resourceItem.nrflocalizednames)}
                {renderTooltip(getLocalizedText(resourceItem.nrflocalizeddescrs, 'Keine Beschreibung'))}
            </li>
        );
    };


    return (
        <div className="p-6">
            <h2 className="text-2xl font-bold text-gray-700 mb-2">{getLocalizedText(role.nrflocalizednames)}</h2>
            <p className="text-sm text-gray-500 mb-4">{getLocalizedText(role.nrflocalizeddescrs, role.dn)}</p>

            <div className="mb-4 border-b border-gray-200">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('roles')}
                        className={`${activeTab === 'roles'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
                    >
                        Rollen
                    </button>
                    <button
                        onClick={() => setActiveTab('resources')}
                        className={`${activeTab === 'resources'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
                    >
                        Ressourcen
                    </button>
                </nav>
            </div>

            {activeTab === 'roles' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <h3 className="text-xl font-semibold text-gray-700 mb-2">Parent-Rollen</h3>
                        {hierarchy && hierarchy.parents && hierarchy.parents.length > 0 ? (
                            <ul className="space-y-2">
                                {hierarchy.parents.map((parentRole: Role) => renderRoleItem(parentRole))}
                            </ul>
                        ) : (
                            <p className="text-gray-500">Keine Parent-Rollen gefunden.</p>
                        )}
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold text-gray-700 mb-2">Child-Rollen</h3>
                        {hierarchy && hierarchy.children && hierarchy.children.length > 0 ? (
                            <ul className="space-y-2">
                                {hierarchy.children.map((childRole: Role) => renderRoleItem(childRole))}
                            </ul>
                        ) : (
                            <p className="text-gray-500">Keine Child-Rollen gefunden.</p>
                        )}
                    </div>
                </div>
            ) : (
                <div>
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">Direkt zugewiesene Ressourcen</h3>
                    {directResources && directResources.length > 0 ? (
                        <ul className="space-y-2">
                            {directResources.map(renderResourceItem)}
                        </ul>
                    ) : (
                        <p className="text-gray-500">Keine Ressourcen gefunden.</p>
                    )}
                </div>
            )}
        </div>
    );
};

// Ressourcen-Detailansicht
const ResourceDetailsPage = ({ dn, navigate }: { dn: string; navigate: (page: string, dn: string) => void }) => {
    const [resource, setResource] = useState<any>(null);
    const [roles, setRoles] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Kapselung des Fetch-Aufrufs in einer Hilfsfunktion
    const fetchData = async (url: string) => {
        const stage = import.meta.env.VITE_STAGE;
        const baseURL = stage === 'development' ? 'http://localhost:3000' : '';
        const fullURL = `${baseURL}${url}`;

        const response = await fetch(fullURL);
        if (!response.ok) {
            throw new Error(`Fehler beim Abrufen von ${url}`);
        }
        return response.json();
    };

    useEffect(() => {
        const fetchResourceDetails = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const resourceData = await fetchData(`/api/resources/${encodeURIComponent(dn)}`);
                setResource(resourceData);

                const rolesData = await fetchData(`/api/resources/${encodeURIComponent(dn)}/roles`);
                setRoles(rolesData.data);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };
        fetchResourceDetails();
    }, [dn]);

    if (isLoading) {
        return <p className="text-center text-gray-500">Lädt Ressourcen-Details...</p>;
    }

    if (error) {
        return <p className="text-center text-red-500">Fehler: {error}</p>;
    }

    if (!resource) {
        return <p className="text-center text-gray-500">Ressource nicht gefunden.</p>;
    }

    const renderTooltip = (text: string) => (
        <div className="absolute z-10 w-64 p-2 mt-2 text-sm text-white bg-gray-800 rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            {text}
        </div>
    );

    return (
        <div className="p-6">
            <h2 className="text-2xl font-bold text-gray-700 mb-2">{getLocalizedText(resource.nrflocalizednames)}</h2>
            <p className="text-sm text-gray-500 mb-4">{getLocalizedText(resource.nrflocalizeddescrs, resource.dn)}</p>

            <div>
                <h3 className="text-xl font-semibold text-gray-700 mb-2">Zugeordnete Rollen</h3>
                {roles.length > 0 ? (
                    <ul className="space-y-2">
                        {roles.map(role => (
                            <li key={role.dn} className="relative group">
                                <div className="cursor-pointer text-blue-600 hover:underline" onClick={() => navigate('roleDetails', role.dn)}>
                                    {getLocalizedText(role.nrflocalizednames)}
                                </div>
                                {renderTooltip(getLocalizedText(role.nrflocalizeddescrs, 'Keine Beschreibung'))}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-500">Keine Rollen zugeordnet.</p>
                )}
            </div>
        </div>
    );
};

export default App;
