// src/chatbot/utils/transformData.ts
import logToFile from '../../utils/logger';

// --- Type Definitions for better type safety and readability ---

interface Location {
    address: string;
    cityStateProvince: string;
    country: string;
    continent: string;
}

interface DateEntry {
    fromDate: string | null;
    toDate: string | null;
    type: string;
    name: string;
}

interface Rank {
    year: number;
    rank: string;
    source: string;
    researchField: string;
}

// Represents the actual data for an organization, whether nested or not
interface OrgData {
    year: number | null;
    accessType: string;
    summary: string;
    callForPaper: string;
    link: string;
    pulisher: string; // Matches the typo in the provided JSON
    cfpLink: string;
    locations: Location[];
    topics: string[];
    dates: DateEntry[];
    impLink?: string; // Optional important dates link
}

// Represents an item in the 'organizations' array, which can have a nested 'org' key
type Organization = { org: OrgData } | OrgData;

interface ConferenceDetail {
    id: string;
    title: string;
    acronym: string;
    ranks: Rank[];
    organizations: Organization[];
    // Other top-level fields
    [key: string]: any;
}

interface ConferenceSummary {
    id: string;
    title: string;
    acronym: string;
    location: Location;
    rank: string;
    source: string;
    year: number;
    researchFields: string[];
    topics: string[];
    dates: DateEntry;
    link: string;
    accessType: string;
    // Other top-level fields
    [key: string]: any;
}

interface ConferenceData {
    payload: (ConferenceDetail | ConferenceSummary)[];
    meta: {
        curPage: number;
        perPage: number;
        totalItems: number;
        totalPage: number;
        prevPage: number | null;
        nextPage: number | null;
    };
}

/**
 * Formats a date type string into a human-readable header.
 * @param dateType The type string from the data (e.g., "submissionDate").
 * @returns A formatted string (e.g., "Submission Dates").
 */
const formatDateTypeHeader = (dateType: string): string => {
    switch (dateType) {
        case 'submissionDate':
            return 'Submission Dates';
        case 'notificationDate':
            return 'Notification Dates';
        case 'cameraReadyDate':
            return 'Camera-Ready Dates';
        case 'otherDate':
            return 'Other Important Dates';
        default:
            // Capitalize first letter and add 's'
            return dateType.charAt(0).toUpperCase() + dateType.slice(1) + 's';
    }
};


export interface ConferenceSourceData {
    id: string;
    title: string;
    acronym?: string;
    rank: string;
    source: string;
    conferenceDates?: string;
    location: string;
}



// Helper function để trích xuất và format ngày (tương tự như trong transformData)
// Bạn có thể đặt nó ở một file utils chung nếu dùng ở nhiều nơi
const formatDateRangeForSource = (fromDateStr?: string | null, toDateStr?: string | null): string | undefined => {
    if (!fromDateStr) return undefined;
    try {
        const fromDate = new Date(fromDateStr);
        const toDate = toDateStr ? new Date(toDateStr) : fromDate;
        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return undefined;

        const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
        const yearOption: Intl.DateTimeFormatOptions = { year: 'numeric' };
        const fromFormatted = fromDate.toLocaleDateString('en-US', options);
        const toFormatted = toDate.toLocaleDateString('en-US', options);
        const year = fromDate.toLocaleDateString('en-US', yearOption);

        if (fromDate.toDateString() === toDate.toDateString()) {
            return `${fromFormatted}, ${year}`;
        } else {
            if (fromDate.getFullYear() === toDate.getFullYear() && fromDate.getMonth() === toDate.getMonth()) {
                const fromDay = fromDate.toLocaleDateString('en-US', { day: 'numeric' });
                const toDay = toDate.toLocaleDateString('en-US', { day: 'numeric' });
                const month = fromDate.toLocaleDateString('en-US', { month: 'short' });
                return `${month} ${fromDay}-${toDay}, ${year}`;
            } else {
                return `${fromFormatted} - ${toFormatted}, ${year}`;
            }
        }
    } catch (error) {
        return undefined;
    }
};


/**
 * Extracts and normalizes data for a single conference object from the API payload
 * to be used for frontend source display.
 * This ensures consistent data extraction logic.
 * @param conf The raw conference object from the API payload.
 * @returns A structured object for the source display payload, or null if invalid.
 */
