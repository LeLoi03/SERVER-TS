// src/types/crawl.types.ts

// --------------------- GLOBAL CRAWL FLOW TYPES ---------------------

/**
 * Defines the type of Gemini AI model to be used for different API calls in the crawling process.
 * - 'non-tuned': Refers to the base, foundational Gemini model (e.g., gemini-pro).
 * - 'tuned': Refers to a fine-tuned version of a Gemini model, optimized for specific tasks.
 */
export type CrawlModelType = 'non-tuned' | 'tuned';

/**
 * Specifies the AI model preferences for each stage of the crawling pipeline.
 * This allows dynamic selection between 'tuned' and 'non-tuned' models.
 */
export interface ApiModels {
    /** The model type to be used for the 'determineLinks' API stage. */
    determineLinks: CrawlModelType;
    /** The model type to be used for the 'extractInfo' API stage. */
    extractInfo: CrawlModelType;
    /** The model type to be used for the 'extractCfp' API stage. */
    extractCfp: CrawlModelType;
}

// --------------------- INITIAL INPUT DATA TYPES ---------------------

/**
 * Represents the initial input data for a conference, typically from a CSV file
 * or provided via an API request for crawling.
 */
export interface ConferenceData {
    /** The full title of the conference. */
    Title: string;
    /** The acronym or abbreviation of the conference. */
    Acronym: string;
    /** Optional: A unique identifier for the conference from its source (e.g., CSV row ID, database ID). */
    id?: string | number;
    /** Optional: The ID of the original request if this is a re-crawl or part of a larger batch. */
    originalRequestId?: string;
    /** Optional: The main link (URL) of the conference. */
    mainLink?: string;
    /** Optional: The URL for the Call for Papers (CFP). */
    cfpLink?: string;
    /** Optional: The URL for important dates. */
    impLink?: string;
}

/**
 * Represents input data specifically for an UPDATE crawl flow,
 * where the main, CFP, and important dates links are already known.
 */
export interface ConferenceUpdateData {
    /** The full title of the conference. */
    Title: string;
    /** The acronym or abbreviation of the conference. */
    Acronym: string;
    /** The primary URL of the conference. */
    mainLink: any;
    /** The URL for the Call for Papers (CFP). */
    cfpLink: any;
    /** The URL for important dates. */
    impLink: any;
    /** Optional: The ID of the original request if this is a re-crawl. */
    originalRequestId?: string;
}

// --------------------- INTERMEDIATE BATCH PROCESSING DATA TYPES ---------------------

/**
 * Represents an entry processed within a batch, after initial link handling (e.g., URL resolution).
 * Contains information needed for subsequent AI API calls like `determine_links`.
 */
export interface BatchEntry {
    /** The title of the conference. */
    conferenceTitle: string;
    /** The acronym of the conference. */
    conferenceAcronym: string;
    /** The resolved main link (URL) of the conference. */
    conferenceLink: string;
    /** The file path to the extracted text content of the main conference link. Null if text extraction failed. */
    conferenceTextPath: string | null;
    /** Optional: The ID of the original request, carried forward from the initial `ConferenceData`. */
    originalRequestId?: string;
    /** Optional: The index of the link within its original ordered list (for tracking). */
    linkOrderIndex?: number;
    /** Optional: The Call for Papers (CFP) link determined by an AI model. */
    cfpLink?: string;
    /** Optional: The Important Dates (IMP) link determined by an AI model. */
    impLink?: string;
    /** Optional: The file path to the extracted text content of the CFP link. Null if extraction failed. */
    cfpTextPath?: string | null;
    /** Optional: The file path to the extracted text content of the IMP link. Null if extraction failed. */
    impTextPath?: string | null;
}

/**
 * Represents an entry processed within a batch for an UPDATE flow.
 * Contains paths to pre-existing text files for AI model processing.
 */
export interface BatchUpdateEntry {
    /** The title of the conference. */
    conferenceTitle: string;
    /** The acronym of the conference. */
    conferenceAcronym: string;
    /** The file path to the text content of the main conference page. */
    conferenceTextPath: string;
    /** The file path to the text content of the CFP page. Null if CFP link was not available or text extraction failed. */
    cfpTextPath: string | null;
    /** The file path to the text content of the Important Dates page. Null if IMP link was not available or text extraction failed. */
    impTextPath: string | null;
    /** Optional: The ID of the original request, carried forward from the initial `ConferenceUpdateData`. */
    originalRequestId?: string;
}

// --------------------- JSONL FILE OUTPUT DATA TYPES (AFTER BATCH PROCESSING) ---------------------

/**
 * Represents the complete data structure of a single entry after the SAVE crawl flow,
 * ready to be written to a JSONL file. Includes unique batch IDs and all metadata from AI API calls.
 */
