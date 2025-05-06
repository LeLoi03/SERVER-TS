// ---------------------1_google_search.ts-----------------------


// Helper class to create Error objects with additional properties
export class GoogleSearchError extends Error {
    details: any; // Define type for 'details' if you have a specific structure

    constructor(message: string, details: any = {}) {
        super(message);
        this.name = 'GoogleSearchError';
        this.details = details; // Contains status, code, googleErrorCode, etc.
        // Set the prototype explicitly for instances of GoogleSearchError to be properly recognized as Errors
        Object.setPrototypeOf(this, GoogleSearchError.prototype);
    }
}

// Define the structure of a Google Search Result Item
export interface GoogleSearchResult {
    title: string;
    link: string;
}

// Define the structure of the Google Custom Search Response Data (partial, based on what's used)
export interface GoogleCSEApiResponse {
    items?: GoogleApiItem[];
    error?: GoogleApiErrorBody;
}

interface GoogleApiItem {
    title?: string;
    link?: string;
    // Add other properties from Google Search API response if needed
}

interface GoogleApiErrorBody {
    code: number;
    message: string;
    errors: GoogleApiErrorDetail[];
}

interface GoogleApiErrorDetail {
    message: string;
    domain: string;
    reason: string;
    // Add other error detail properties if needed
}


// ---------------------4_link_filtering.ts---------------------

/**
 * Represents a single search result item.
 * Requires a 'link' property and optionally accepts a 'title'.
 */
export interface SearchResult {
    link: string;
    title?: string; // title is optional
    // Add other potential properties if they exist, even if not used in this function
    // e.g., snippet?: string;
}


// ---------------------6_playwright_utils.ts-----------------------
// Define an interface for a single detail object within the array
// interface DetailItem {
//     Acronym?: string;
//     "DBLP Source"?: string;
//     Source?: string;
//     Rank?: string;
//     "Field Of Research"?: string[];
// }

// // Define the type for the Details array
// type DetailsArray = DetailItem[];

export interface ConferenceData {
    Acronym: string;
    Title: string;
    mainLink?: string;
    cfpLink?: string;
    impLink?: string;
}

export interface BatchEntry {
    conferenceTitle: string;
    conferenceAcronym: string;

    conferenceIndex: string;
    conferenceLink: string;

    cfpLink?: string;
    impLink?: string;

    determineMetaData?: any; // TODO: Refine type for determineMetaData
    extractMetaData?: any; // TODO: Refine type for extractMetaData
    cfpMetaData?: any | null;     // <<< ADDED

    // --- Các trường Path ---
    conferenceTextPath?: string; // Đường dẫn đến file chứa full text của trang gốc/đã sửa
    cfpTextPath?: string | null;        // Đường dẫn đến file chứa text của trang CFP
    impTextPath?: string | null;        // Đường dẫn đến file chứa text của trang Important Dates
    determineResponseTextPath?: string; // Đường dẫn file chứa response của determine_links_api
    extractResponseTextPath?: string;   // Đường dẫn file chứa response của extract_information_api
    cfpResponseTextPath?: string;   // <<< ADDED

}

export interface ConferenceUpdateData { // Dữ liệu đầu vào cho updateHTMLContent và updateBatchToFile
    Acronym: string;
    Title: string;
    mainLink: string;
    cfpLink: string;
    impLink: string;
}

export interface BatchUpdateEntry { // Dữ liệu batch sau khi updateBatchToFile
    conferenceTitle: string;
    conferenceAcronym: string;
    conferenceTextPath?: string;
    cfpTextPath?: string | null;
    impTextPath?: string | null;
    extractResponseTextPath?: string;
    extractMetaData?: any;
    cfpResponseTextPath?: string;   // <<< ADDED
    cfpMetaData?: any | null;     // <<< ADDED
}
// ---------------------7_gemini_api_utils.ts-----------------------






// ---------------------8_data_manager.ts-----------------------

// --- Interfaces ---

// Interface for the data structure read from CSV rows
export interface CsvRowData {
    input: string;
    output: string;
}

// Interface for the structured input/output object
export interface InputsOutputs {
    inputs: Record<string, string>;
    outputs: Record<string, string>;
}


// ---------------------10_response_processing.ts-----------------------

// --- Interfaces for Data Structures ---

// Describes the structure of the nested date objects
interface DateDetails {
    [key: string]: string | undefined; // Allow any string key, value is string or undefined
}

// Describes the structure returned by processResponse
export interface ProcessedResponseData {
    conferenceDates: string;
    year: string; // Kept as string based on usage
    location: string;
    cityStateProvince: string;
    country: string;
    continent: string;
    type: string;
    submissionDate: DateDetails;
    notificationDate: DateDetails;
    cameraReadyDate: DateDetails;
    registrationDate: DateDetails;
    otherDate: DateDetails;
    topics: string;
    publisher: string;
    summary: string;
    callForPapers: string;
    information: string;
}

// Describes the structure of the input row data for writeCSVFile
export interface InputRowData {
    conferenceTitle?: string; // Mark as optional if they might be missing
    conferenceAcronym?: string;
    // conferenceRank?: string;
    // conferenceRating?: string;
    // conferenceDBLP?: string;
    // conferenceNote?: string;
    // conferenceComments?: string;
    // conferencePrimaryFoR?: string;
    // conferenceSource?: string;
    conferenceLink?: string;
    cfpLink?: string; // Added based on usage in writeCSVFile
    impLink?: string; // Added based on usage in writeCSVFile
    determineResponseTextPath?: string; // Đường dẫn file chứa response của determine_links_api
    extractResponseTextPath?: string    // Add other potential fields if necessary
    cfpResponseTextPath?: string    // Add other potential fields if necessary
}

// Describes the structure of the final row written to the CSV
// It combines fields from InputRowData and ProcessedResponseData
// Describes the structure of the final row written to the CSV
// It combines fields from InputRowData and ProcessedResponseData
export interface ProcessedRowData extends ProcessedResponseData {
    title: string;
    acronym: string;
    // rank: string;
    // rating: string;
    // dblp: string;
    // note: string;
    // comments: string;
    // fieldOfResearch: string;
    // source: string;
    determineLinks: Record<string, any>; // Changed to an object type
    link: string;
    cfpLink: string;
    impLink: string;
}






// ---------------------12_playwright_setup.ts-----------------------

import { Browser, BrowserContext } from "playwright";


// Định nghĩa kiểu dữ liệu cho kết quả trả về
export interface PlaywrightSetupResult {
    browser: Browser | null;
    browserContext: BrowserContext | null;
}
