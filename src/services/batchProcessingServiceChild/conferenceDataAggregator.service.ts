// src/services/batchProcessingServiceChild/conferenceDataAggregator.service.ts
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { singleton, inject } from 'tsyringe';

export type ContentPaths = {
    conferenceTextPath?: string | null;
    cfpTextPath?: string | null;
    impTextPath?: string | null;
};

export type AggregatedContent = {
    mainText: string;
    cfpText: string;
    impText: string;
};

export interface IConferenceDataAggregatorService {
    readContentFiles(
        paths: ContentPaths,
        logger: Logger
    ): Promise<AggregatedContent>;

    aggregateContentForApi(
        title: string,
        acronym: string,
        content: AggregatedContent,
        logger: Logger
    ): string;
}

@singleton()
export class ConferenceDataAggregatorService implements IConferenceDataAggregatorService {
    constructor(
        @inject(FileSystemService) private fileSystemService: FileSystemService,
    ) {}

      public async readContentFiles(
        paths: ContentPaths,
        logger: Logger
    ): Promise<AggregatedContent> {
        const logContext = { function: 'readContentFiles', service: 'ConferenceDataAggregatorService' };
        const content: AggregatedContent = { mainText: '', cfpText: '', impText: '' };
        const readPromises: Promise<void>[] = [];

        if (paths.conferenceTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(paths.conferenceTextPath, logger)
                    .then(text => { content.mainText = text; })
                    .catch(e => {
                        // SỬA EVENT NAME và thêm context
                        logger.error({ ...logContext, err: e, filePath: paths.conferenceTextPath, contentType: 'main', event: 'save_batch_read_content_failed', isCritical: true });
                        throw e;
                    })
            );
        } else {
            // SỬA EVENT NAME và thêm context
            logger.error({ ...logContext, contentType: 'main', event: 'save_batch_read_content_failed_missing_path', isCritical: true });
            throw new Error("Missing main text path for content aggregation.");
        }

        if (paths.cfpTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(paths.cfpTextPath, logger)
                    .then(text => { content.cfpText = text; })
                    // SỬA EVENT NAME và thêm context
                    .catch(e => logger.warn({ ...logContext, err: e, filePath: paths.cfpTextPath, contentType: 'cfp', event: 'save_batch_read_content_warn_non_critical', isCritical: false }))
            );
        }

        if (paths.impTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(paths.impTextPath, logger)
                    .then(text => { content.impText = text; })
                    // SỬA EVENT NAME và thêm context
                    .catch(e => logger.warn({ ...logContext, err: e, filePath: paths.impTextPath, contentType: 'imp', event: 'save_batch_read_content_warn_non_critical', isCritical: false }))
            );
        }
        await Promise.all(readPromises);
        logger.debug({ ...logContext, event: 'conference_data_aggregator_read_content_complete', hasCfp: !!content.cfpText, hasImp: !!content.impText });
        return content;
    }

    public aggregateContentForApi(
        title: string,
        acronym: string,
        content: AggregatedContent,
        logger: Logger
    ): string {
        const logContext = { function: 'aggregateContentForApi', service: 'ConferenceDataAggregatorService' };
        const impContent = content.impText ? ` \n\nImportant Dates information:\n${content.impText.trim()}` : "";
        const cfpContentAggregated = content.cfpText ? ` \n\nCall for Papers information:\n${content.cfpText.trim()}` : "";
        const aggregated = `Conference Title: ${title}\nConference Acronym: ${acronym}\n\nMain Website Content:\n${content.mainText.trim()}${cfpContentAggregated}${impContent}`;
        logger.info({ ...logContext, charCount: aggregated.length, aggregatedItems: 1, event: 'save_batch_aggregate_content_end' });
        return aggregated;
    }
}