export interface BatchEntryWithIds extends BatchEntry {
    /** The unique identifier for the batch API call that processed this item. */
    batchRequestId: string;
    /** Optional: The file path to the raw response text from the 'determine_links' API. */
    determineResponseTextPath?: string;
    /** Optional: Raw metadata or structured response from the 'determine_links' API. */
    determineMetaData?: any; // Consider a more specific type if schema is known
    /** Optional: The file path to the raw response text from the 'extract_information' API. */
    extractResponseTextPath?: string;
    /** Optional: Raw metadata or structured response from the 'extract_information' API. */
    extractMetaData?: any; // Consider a more specific type if schema is known
    /** Optional: The file path to the raw response text from the 'extract_cfp' API. */
    cfpResponseTextPath?: string;
    /** Optional: Raw metadata or structured response from the 'extract_cfp' API. */
    cfpMetaData?: any; // Consider a more specific type if schema is known
}

/**
 * Represents the complete data structure of a single entry after the UPDATE crawl flow,
 * ready to be written to a JSONL file.
 */
export interface BatchUpdateDataWithIds extends BatchUpdateEntry {
    /** The unique identifier for the batch API call that processed this item. */
    batchRequestId: string;
    /** Optional: The file path to the raw response text from the 'extract_information' API. */
    extractResponseTextPath?: string;
    /** Optional: Raw metadata or structured response from the 'extract_information' API. */
    extractMetaData?: any; // Consider a more specific type if schema is known
    /** Optional: The file path to the raw response text from the 'extract_cfp' API. */
    cfpResponseTextPath?: string;
    /** Optional: Raw metadata or structured response from the 'extract_cfp' API. */
    cfpMetaData?: any; // Consider a more specific type if schema is known
}

// --------------------- RESULT PROCESSING DATA TYPES (READING JSONL, WRITING CSV) ---------------------

/**
 * Represents a single row of data read from a JSONL file by the `ResultProcessingService`.
 * This structure should be flexible enough to accommodate both `BatchEntryWithIds`
 * and `BatchUpdateDataWithIds` as they are written to the JSONL output.
 */
export interface InputRowData {
    /** The title of the conference. */
    conferenceTitle: string;
    /** The acronym of the conference. */
    conferenceAcronym: string;
    /** Optional: The resolved main link of the conference. */
    conferenceLink?: string;
    /** Optional: Path to the text content of the main conference link. */
    conferenceTextPath?: string | null;
    /** Optional: The Call for Papers (CFP) link identified. */
    cfpLink?: string;
    /** Optional: The Important Dates (IMP) link identified. */
    impLink?: string;
    /** Optional: Path to the text content of the CFP link. */
    cfpTextPath?: string | null;
    /** Optional: Path to the text content of the IMP link. */
    impTextPath?: string | null;

    /** Optional: Path to the raw response text from the 'determine_links' API. */
    determineResponseTextPath?: string;
    /** Optional: Path to the raw response text from the 'extract_information' API. */
    extractResponseTextPath?: string;
    /** Optional: Path to the raw response text from the 'extract_cfp' API. */
    cfpResponseTextPath?: string;

    /** Optional: Raw metadata or structured response from the 'determine_links' API. */
    determineMetaData?: any; // Consider more specific type if schema is known
    /** Optional: Raw metadata or structured response from the 'extract_information' API. */
    extractMetaData?: any; // Consider more specific type if schema is known
    /** Optional: Raw metadata or structured response from the 'extract_cfp' API. */
    cfpMetaData?: any; // Consider more specific type if schema is known

    /** The unique ID of the batch request that generated this data. Required. */
    batchRequestId: string;
    /** Optional: The ID of the original request, if applicable. */
    originalRequestId?: string;
}

/**
 * Defines a structure for submission, notification, camera-ready, and registration dates.
 * This can be used for parsing various date types where a name and value are needed.
 */
export interface DateDetails {
    /** The name of the date field (e.g., "abstract_submission_deadline"). */
    name?: string;
    /** The value of the date (e.g., "2023-12-31"). */
    value?: string;
}

/**
 * Represents the structured and normalized data extracted from Gemini API responses.
 * This data is typically ready for further processing or storage.
 */
