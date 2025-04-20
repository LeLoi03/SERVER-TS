// src/handlers/backendService.ts
import logToFile from '../utils/logger';
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
        const toDate = toDateStr ? new Date(toDateStr) : fromDate; // If no toDate, assume it's the same as fromDate

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return "N/A"; // Invalid date check

        const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
        const yearOption: Intl.DateTimeFormatOptions = { year: 'numeric' };

        const fromFormatted = fromDate.toLocaleDateString('en-US', options);
        const toFormatted = toDate.toLocaleDateString('en-US', options);
        const year = fromDate.toLocaleDateString('en-US', yearOption);

        if (fromDate.toDateString() === toDate.toDateString()) {
            return `${fromFormatted}, ${year}`;
        } else {
            // Check if dates are in the same month and year to avoid redundancy
            if (fromDate.getFullYear() === toDate.getFullYear() && fromDate.getMonth() === toDate.getMonth()) {
                 const fromDay = fromDate.toLocaleDateString('en-US', { day: 'numeric' });
                 const toDay = toDate.toLocaleDateString('en-US', { day: 'numeric' });
                 const month = fromDate.toLocaleDateString('en-US', { month: 'long' });
                 return `${month} ${fromDay} - ${toDay}, ${year}`;
            } else {
                // Different months or years
                 return `${fromFormatted} - ${toFormatted}, ${year}`; // Consider adding year to 'toFormatted' if needed
            }
        }
    } catch (error) {
        logToFile(`Error formatting date range (${fromDateStr}, ${toDateStr}): ${error}`);
        return "N/A";
    }
};

/**
 * Formats a single ISO date string.
 * @param dateStr ISO date string.
 * @returns Formatted date string "Month Day, Year" or "N/A".
 */
const formatSingleDate = (dateStr?: string | null): string => {
     if (!dateStr) return "N/A";
     try {
         const date = new Date(dateStr);
         if (isNaN(date.getTime())) return "N/A";
         const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
         return date.toLocaleDateString('en-US', options);
     } catch (error) {
        logToFile(`Error formatting single date (${dateStr}): ${error}`);
        return "N/A";
     }
};

/**
 * Compares two values and adds a change indicator if they differ.
 * @param currentValue The current value.
 * @param previousValue The previous value.
 * @param formatter Optional function to format the previous value for display.
 * @returns A string indicating the change, or an empty string if no change or no previous value.
 */
const formatChange = (currentValue: any, previousValue: any, formatter?: (val: any) => string): string => {
    if (previousValue === undefined || previousValue === null || currentValue === previousValue) {
        return "";
    }
    const formattedPrev = formatter ? formatter(previousValue) : String(previousValue || "N/A");
    // Only show change if current value is also defined, otherwise it might be a removal (handled elsewhere if needed)
    if (currentValue !== undefined && currentValue !== null) {
         return ` (changed from "${formattedPrev}")`;
    }
    return ""; // Or handle removal case if required by prompt later
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
         // Use bold for emphasis
         return ` **(changed from "${formattedPrev}")**`;
    }
    return "";
};


