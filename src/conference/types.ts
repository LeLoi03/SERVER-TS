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
interface DetailItem {
    Acronym?: string;
    "DBLP Source"?: string;
    Source?: string;
    Rank?: string;
    "Field Of Research"?: string[];
}

// Define the type for the Details array
type DetailsArray = DetailItem[];

export interface ConferenceData {
    Acronym: string;
    Title: string;
    Source?: string;
    Rank?: string;
    Note?: string;
    DBLP?: string;
    PrimaryFoR?: string;
    Comments?: string;
    Rating?: string;
    Details?: DetailsArray; // Changed to DetailsArray
    mainLink?: string;
    cfpLink?: string;
    impLink?: string;
}

export interface BatchEntry {
    conferenceName: string;
    conferenceAcronym: string;
    conferenceSource: string;
    conferenceRank: string;
    conferenceNote: string;
    conferenceDBLP: string;
    conferencePrimaryFoR: string;
    conferenceComments: string;
    conferenceRating: string;
    conferenceDetails: DetailsArray; // Changed to DetailsArray
    conferenceIndex: string;
    conferenceLink: string;
    formatConferenceText: string;
    conferenceText: string;
    cfpLink: string;
    impLink: string;
    cfpText: string;
    impText: string;
    determineResponseText?: string;
    determineMetaData?: any; // TODO: Refine type for determineMetaData
    extractResponseText?: string;
    extractMetaData?: any; // TODO: Refine type for extractMetaData
}

export interface ConferenceUpdateData { // Dữ liệu đầu vào cho updateHTMLContent và updateBatchToFile
    Acronym: string;
    Title: string;
    mainLink: string;
    cfpLink: string;
    impLink: string;
    conferenceText: string; // Nội dung chính đã fetch trước đó, có thể rỗng
    cfpText: string;
    impText: string;
    extractResponseText?: string;
    extractMetaData?: any;
}

export interface BatchUpdateEntry { // Dữ liệu batch sau khi updateBatchToFile
    conferenceName: string;
    conferenceAcronym: string;
    conferenceText: string;
    cfpLink: string;
    impLink: string;
    cfpText: string;
    impText: string;
    extractResponseText?: string;
    extractMetaData?: any;
}
// ---------------------7_gemini_api_utils.ts-----------------------


import {
    type GenerationConfig, // Import specific type
    type UsageMetadata, // Import specific type
    // HarmCategory, HarmBlockThreshold, // Optionally import safety types if needed
} from "@google/generative-ai";

import {
    RateLimiterMemory,
} from 'rate-limiter-flexible';

// --- Type Definitions ---
export interface ApiResponse {
    responseText: string;
    metaData: UsageMetadata | null | undefined;
}

// Type for the function passed to executeWithRetry
export type RetryableFunction = (limiter: RateLimiterMemory) => Promise<ApiResponse>;

// Interface for parameters passed to callGeminiAPI
export interface CallGeminiApiParams {
    batch: string;
    batchIndex: number;
    acronym: string | undefined;
    apiType: string;
    systemInstruction: string;
    modelName: string;
    generationConfig: GenerationConfig | undefined;
}



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
    conferenceName?: string; // Mark as optional if they might be missing
    conferenceAcronym?: string;
    conferenceRank?: string;
    conferenceRating?: string;
    conferenceDBLP?: string;
    conferenceNote?: string;
    conferenceComments?: string;
    conferencePrimaryFoR?: string;
    conferenceSource?: string;
    conferenceLink?: string;
    cfpLink?: string; // Added based on usage in writeCSVFile
    impLink?: string; // Added based on usage in writeCSVFile
    extractResponseText?: string; // The raw JSON string (potentially)
    // Add other potential fields if necessary
}

// Describes the structure of the final row written to the CSV
// It combines fields from InputRowData and ProcessedResponseData
export interface ProcessedRowData extends ProcessedResponseData {
    name: string;
    acronym: string;
    rank: string;
    rating: string;
    dblp: string;
    note: string;
    comments: string;
    fieldOfResearch: string;
    source: string;
    link: string;
    cfpLink: string;
    impLink: string;
    // Inherits all fields from ProcessedResponseData
}




// ---------------------11_utils.ts-----------------------

import { Writable } from 'stream'; // Import Writable để kế thừa


// --- Interface tùy chỉnh cho Pino Destination Stream ---
// Interface này mô tả cấu trúc mong đợi của đối tượng trả về từ pino.destination({ sync: false })
// Kế thừa Writable để có các phương thức stream như .on() và thêm flushSync()
export interface PinoFileDestination extends Writable {
    flushSync(): void;
    // Có thể thêm các phương thức/thuộc tính khác nếu cần trong tương lai
    // destroy?(): void;
    // reopen?(file?: string): void;
}


// ---------------------12_playwright_setup.ts-----------------------

import {Browser, BrowserContext } from "playwright";


// Định nghĩa kiểu dữ liệu cho kết quả trả về
export interface PlaywrightSetupResult {
    browser: Browser | null;
    browserContext: BrowserContext | null;
}
