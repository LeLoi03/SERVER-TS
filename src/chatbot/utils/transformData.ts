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
                        payloadString += `       - **Rank:** **${safeGet(rank, 'rank', 'N/A')}**\n`;
                        payloadString += `       - **Source:** **${safeGet(rank, 'source', 'N/A')}**\n`;
                        payloadString += `       - **Research field:** ${safeGet(rank, 'researchField', 'N/A')}\n`;
                    });
                } else {
                    payloadString += `  - **Ranks:** N/A\n`;
                }

                // Organizations - Use latest, compare with previous if exists
                const organizations = safeGet(conf, 'organizations', []);
                const rawCurrentOrg = organizations && organizations.length > 0 ? organizations[organizations.length - 1] : undefined;
                const rawPreviousOrg = organizations && organizations.length > 1 ? organizations[organizations.length - 2] : undefined;

                // **FIX: Normalize the organization objects to handle inconsistent structure**
                const currentOrg = getNormalizedOrg(rawCurrentOrg);
                const previousOrg = getNormalizedOrg(rawPreviousOrg);

                if (!currentOrg) {
                    payloadString += `  - *No detailed organization data available.*\n`;
                } else {
                    const currentLocation = safeGet(currentOrg, 'locations.0', {});
                    const previousLocation = safeGet(previousOrg, 'locations.0', undefined);
                    const currentDates = safeGet(currentOrg, 'dates', []);
                    const previousDates = safeGet(previousOrg, 'dates', []);

                    payloadString += `  - **Year:** ${safeGet(currentOrg, 'year', 'N/A')}\n`;

                    const currentAccessType = safeGet(currentOrg, 'accessType', 'N/A');
                    const previousAccessType = safeGet(previousOrg, 'accessType', undefined);
                    payloadString += `  - **Type:** ${currentAccessType}${formatChangeMarkdown(currentAccessType, previousAccessType)}\n`;

                    const currentAddress = safeGet(currentLocation, 'address', 'N/A');
                    const previousAddress = safeGet(previousLocation, 'address', undefined);
                    payloadString += `  - **Location:** ${currentAddress}${formatChangeMarkdown(currentAddress, previousAddress)}\n`;
                    payloadString += `  - **Continent:** ${safeGet(currentLocation, 'continent', 'N/A')}\n`;

                    const currentLink = safeGet(currentOrg, 'link', 'N/A');
                    const previousLink = safeGet(previousOrg, 'link', undefined);
                    payloadString += `  - **Website link:** ${currentLink}${formatChangeMarkdown(currentLink, previousLink)}\n`;

                    const currentCfpLink = safeGet(currentOrg, 'cfpLink', 'N/A');
                    const previousCfpLink = safeGet(previousOrg, 'cfpLink', undefined);
                    payloadString += `  - **Call for papers link:** ${currentCfpLink}${formatChangeMarkdown(currentCfpLink, previousCfpLink)}\n`;

                    const currentImpLink = safeGet(currentOrg, 'impLink', 'N/A');
                    const previousImpLink = safeGet(previousOrg, 'impLink', undefined);
                    if (currentImpLink !== 'N/A' || previousImpLink) {
                        payloadString += `  - **Important dates link:** ${currentImpLink}${formatChangeMarkdown(currentImpLink, previousImpLink)}\n`;
                    }

                    // **FIX: Corrected typo from 'publisher' to 'pulisher' to match JSON**
                    const currentPublisher = safeGet(currentOrg, 'pulisher', 'N/A');
                    const previousPublisher = safeGet(previousOrg, 'pulisher', undefined);
                    if (currentPublisher !== 'N/A' || previousPublisher) {
                        payloadString += `  - **Publisher:** ${currentPublisher}${formatChangeMarkdown(currentPublisher, previousPublisher)}\n`;
                    }

                    const topics = safeGet(currentOrg, 'topics', []);
                    payloadString += `  - **Topics:** ${Array.isArray(topics) && topics.length > 0 ? topics.join(', ') : 'N/A'}\n`;

                    // Dates (Conference Dates first, then others with change tracking)
                    let conferenceDateStr = "N/A";
                    // **MODIFICATION: Use an object to group dates by type**
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
                        } else if (previousOrg) {
                            changeIndicator = " **(new)**";
                        }

                        if (dateType === 'conferenceDates') {
                            conferenceDateStr = `${formattedCurrentDate}${changeIndicator}`;
                        } else {
                            // **MODIFICATION: Add the formatted date string to its corresponding group**
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
                                    // **MODIFICATION: Add removed dates to their group**
                                    if (!groupedDates[dateType]) {
                                        groupedDates[dateType] = [];
                                    }
                                    const removedLine = `- **${dateName}:** ${formattedPrevDate}${removedTag}`;
                                    groupedDates[dateType].push(removedLine);
                                }
                            }
                        });
                    }

                    // Add Conference Dates first
                    payloadString += `  - **Conference dates:** ${conferenceDateStr}\n`;

                    // **MODIFICATION: Build the final string from the grouped dates object**
                    const importantDateTypes = Object.keys(groupedDates);
                    if (importantDateTypes.length > 0) {
                        payloadString += `  - **Important dates:**\n`;
                        // Define a preferred order for date types
                        const typeOrder = ['submissionDate', 'notificationDate', 'cameraReadyDate', 'registrationDate', 'otherDate'];

                        // Sort the types based on the preferred order
                        importantDateTypes.sort((a, b) => {
                            const indexA = typeOrder.indexOf(a);
                            const indexB = typeOrder.indexOf(b);
                            // If a type is not in the order list, push it to the end
                            if (indexA === -1) return 1;
                            if (indexB === -1) return -1;
                            return indexA - indexB;
                        });

                        for (const dateType of importantDateTypes) {
                            // Add a sub-header for the group
                            payloadString += `    - **${formatDateTypeHeader(dateType)}:**\n`;
                            // Add each date within that group
                            groupedDates[dateType].forEach(dateLine => {
                                payloadString += `      ${dateLine}\n`;
                            });
                        }
                    }

                    payloadString += `  - **Summary:** ${safeGet(currentOrg, 'summary', 'N/A')}\n`;
                    payloadString += `  - **Call for papers:** \n${safeGet(currentOrg, 'callForPaper', 'N/A')}\n`;
                }

            } else {
                // --- Summary Mode Transformation (Confirmed to be correct) ---
                payloadString += `  - **Title:** ${safeGet(conf, 'title', 'N/A')}\n`;
                payloadString += `  - **Acronym:** ${safeGet(conf, 'acronym', 'N/A')}\n`;
                payloadString += `  - **Location:** ${safeGet(conf, 'location.address', 'N/A')}\n`;
                payloadString += `  - **Continent:** ${safeGet(conf, 'location.continent', 'N/A')}\n`;
                payloadString += `  - **Rank:** **${safeGet(conf, 'rank', 'N/A')}**\n`;
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