// --- Data Transformation Logic with Markdown ---
export function transformConferenceData(rawData: string, searchQuery: string): string {
    logToFile(`Transforming conference data with Markdown. Search query: ${searchQuery}`);
    let data;
    try {
        data = JSON.parse(rawData);
        if (!data || typeof data !== 'object') {
            logToFile(`Transformation Error: Parsed data is not a valid object.`);
            return "Error: Could not parse conference data from API.";
        }
    } catch (error) {
        logToFile(`Transformation Error: Failed to parse JSON: ${error}`);
        return "Error: Invalid data format received from API.";
    }

    const payload = safeGet(data, 'payload', []);
    const meta = safeGet(data, 'meta', {});
    const isDetailMode = searchQuery.includes("mode=detail");

    // 1. Format Metadata with Markdown
    let metaString = "**Meta:**\n"; // Bold header
    metaString += `- **Current page:** ${safeGet(meta, 'curPage', 'N/A')}\n`; // Bold label, use list item
    metaString += `- **Per page:** ${safeGet(meta, 'perPage', 'N/A')}\n`;
    metaString += `- **Total items:** ${safeGet(meta, 'totalItems', 'N/A')}\n`;
    metaString += `- **Total page:** ${safeGet(meta, 'totalPage', 'N/A')}\n`;
    metaString += `- **Prev page:** ${safeGet(meta, 'prevPage', 'null')}\n`;
    metaString += `- **Next page:** ${safeGet(meta, 'nextPage', 'null')}\n`;

    // 2. Format Payload with Markdown
    let payloadString = "\n**Payload:**\n"; // Bold header
     payloadString += "---\n"; // Horizontal rule for separation

    if (!Array.isArray(payload) || payload.length === 0) {
        payloadString += "*No conferences found matching your criteria.*\n"; // Italicize if none found
    } else {
        payload.forEach((conf: any, index: number) => {
            // Use bold for the conference number/identifier
            payloadString += `\n**- Conference ${index + 1}.**\n`;

            if (isDetailMode) {
                // --- Detail Mode Transformation with Markdown ---
                payloadString += `  - **Title:** ${safeGet(conf, 'title', 'N/A')}\n`; // Indent fields
                payloadString += `  - **Acronym:** ${safeGet(conf, 'acronym', 'N/A')}\n`;

                // Ranks (Numbered list)
                const ranks = safeGet(conf, 'ranks', []);
                if (Array.isArray(ranks) && ranks.length > 0) {
                    payloadString += `  - **Ranks:**\n`;
                    ranks.forEach((rank: any, rankIndex: number) => {
                        payloadString += `    ${rankIndex + 1}. \n`; // Nested numbered list item
                        payloadString += `       - **Rank:** **${safeGet(rank, 'rank', 'N/A')}**\n`; // Bold rank value
                        payloadString += `       - **Source:** **${safeGet(rank, 'source', 'N/A')}**\n`; // Bold source
                        payloadString += `       - **Research field:** ${safeGet(rank, 'researchField', 'N/A')}\n`;
                    });
                } else {
                     payloadString += `  - **Ranks:** N/A\n`;
                }

                // Organizations - Use latest, compare with previous if exists
                const organizations = safeGet(conf, 'organizations', []);
                const currentOrg = organizations && organizations.length > 0 ? organizations[organizations.length - 1] : {};
                const previousOrg = organizations && organizations.length > 1 ? organizations[organizations.length - 2] : undefined;

                const currentLocation = safeGet(currentOrg, 'locations.0', {});
                const previousLocation = safeGet(previousOrg, 'locations.0', undefined);

                const currentDates = safeGet(currentOrg, 'dates', []);
                const previousDates = safeGet(previousOrg, 'dates', []);

                // Year
                payloadString += `  - **Year:** ${safeGet(currentOrg, 'year', 'N/A')}\n`;

                // Type (Access Type) with change tracking
                const currentAccessType = safeGet(currentOrg, 'accessType', 'N/A');
                const previousAccessType = safeGet(previousOrg, 'accessType', undefined);
                payloadString += `  - **Type:** ${currentAccessType}${formatChangeMarkdown(currentAccessType, previousAccessType)}\n`;

                 // Location (address) with change tracking
                const currentAddress = safeGet(currentLocation, 'address', 'N/A');
                const previousAddress = safeGet(previousLocation, 'address', undefined);
                payloadString += `  - **Location:** ${currentAddress}${formatChangeMarkdown(currentAddress, previousAddress)}\n`;
                payloadString += `  - **Continent:** ${safeGet(currentLocation, 'continent', 'N/A')}\n`;

                // Website link with change tracking
                const currentLink = safeGet(currentOrg, 'link', 'N/A');
                const previousLink = safeGet(previousOrg, 'link', undefined);
                 // Display link directly, maybe make it clickable if platform supports auto-linking
                payloadString += `  - **Website link:** ${currentLink}${formatChangeMarkdown(currentLink, previousLink)}\n`;

                // CFP link with change tracking
                const currentCfpLink = safeGet(currentOrg, 'cfpLink', 'N/A');
                const previousCfpLink = safeGet(previousOrg, 'cfpLink', undefined);
                payloadString += `  - **Call for papers link:** ${currentCfpLink}${formatChangeMarkdown(currentCfpLink, previousCfpLink)}\n`;

                 // Important Dates link with change tracking
                const currentImpLink = safeGet(currentOrg, 'impLink', 'N/A'); // Adjust key if needed
                const previousImpLink = safeGet(previousOrg, 'impLink', undefined);
                if (currentImpLink !== 'N/A' || previousImpLink) {
                     payloadString += `  - **Important dates link:** ${currentImpLink}${formatChangeMarkdown(currentImpLink, previousImpLink)}\n`;
                }

                 // Publisher with change tracking
                const currentPublisher = safeGet(currentOrg, 'publisher', 'N/A');
                const previousPublisher = safeGet(previousOrg, 'publisher', undefined);
                 if (currentPublisher !== 'N/A' || previousPublisher) {
                    payloadString += `  - **Publisher:** ${currentPublisher}${formatChangeMarkdown(currentPublisher, previousPublisher)}\n`;
                 }

                // Topics (Comma-separated list)
                const topics = safeGet(currentOrg, 'topics', []);
                payloadString += `  - **Topics:** ${Array.isArray(topics) && topics.length > 0 ? topics.join(', ') : 'N/A'}\n`; // Keep as comma list for brevity

                // Dates (Conference Dates first, then others with change tracking)
                let conferenceDateStr = "N/A";
                const importantDates: string[] = []; // Store formatted date strings
                const processedPrevDateIndices = new Set<number>();

                // Process current dates and compare with previous
                currentDates.forEach((date: any) => {
                    const dateType = safeGet(date, 'type', '');
                    const dateName = safeGet(date, 'name', 'Unnamed Date');
                    const fromDate = safeGet(date, 'fromDate');
                    const toDate = safeGet(date, 'toDate');
                    const formattedCurrentDate = formatDateRange(fromDate, toDate);

                    let foundPrevIndex = -1;
                    const prevDate = previousDates.find((pDate: any, index: number) => {
                         if (safeGet(pDate, 'type') === dateType && safeGet(pDate, 'name') === dateName) {
                              foundPrevIndex = index;
                              return true;
                         }
                         return false;
                    });

                    let changeIndicator = "";
                    if (prevDate) {
                        processedPrevDateIndices.add(foundPrevIndex);
                        const prevFromDate = safeGet(prevDate, 'fromDate');
                        const prevToDate = safeGet(prevDate, 'toDate');
                        const formattedPrevDate = formatDateRange(prevFromDate, prevToDate);
                        if (formattedCurrentDate !== formattedPrevDate) {
                            // Use bold Markdown helper
                            changeIndicator = ` **(changed from "${formattedPrevDate}")**`;
                        }
                    } else if (previousOrg) {
                        changeIndicator = " **(new)**"; // Bold 'new'
                    }

                    if (dateType === 'conferenceDates') {
                        conferenceDateStr = `${formattedCurrentDate}${changeIndicator}`;
                    } else {
                        // Add date as a bullet point string
                        importantDates.push(`  - **${dateName}:** ${formattedCurrentDate}${changeIndicator}`);
                    }
                });

                 // Check for removed dates
                if (previousOrg) {
                    previousDates.forEach((pDate: any, index: number) => {
                        if (!processedPrevDateIndices.has(index)) {
                             const dateType = safeGet(pDate, 'type', '');
                             const dateName = safeGet(pDate, 'name', 'Unnamed Date');
                             const formattedPrevDate = formatDateRange(safeGet(pDate, 'fromDate'), safeGet(pDate, 'toDate'));
                             const removedTag = " **(removed)**"; // Bold 'removed'

                             if (dateType === 'conferenceDates') {
                                 // Only add if no current conference date exists
                                 if (conferenceDateStr === "N/A" || conferenceDateStr.endsWith(removedTag)) {
                                    conferenceDateStr = `${formattedPrevDate}${removedTag}`;
                                 }
                             } else {
                                 importantDates.push(`  - **${dateName}:** ${formattedPrevDate}${removedTag}`);
                             }
                        }
                    });
                }

                // Add Conference Dates first
                payloadString += `  - **Conference dates:** ${conferenceDateStr}\n`;

                // Add Important Dates if any exist
                if (importantDates.length > 0) {
                    payloadString += `  - **Important dates:**\n`; // Header for important dates
                    importantDates.forEach(dateStr => {
                        // Indent the date details further under the header
                        payloadString += `    ${dateStr.trimStart()}\n`; // Use trimStart to remove leading space added earlier if needed, or adjust indenting
                    });
                }


                // Summary and Call for Papers
                payloadString += `  - **Summary:** ${safeGet(currentOrg, 'summary', 'N/A')}\n`;
                 // Keep CFP as plain text for now, potential for complex markdown inside
                payloadString += `  - **Call for papers:** \n${safeGet(currentOrg, 'callForPaper', 'N/A')}\n`;


            } else {
                // --- Summary Mode Transformation with Markdown ---
                payloadString += `  - **Title:** ${safeGet(conf, 'title', 'N/A')}\n`; // Indent fields
                payloadString += `  - **Acronym:** ${safeGet(conf, 'acronym', 'N/A')}\n`;
                payloadString += `  - **Location:** ${safeGet(conf, 'location.address', 'N/A')}\n`;
                payloadString += `  - **Continent:** ${safeGet(conf, 'location.continent', 'N/A')}\n`;
                payloadString += `  - **Rank:** **${safeGet(conf, 'rank', 'N/A')}**\n`; // Bold rank
                payloadString += `  - **Source:** **${safeGet(conf, 'source', 'N/A')}**\n`; // Bold source
                const researchFields = safeGet(conf, 'researchFields', []);
                payloadString += `  - **Research field:** ${Array.isArray(researchFields) && researchFields.length > 0 ? researchFields.join(', ') : 'N/A'}\n`;
                payloadString += `  - **Year:** ${safeGet(conf, 'year', 'N/A')}\n`;
                payloadString += `  - **Type:** ${safeGet(conf, 'accessType', 'N/A')}\n`;
                const topics = safeGet(conf, 'topics', []);
                payloadString += `  - **Topics:** ${Array.isArray(topics) && topics.length > 0 ? topics.join(', ') : 'N/A'}\n`;
                payloadString += `  - **Conference dates:** ${formatDateRange(safeGet(conf, 'dates.fromDate'), safeGet(conf, 'dates.toDate'))}\n`;
                payloadString += `  - **Website link:** ${safeGet(conf, 'link', 'N/A')}\n`;
            }
            payloadString += "---\n"; // Horizontal rule between conferences
        });
    }

    // 3. Combine Meta and Payload
    return `${metaString}${payloadString}`;
}