export const extractConferenceSourceData = (conf: any): ConferenceSourceData | null => {
    if (!conf || !conf.id) {
        return null;
    }

    // 1. Sử dụng logic chuẩn hóa từ transformData.ts
    const organizations = conf.organizations || [];
    const latestRawOrg = organizations.length > 0 ? organizations[organizations.length - 1] : undefined;
    const latestOrg = getNormalizedOrg(latestRawOrg) || conf; // Fallback to conf itself

    // 2. Lấy rank (ưu tiên từ `conf.ranks`, sau đó mới đến `latestOrg.ranks`)
    const allRanks = conf.ranks || latestOrg.ranks || [];
    const primaryRank = allRanks.length > 0 ? allRanks[0] : { rank: 'N/A', source: 'N/A' };

    // 3. Lấy location với logic fallback tốt nhất
    const locationData = (latestOrg.locations && latestOrg.locations.length > 0) ? latestOrg.locations[0] : {};
    let formattedLocation = "N/A";
    if (locationData.cityStateProvince && locationData.country) {
        formattedLocation = `${locationData.cityStateProvince}, ${locationData.country}`;
    } else if (locationData.country) {
        formattedLocation = locationData.country;
    } else if (locationData.address) {
        formattedLocation = locationData.address;
    }

    // 4. Lấy conference dates
    const conferenceDateEntry = (latestOrg.dates || []).find((d: any) => d.type === 'conferenceDates');
    const formattedDates = formatDateRangeForSource(conferenceDateEntry?.fromDate, conferenceDateEntry?.toDate);

    return {
        id: conf.id,
        // Ưu tiên title/acronym từ dữ liệu của năm gần nhất, fallback về dữ liệu gốc
        title: latestOrg.title || conf.title || 'Untitled Conference',
        acronym: latestOrg.acronym || conf.acronym,
        rank: primaryRank.rank,
        source: primaryRank.source,
        conferenceDates: formattedDates,
        location: formattedLocation,
    };
};


// --- Helper Functions ---

/**
 * Safely gets a nested property from an object.
 * @param obj The object to traverse.
 * @param path A dot-separated path string or an array of keys.
 * @param defaultValue The value to return if the path doesn't exist.
 * @returns The value at the path or the default value.
 */
const safeGet = (obj: any, path: string | string[], defaultValue: any = undefined): any => {
    if (!obj) return defaultValue;
    const pathArray = Array.isArray(path) ? path : path.split('.');
    let current = obj;
    for (let i = 0; i < pathArray.length; i++) {
        if (current === null || current === undefined || current[pathArray[i]] === undefined) {
            return defaultValue;
        }
        current = current[pathArray[i]];
    }
    return current !== undefined ? current : defaultValue;
};

/**
 * Normalizes an organization object by checking for a nested 'org' key.
 * This handles inconsistencies in the API response structure.
 * @param orgObject The raw object from the organizations array.
 * @returns The actual data object, whether it was nested or not, or undefined if input is invalid.
 */
const getNormalizedOrg = (orgObject: any): OrgData | undefined => {
    if (!orgObject) return undefined;
    // If the object has a key 'org' and its value is an object, return the nested object.
    if (orgObject && typeof orgObject === 'object' && orgObject.hasOwnProperty('org')) {
        return orgObject.org;
    }
    // Otherwise, return the object itself, assuming it has the correct structure.
    return orgObject;
};

/**
 * Formats an ISO date string into a more readable format.
 * Handles date ranges (e.g., "Month Day - Day, Year" or just "Month Day, Year").
 * @param fromDateStr ISO date string for the start date.
 * @param toDateStr ISO date string for the end date.
 * @returns Formatted date string or "N/A".
 */
const formatDateRange = (fromDateStr?: string | null, toDateStr?: string | null): string => {
    if (!fromDateStr) return "N/A";

    try {
        const fromDate = new Date(fromDateStr);
        const toDate = toDateStr ? new Date(toDateStr) : fromDate;

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return "N/A";

        const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
        const yearOption: Intl.DateTimeFormatOptions = { year: 'numeric' };

        const fromFormatted = fromDate.toLocaleDateString('en-US', options);
        const toFormatted = toDate.toLocaleDateString('en-US', options);
        const year = fromDate.toLocaleDateString('en-US', yearOption);

        if (fromDate.toDateString() === toDate.toDateString()) {
            return `${fromFormatted}, ${year}`;
        } else {
            if (fromDate.getFullYear() === toDate.getFullYear() && fromDate.getMonth() === toDate.getMonth()) {
                const fromDay = fromDate.toLocaleDateString('en-US', { day: 'numeric' });
                const toDay = toDate.toLocaleDateString('en-US', { day: 'numeric' });
                const month = fromDate.toLocaleDateString('en-US', { month: 'long' });
                return `${month} ${fromDay} - ${toDay}, ${year}`;
            } else {
                return `${fromFormatted} - ${toFormatted}, ${year}`;
            }
        }
    } catch (error) {
        logToFile(`Error formatting date range (${fromDateStr}, ${toDateStr}): ${error}`);
        return "N/A";
    }
};