export interface ProcessedResponseData {
    /** Formatted string representing conference dates. */
    conferenceDates: string;
    /** The year of the conference. */
    year: string;
    /** The general location string of the conference. */
    location: string;
    /** The city, state, or province of the conference location. */
    cityStateProvince: string;
    /** The country of the conference location. */
    country: string;
    /** The continent of the conference location. */
    continent: string;
    /** The type of event (e.g., "Conference", "Workshop"). */
    type: string;
    /** A record of submission dates, where keys are categories and values are date strings. */
    submissionDate: Record<string, string | undefined>;
    /** A record of notification dates. */
    notificationDate: Record<string, string | undefined>;
    /** A record of camera-ready dates. */
    cameraReadyDate: Record<string, string | undefined>;
    /** A record of registration dates. */
    registrationDate: Record<string, string | undefined>;
    /** A record of any other important dates. */
    otherDate: Record<string, string | undefined>;
    /** A comma-separated string or array of topics covered by the conference. */
    topics: string;
    /** The publisher of the conference proceedings or journal. */
    publisher: string;
    /** A brief summary of the conference or its content. */
    summary: string;
    /** Information related to the Call for Papers. */
    callForPapers: string;
    /** General information extracted from the website. */
    information: string;
}

/**
 * Represents the final, comprehensive data structure for a processed row,
 * ready to be written to a CSV file or returned to the frontend.
 * Combines initial metadata with processed AI response data.
 */
export interface ProcessedRowData extends ProcessedResponseData {
    /** The title of the conference (from initial input). */
    title: string;
    /** The acronym of the conference (from initial input). */
    acronym: string;
    /** The main URL of the conference. */
    link: string;
    /** The Call for Papers (CFP) URL. */
    cfpLink: string;
    /** The Important Dates (IMP) URL. */
    impLink: string;
    /** Structured metadata from the 'determineLinks' AI API call, if available. */
    determineLinks: Record<string, any>; // Consider a more specific type if schema is known
    /** The unique ID of the batch request that generated this processed row. */
    requestId: string;
    /** Optional: The ID of the original request, useful for tracing back the source data. */
    originalRequestId?: string;
    // inputConference?: ConferenceData; // Optional: Can include the original input object if needed
}

// --------------------- GOOGLE SEARCH API TYPES ---------------------


/**
 * Custom error class specifically for Google Search API-related errors.
 * Extends the native Error class and includes an optional 'details' property
 * for structured error information.
 */
export class GoogleSearchError extends Error {
    /** Additional structured details about the error. */
    details: any; // Using `any` for `details` as its structure can vary widely from Google API responses.

    /**
     * Creates an instance of GoogleSearchError.
     * @param {string} message - The error message.
     * @param {any} [details={}] - Optional: Additional details about the error (e.g., status codes, Google API specific error objects).
     */
    constructor(message: string, details: any = {}) {
        super(message);
        this.name = 'GoogleSearchError';
        this.details = details;
        // This is crucial for correct `instanceof` checks in TypeScript/JavaScript.
        Object.setPrototypeOf(this, GoogleSearchError.prototype);
    }
}

/**
 * Represents a single search result from Google Custom Search, simplified for internal use.
 */
export interface GoogleSearchResult {
    /** The title of the search result. */
    title: string;
    /** The URL of the search result. */
    link: string;
    /** Optional: A short snippet of content from the search result. */
    snippet?: string;
}

/**
 * Partial interface for the Google Custom Search API response structure.
 * Only includes relevant fields for this application.
 */
export interface GoogleCSEApiResponse {
    /** An array of search result items. */
    items?: GoogleApiItem[];
    /** Error details if the API call failed. */
    error?: GoogleApiErrorBody;
}

/**
 * Represents a single item within the `items` array of the Google Custom Search API response.
 */
interface GoogleApiItem {
    /** The title of the search result item. */
    title?: string;
    /** The link (URL) of the search result item. */
    link?: string;
}

/**
 * Represents the error body structure from the Google Custom Search API.
 */
interface GoogleApiErrorBody {
    /** The HTTP status code of the error. */
    code: number;
    /** A general error message. */
    message: string;
    /** An array of more specific error details. */
    errors: GoogleApiErrorDetail[];
}

/**
 * Represents a single detailed error entry within `GoogleApiErrorBody`.
 */
interface GoogleApiErrorDetail {
    /** A specific error message for this detail. */
    message: string;
    /** The domain related to the error (e.g., 'usageLimits'). */
    domain: string;
    /** The reason for the error (e.g., 'dailyLimitExceeded'). */
    reason: string;
}

// --------------------- DATA MANAGER TYPES (FOR GEMINI CSV DATASETS) ---------------------

/**
 * Represents a single row of data in a CSV file used for Gemini dataset preparation.
 * Typically contains 'input' and 'output' columns.
 */
export interface CsvRowData {
    /** The input prompt or context for the AI model. */
    input: string;
    /** The expected output or response from the AI model for the given input. */
    output: string;
}

/**
 * Represents a collection of inputs and their corresponding outputs,
 * used for preparing data for AI model training or evaluation.
 */
export interface InputsOutputs {
    /** A record where keys are input identifiers and values are the input strings. */
    inputs: Record<string, string>;
    /** A record where keys are output identifiers and values are the output strings. */
    outputs: Record<string, string>;
}