// src/services/batchProcessingServiceChild/conferenceDataAggregator.service.ts
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { singleton, inject } from 'tsyringe';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility

/**
 * Defines the paths to the content files related to a conference.
 */
export type ContentPaths = {
    /** Path to the main conference website content file. */
    conferenceTextPath?: string | null;
    /** Path to the Call for Papers (CFP) content file. */
    cfpTextPath?: string | null;
    /** Path to the Important Dates (IMP) content file. */
    impTextPath?: string | null;
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
@singleton()
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
    public async readContentFiles(
        paths: ContentPaths,
        logger: Logger
    ): Promise<AggregatedContent> {
        const logContext = { function: 'readContentFiles', service: 'ConferenceDataAggregatorService' };
        const content: AggregatedContent = { mainText: '', cfpText: '', impText: '' };
        const readPromises: Promise<void>[] = [];

        // Main text file is mandatory
        if (paths.conferenceTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(paths.conferenceTextPath, logger)
                    .then(text => { content.mainText = text; })
                    .catch(error => { // Catch error from readFileContent
                        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                        // Log event name from original, with improved context
                        logger.error({
                            ...logContext,
                            err: { message: errorMessage, stack: errorStack },
                            filePath: paths.conferenceTextPath,
                            contentType: 'main',
                            event: 'save_batch_read_content_failed', // Original event name
                            isCritical: true
                        }, `Critical: Failed to read main conference text file: "${errorMessage}".`);
                        throw error; // Re-throw critical error
                    })
            );
        } else {
            const errorMsg = "Missing main text path for content aggregation. Cannot proceed.";
            // Log event name from original, with improved context
            logger.error({
                ...logContext,
                contentType: 'main',
                event: 'save_batch_read_content_failed_missing_path', // Original event name
                isCritical: true
            }, errorMsg);
            throw new Error(errorMsg);
        }

        // CFP text file is optional
        if (paths.cfpTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(paths.cfpTextPath, logger)
                    .then(text => { content.cfpText = text; })
                    .catch(error => { // Catch error from readFileContent
                        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                        // Log event name from original, with improved context
                        logger.warn({
                            ...logContext,
                            err: { message: errorMessage, stack: errorStack },
                            filePath: paths.cfpTextPath,
                            contentType: 'cfp',
                            event: 'save_batch_read_content_warn_non_critical', // Original event name
                            isCritical: false
                        }, `Non-critical: Failed to read CFP text file: "${errorMessage}".`);
                        // Do not re-throw, continue processing with empty CFP content
                    })
            );
        } else {
            logger.debug({ ...logContext, contentType: 'cfp', event: 'conference_data_aggregator_cfp_path_missing' }, "CFP text path not provided. CFP content will be empty.");
        }

        // Important Dates text file is optional
        if (paths.impTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(paths.impTextPath, logger)
                    .then(text => { content.impText = text; })
                    .catch(error => { // Catch error from readFileContent
                        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                        // Log event name from original, with improved context
                        logger.warn({
                            ...logContext,
                            err: { message: errorMessage, stack: errorStack },
                            filePath: paths.impTextPath,
                            contentType: 'imp',
                            event: 'save_batch_read_content_warn_non_critical', // Original event name
                            isCritical: false
                        }, `Non-critical: Failed to read Important Dates text file: "${errorMessage}".`);
                        // Do not re-throw, continue processing with empty Important Dates content
                    })
            );
        } else {
            logger.debug({ ...logContext, contentType: 'imp', event: 'conference_data_aggregator_imp_path_missing' }, "Important Dates text path not provided. Important Dates content will be empty.");
        }

        await Promise.all(readPromises); // Wait for all file reading operations to complete
        logger.debug({
            ...logContext,
            event: 'conference_data_aggregator_read_content_complete', // Original event name
            hasMain: !!content.mainText,
            hasCfp: !!content.cfpText,
            hasImp: !!content.impText,
            mainTextLength: content.mainText.length
        }, "Conference content files read and aggregated.");

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