/**
 * Compares two values and adds a Markdown-emphasized change indicator if they differ.
 * @param currentValue The current value.
 * @param previousValue The previous value.
 * @param formatter Optional function to format the previous value for display.
 * @returns A Markdown string indicating the change, or an empty string.
 */
const formatChangeMarkdown = (currentValue: any, previousValue: any, formatter?: (val: any) => string): string => {
    if (previousValue === undefined || previousValue === null || currentValue === previousValue) {
        return "";
    }
    const formattedPrev = formatter ? formatter(previousValue) : String(previousValue || "N/A");
    if (currentValue !== undefined && currentValue !== null) {
        return ` **(changed from "${formattedPrev}")**`;
    }
    return "";
};


// --- Main Data Transformation Logic with Markdown ---
// src/chatbot/utils/transformData.ts

// ... (giữ nguyên các type definitions và các hàm helper ở trên:
// Location, DateEntry, Rank, OrgData, Organization, ConferenceDetail,
// ConferenceSummary, ConferenceData, formatDateTypeHeader, ConferenceSourceData,
// formatDateRangeForSource, extractConferenceSourceData, safeGet,
// getNormalizedOrg, formatDateRange, formatChangeMarkdown)

// --- Main Data Transformation Logic with Markdown ---
export function transformConferenceData(parsedData: ConferenceData, searchQuery: string): string {
    logToFile(`Transforming conference data with Markdown. Search query: ${searchQuery}`);

    const payload = safeGet(parsedData, 'payload', []);
    const meta = safeGet(parsedData, 'meta', {});
    const isDetailMode = searchQuery.includes("mode=detail");

    // 1. Format Metadata
    let metaString = "**Meta:**\n";
    metaString += `- **Current page:** ${safeGet(meta, 'curPage', 'N/A')}\n`;
    metaString += `- **Per page:** ${safeGet(meta, 'perPage', 'N/A')}\n`;
    metaString += `- **Total items:** ${safeGet(meta, 'totalItems', 'N/A')}\n`;
    metaString += `- **Total page:** ${safeGet(meta, 'totalPage', 'N/A')}\n`;
    metaString += `- **Prev page:** ${safeGet(meta, 'prevPage', 'null')}\n`;
    metaString += `- **Next page:** ${safeGet(meta, 'nextPage', 'null')}\n`;

    // 2. Format Payload
    let payloadString = "\n**Payload:**\n";
    payloadString += "---\n";

    if (!Array.isArray(payload) || payload.length === 0) {
        payloadString += "*No conferences found matching your criteria.*\n";
    } else {
        payload.forEach((conf: any, index: number) => {
            payloadString += `\n**- Conference ${index + 1}.**\n`;

            if (isDetailMode) {
                // --- Detail Mode Transformation ---
                payloadString += `  - **Title:** ${safeGet(conf, 'title', 'N/A')}\n`;
                payloadString += `  - **Acronym:** ${safeGet(conf, 'acronym', 'N/A')}\n`;

                // Ranks
                const ranks = safeGet(conf, 'ranks', []);
                if (Array.isArray(ranks) && ranks.length > 0) {
                    payloadString += `  - **Ranks:**\n`;
                    ranks.forEach((rank: Rank, rankIndex: number) => {
                        payloadString += `    ${rankIndex + 1}. \n`;
                        payloadString += `       - **Rank:** ${safeGet(rank, 'rank', 'N/A')}\n`;
                        payloadString += `       - **Source:** **${safeGet(rank, 'source', 'N/A')}**\n`;
                        payloadString += `       - **Research field:** ${safeGet(rank, 'researchField', 'N/A')}\n`;
                    });
                } else {
                    payloadString += `  - **Ranks:** N/A\n`;
                }

                // --- ADJUSTED LOGIC FOR ORGANIZATIONS ---
                const organizations = safeGet(conf, 'organizations', []);
                
                 // The latest organization data is at the end of the array.
                const latestRawOrg = organizations.length > 1 ? organizations[organizations.length - 2] : undefined;

                // The previous organization data is the one before the last (for comparison).
                const previousRawOrg = organizations.length > 0 ? organizations[organizations.length - 1] : undefined;

                // Normalize both to handle the 'org' key or lack thereof.
                const latestOrg = getNormalizedOrg(latestRawOrg);
                const previousOrg = getNormalizedOrg(previousRawOrg); // This will be undefined if only one org exists.

                // The main display logic is now based on latestOrg.
                if (!latestOrg) {
                    payloadString += `  - *No detailed organization data available.*\n`;
                } else {
                    // Use latestOrg for current data, and previousOrg for comparison.
                    const currentLocation = safeGet(latestOrg, 'locations.0', {});
                    const previousLocation = safeGet(previousOrg, 'locations.0', undefined);
                    const currentDates = safeGet(latestOrg, 'dates', []);
                    const previousDates = safeGet(previousOrg, 'dates', []);

                    payloadString += `  - **Year:** ${safeGet(latestOrg, 'year', 'N/A')}\n`;

                    const currentAccessType = safeGet(latestOrg, 'accessType', 'N/A');
                    const previousAccessType = safeGet(previousOrg, 'accessType', undefined);
                    payloadString += `  - **Type:** ${currentAccessType}${formatChangeMarkdown(currentAccessType, previousAccessType)}\n`;

                    const currentAddress = safeGet(currentLocation, 'address', 'N/A');
                    const previousAddress = safeGet(previousLocation, 'address', undefined);
                    payloadString += `  - **Location:** ${currentAddress}${formatChangeMarkdown(currentAddress, previousAddress)}\n`;
                    payloadString += `  - **Continent:** ${safeGet(currentLocation, 'continent', 'N/A')}\n`;

                    const currentLink = safeGet(latestOrg, 'link', 'N/A');
                    const previousLink = safeGet(previousOrg, 'link', undefined);
                    payloadString += `  - **Website link:** ${currentLink}${formatChangeMarkdown(currentLink, previousLink)}\n`;

                    const currentCfpLink = safeGet(latestOrg, 'cfpLink', 'N/A');
                    const previousCfpLink = safeGet(previousOrg, 'cfpLink', undefined);
                    payloadString += `  - **Call for papers link:** ${currentCfpLink}${formatChangeMarkdown(currentCfpLink, previousCfpLink)}\n`;

                    const currentImpLink = safeGet(latestOrg, 'impLink', 'N/A');
                    const previousImpLink = safeGet(previousOrg, 'impLink', undefined);
                    if (currentImpLink !== 'N/A' || previousImpLink) {
                        payloadString += `  - **Important dates link:** ${currentImpLink}${formatChangeMarkdown(currentImpLink, previousImpLink)}\n`;
                    }

                    const currentPublisher = safeGet(latestOrg, 'pulisher', 'N/A');
                    const previousPublisher = safeGet(previousOrg, 'pulisher', undefined);
                    if (currentPublisher !== 'N/A' || previousPublisher) {
                        payloadString += `  - **Publisher:** ${currentPublisher}${formatChangeMarkdown(currentPublisher, previousPublisher)}\n`;
                    }

                    const topics = safeGet(latestOrg, 'topics', []);
                    payloadString += `  - **Topics:** ${Array.isArray(topics) && topics.length > 0 ? topics.join(', ') : 'N/A'}\n`;

                    // Dates (Conference Dates first, then others with change tracking)
                    let conferenceDateStr = "N/A";
                    const groupedDates: { [key: string]: string[] } = {};
                    const processedPrevDateIndices = new Set<number>();

                    currentDates.forEach((date: DateEntry) => {
                        const dateType = safeGet(date, 'type', 'otherDate');
                        const dateName = safeGet(date, 'name', 'Unnamed Date');
                        const formattedCurrentDate = formatDateRange(date.fromDate, date.toDate);

                        let foundPrevIndex = -1;
                        const prevDate = previousDates.find((pDate: DateEntry, index: number) => {
                            if (safeGet(pDate, 'type') === dateType && safeGet(pDate, 'name') === dateName) {
                                foundPrevIndex = index;
                                return true;
                            }
                            return false;
                        });

                        let changeIndicator = "";
                        if (prevDate) {
                            processedPrevDateIndices.add(foundPrevIndex);
                            const formattedPrevDate = formatDateRange(prevDate.fromDate, prevDate.toDate);
                            if (formattedCurrentDate !== formattedPrevDate) {
                                changeIndicator = ` **(changed from "${formattedPrevDate}")**`;
                            }
                        } else if (previousOrg) { // Only show (new) if there was a previous version to compare to
                            changeIndicator = " **(new)**";
                        }

                        if (dateType === 'conferenceDates') {
                            conferenceDateStr = `${formattedCurrentDate}${changeIndicator}`;
                        } else {
                            if (!groupedDates[dateType]) {
                                groupedDates[dateType] = [];
                            }
                            const dateLine = `- **${dateName}:** ${formattedCurrentDate}${changeIndicator}`;
                            groupedDates[dateType].push(dateLine);
                        }
                    });

                    if (previousOrg) {
                        previousDates.forEach((pDate: DateEntry, index: number) => {
                            if (!processedPrevDateIndices.has(index)) {
                                const dateType = safeGet(pDate, 'type', 'otherDate');
                                const dateName = safeGet(pDate, 'name', 'Unnamed Date');
                                const formattedPrevDate = formatDateRange(pDate.fromDate, pDate.toDate);
                                const removedTag = " **(removed)**";

                                if (dateType === 'conferenceDates') {
                                    if (conferenceDateStr === "N/A" || conferenceDateStr.endsWith(removedTag)) {
                                        conferenceDateStr = `${formattedPrevDate}${removedTag}`;
                                    }
                                } else {
                                    if (!groupedDates[dateType]) {
                                        groupedDates[dateType] = [];
                                    }
                                    const removedLine = `- **${dateName}:** ${formattedPrevDate}${removedTag}`;
                                    groupedDates[dateType].push(removedLine);
                                }
                            }
                        });
                    }

                    payloadString += `  - **Conference dates:** ${conferenceDateStr}\n`;

                    const importantDateTypes = Object.keys(groupedDates);
                    if (importantDateTypes.length > 0) {
                        payloadString += `  - **Important dates:**\n`;
                        const typeOrder = ['submissionDate', 'notificationDate', 'cameraReadyDate', 'registrationDate', 'otherDate'];
                        importantDateTypes.sort((a, b) => {
                            const indexA = typeOrder.indexOf(a);
                            const indexB = typeOrder.indexOf(b);
                            if (indexA === -1) return 1;
                            if (indexB === -1) return -1;
                            return indexA - indexB;
                        });

                        for (const dateType of importantDateTypes) {
                            payloadString += `    - **${formatDateTypeHeader(dateType)}:**\n`;
                            groupedDates[dateType].forEach(dateLine => {
                                payloadString += `      ${dateLine}\n`;
                            });
                        }
                    }

                    payloadString += `  - **Summary:** ${safeGet(latestOrg, 'summary', 'N/A')}\n`;
                    payloadString += `  - **Call for papers:** \n${safeGet(latestOrg, 'callForPaper', 'N/A')}\n`;
                }

            } else {
                // --- Summary Mode Transformation (Logic remains correct) ---
                payloadString += `  - **Title:** ${safeGet(conf, 'title', 'N/A')}\n`;
                payloadString += `  - **Acronym:** ${safeGet(conf, 'acronym', 'N/A')}\n`;
                payloadString += `  - **Location:** ${safeGet(conf, 'location.address', 'N/A')}\n`;
                payloadString += `  - **Continent:** ${safeGet(conf, 'location.continent', 'N/A')}\n`;
                payloadString += `  - **Rank:** ${safeGet(conf, 'rank', 'N/A')}\n`;
                payloadString += `  - **Source:** **${safeGet(conf, 'source', 'N/A')}**\n`;
                const researchFields = safeGet(conf, 'researchFields', []);
                payloadString += `  - **Research field:** ${Array.isArray(researchFields) && researchFields.length > 0 ? researchFields.join(', ') : 'N/A'}\n`;
                payloadString += `  - **Year:** ${safeGet(conf, 'year', 'N/A')}\n`;
                payloadString += `  - **Type:** ${safeGet(conf, 'accessType', 'N/A')}\n`;
                const topics = safeGet(conf, 'topics', []);
                payloadString += `  - **Topics:** ${Array.isArray(topics) && topics.length > 0 ? topics.join(', ') : 'N/A'}\n`;
                payloadString += `  - **Conference dates:** ${formatDateRange(safeGet(conf, 'dates.fromDate'), safeGet(conf, 'dates.toDate'))}\n`;
                payloadString += `  - **Website link:** ${safeGet(conf, 'link', 'N/A')}\n`;
            }
            payloadString += "---\n";
        });
    }

    // 3. Combine Meta and Payload
    return `${metaString}${payloadString}`;
}