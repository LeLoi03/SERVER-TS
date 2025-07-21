// src/services/batchProcessing/conferenceDataAggregator.service.ts
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { singleton, inject, injectable } from 'tsyringe'; // <<< THAY ĐỔI IMPORT

/**
 * Defines the paths to the content files related to a conference.
 */
// +++ UPDATE THIS TYPE DEFINITION (as mentioned in Step 1) +++
export type ContentPaths = {
    conferenceTextPath?: string | null;
    conferenceTextContent?: string | null; // ADD THIS
    cfpTextPath?: string | null;
    cfpTextContent?: string | null; // ADD THIS
    impTextPath?: string | null;
    impTextContent?: string | null; // ADD THIS
};

/**
 * Defines the aggregated text content of a conference.
 */
export type AggregatedContent = {
    /** The main content from the conference website. */
    mainText: string;
    /** The Call for Papers (CFP) content. */
    cfpText: string;
    /** The Important Dates (IMP) content. */
    impText: string;
};

/**
 * Interface for a service that aggregates conference data from various files.
 */
export interface IConferenceDataAggregatorService {
    /**
     * Reads content from specified files and aggregates them into a single object.
     * @param paths - An object containing paths to the content files.
     * @param logger - The logger instance for logging operations.
     * @returns A Promise that resolves to an `AggregatedContent` object.
     */
    readContentFiles(
        paths: ContentPaths,
        logger: Logger
    ): Promise<AggregatedContent>;

    /**
     * Aggregates various pieces of conference content into a single string
     * suitable for API consumption.
     * @param title - The title of the conference.
     * @param acronym - The acronym of the conference.
     * @param content - The aggregated content from `readContentFiles`.
     * @param logger - The logger instance for logging operations.
     * @returns A single aggregated string of conference content.
     */
    aggregateContentForApi(
        title: string,
        acronym: string,
        content: AggregatedContent,
        logger: Logger
    ): string;
}

/**
 * Service for aggregating conference data from various text files.
 * It reads content from main website, CFP, and important dates files,
 * and can format them into a single string for API processing.
 */
@injectable() // <<< THAY BẰNG DÒNG NÀY
export class ConferenceDataAggregatorService implements IConferenceDataAggregatorService {
    /**
     * Constructs an instance of ConferenceDataAggregatorService.
     * @param {FileSystemService} fileSystemService - The injected file system service for reading files.
     */
    constructor(
        @inject(FileSystemService) private fileSystemService: FileSystemService,
    ) { }

    /**
     * Reads content from specified files and aggregates them into an `AggregatedContent` object.
     * It requires `conferenceTextPath` to be present; `cfpTextPath` and `impTextPath` are optional.
     *
     * @param {ContentPaths} paths - An object containing paths to the content files.
     * @param {Logger} logger - The logger instance for logging operations.
     * @returns {Promise<AggregatedContent>} A Promise that resolves to an `AggregatedContent` object.
     * @throws {Error} If `conferenceTextPath` is missing or if reading `mainText` fails critically.
     */
    // +++ REWRITE THIS METHOD +++
    public async readContentFiles(
        paths: ContentPaths,
        logger: Logger
    ): Promise<AggregatedContent> {
        const logContext = { function: 'readContentFiles', service: 'ConferenceDataAggregatorService' };
        const content: AggregatedContent = { mainText: '', cfpText: '', impText: '' };

        // --- Main Text ---
        if (paths.conferenceTextContent) {
            content.mainText = paths.conferenceTextContent;
            logger.trace({ ...logContext, source: 'memory', contentType: 'main' }, "Read main content from memory.");
        } else if (paths.conferenceTextPath) {
            logger.trace({ ...logContext, source: 'file', contentType: 'main' }, "Reading main content from file (dev mode).");
            try {
                content.mainText = await this.fileSystemService.readFileContent(paths.conferenceTextPath, logger);
            } catch (error) {
                // Handle error as before, but now it's a dev-only issue
                logger.error({ ...logContext, err: error, filePath: paths.conferenceTextPath, contentType: 'main' }, "Critical: Failed to read main conference text file.");
                throw error;
            }
        } else {
            const errorMsg = "Missing both main text content and path. Cannot proceed.";
            logger.error({ ...logContext, contentType: 'main' }, errorMsg);
            throw new Error(errorMsg);
        }

        // --- CFP Text ---
        if (paths.cfpTextContent) {
            content.cfpText = paths.cfpTextContent;
            logger.trace({ ...logContext, source: 'memory', contentType: 'cfp' }, "Read CFP content from memory.");
        } else if (paths.cfpTextPath) {
            logger.trace({ ...logContext, source: 'file', contentType: 'cfp' }, "Reading CFP content from file (dev mode).");
            try {
                content.cfpText = await this.fileSystemService.readFileContent(paths.cfpTextPath, logger);
            } catch (error) {
                logger.warn({ ...logContext, err: error, filePath: paths.cfpTextPath, contentType: 'cfp' }, "Non-critical: Failed to read CFP text file.");
            }
        }

        // --- IMP Text ---
        if (paths.impTextContent) {
            content.impText = paths.impTextContent;
            logger.trace({ ...logContext, source: 'memory', contentType: 'imp' }, "Read IMP content from memory.");
        } else if (paths.impTextPath) {
            logger.trace({ ...logContext, source: 'file', contentType: 'imp' }, "Reading IMP content from file (dev mode).");
            try {
                content.impText = await this.fileSystemService.readFileContent(paths.impTextPath, logger);
            } catch (error) {
                logger.warn({ ...logContext, err: error, filePath: paths.impTextPath, contentType: 'imp' }, "Non-critical: Failed to read IMP text file.");
            }
        }

        logger.debug({ ...logContext, event: 'conference_data_aggregator_read_content_complete' }, "Conference content aggregated.");
        return content;
    }

    /**
     * Aggregates the various parts of conference content into a single string,
     * formatted for consumption by a Gemini API model.
     *
     * @param {string} title - The title of the conference.
     * @param {string} acronym - The acronym of the conference.
     * @param {AggregatedContent} content - The aggregated content (main, cfp, imp text).
     * @param {Logger} logger - The logger instance for logging operations.
     * @returns {string} The combined and formatted content string.
     */
    public aggregateContentForApi(
        title: string,
        acronym: string,
        content: AggregatedContent,
        logger: Logger
    ): string {
        const logContext = { function: 'aggregateContentForApi', service: 'ConferenceDataAggregatorService' };
        const impContent = content.impText ? ` \n\nImportant Dates information:\n${content.impText.trim()}` : "";
        const cfpContentAggregated = content.cfpText ? ` \n\nCall for Papers information:\n${content.cfpText.trim()}` : "";

        // Construct the aggregated string
        const aggregated = `Conference Title: ${title}\nConference Acronym: ${acronym}\n\nMain Website Content:\n\n${content.mainText.trim()}${cfpContentAggregated}${impContent}`;

        logger.info({
            ...logContext,
            charCount: aggregated.length,
            aggregatedItems: 1, // This seems to refer to the number of aggregated conference entries, always 1 per call
            event: 'save_batch_aggregate_content_end', // Original event name
            title: title, // Adding more context for easier debugging
            acronym: acronym,
            hasCfp: !!content.cfpText,
            hasImp: !!content.impText
        }, `Aggregated content for API. Total characters: ${aggregated.length}.`);

        return aggregated;
    }
}