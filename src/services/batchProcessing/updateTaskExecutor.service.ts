// src/services/batchProcessing/updateTaskExecutor.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { Logger } from 'pino';

// --- Types ---
import { BatchUpdateEntry, BatchUpdateDataWithIds, ApiModels } from '../../types/crawl';
import { ContentPaths } from '../batchProcessing/conferenceDataAggregator.service';

// --- Service Imports ---
import { ConfigService } from '../../config/config.service';
import { FileSystemService } from '../fileSystem.service';
import { IConferenceDataAggregatorService } from '../batchProcessing/conferenceDataAggregator.service';
import { IFinalExtractionApiService } from './finalExtractionApi.service';
import { IFinalRecordAppenderService } from './finalRecordAppender.service';
import { addAcronymSafely } from '../../utils/crawl/addAcronymSafely';
import { RequestStateService } from '../requestState.service';


export interface IUpdateTaskExecutorService {
    execute(
        batchInput: BatchUpdateEntry,
        batchItemIndex: number,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        globalProcessedAcronymsSet: Set<string>,
        parentLogger: Logger,
        requestStateService: RequestStateService // <<< THÊM THAM SỐ MỚI
    ): Promise<boolean>;
}

@singleton()
export class UpdateTaskExecutorService implements IUpdateTaskExecutorService {
    private readonly batchesDir: string;
    private readonly errorLogPath: string;

    constructor(
        @inject(ConfigService) private readonly configService: ConfigService,
        @inject(FileSystemService) private readonly fileSystemService: FileSystemService,
        @inject('IConferenceDataAggregatorService') private readonly conferenceDataAggregatorService: IConferenceDataAggregatorService,
        @inject('IFinalExtractionApiService') private readonly finalExtractionApiService: IFinalExtractionApiService,
        @inject('IFinalRecordAppenderService') private readonly finalRecordAppenderService: IFinalRecordAppenderService,
    ) {
        this.batchesDir = this.configService.batchesDir;
        this.errorLogPath = path.join(this.configService.baseOutputDir, 'batch_processing_errors.log');
    }

    public async execute(
        batchInput: BatchUpdateEntry,
        batchItemIndex: number,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        globalProcessedAcronymsSet: Set<string>,
        parentLogger: Logger,
        requestStateService: RequestStateService // <<< NHẬN THAM SỐ MỚI

    ): Promise<boolean> {
        const originalAcronym = batchInput.conferenceAcronym;

        const logger = parentLogger.child({
            batchServiceFunction: '_executeBatchTaskForUpdate', // Giữ nguyên tên function trong log
        });
        logger.info({ event: 'batch_task_start_execution', flow: 'update' });

        try {

            // +++ SỬA LỖI: THÊM GUARD CLAUSE TẠI ĐÂY +++
            if (!apiModels.extractInfo || !apiModels.extractCfp) {
                logger.error({
                    event: 'batch_task_aborted_missing_models',
                    flow: 'update',
                    hasExtractInfoModel: !!apiModels.extractInfo,
                    hasCfpModel: !!apiModels.extractCfp,
                }, 'Cannot execute update task without required API models.');
                return false; // Dừng tác vụ một cách an toàn
            }
            // +++ KẾT THÚC SỬA LỖI +++


            const internalProcessingAcronym = await addAcronymSafely(globalProcessedAcronymsSet, originalAcronym);
            const safeInternalAcronymForFiles = internalProcessingAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
            logger.info({ internalProcessingAcronym, safeInternalAcronymForFiles, event: 'acronym_generated_for_update_files' });

            // +++ START OF MODIFICATION +++
            // The `batchInput` now contains `...Content` fields.
            // We need to pass them to the aggregator.
            const contentPaths: ContentPaths = {
                conferenceTextPath: batchInput.conferenceTextPath,
                conferenceTextContent: batchInput.conferenceTextContent, // USE THIS
                cfpTextPath: batchInput.cfpTextPath,
                cfpTextContent: batchInput.cfpTextContent,             // USE THIS
                impTextPath: batchInput.impTextPath,
                impTextContent: batchInput.impTextContent,             // USE THIS
            };

            // This call will now work correctly in production because it will find the `...Content` fields.
            const aggregatedFileContent = await this.conferenceDataAggregatorService.readContentFiles(contentPaths, logger);

            // This check ensures that even if something goes wrong, we don't send empty data to the API.
            if (!aggregatedFileContent.mainText) {
                logger.error({ event: 'aggregation_failed_no_main_text', flow: 'update' });
                return false;
            }

            const contentSendToAPI = this.conferenceDataAggregatorService.aggregateContentForApi(
                batchInput.conferenceTitle, originalAcronym, aggregatedFileContent, logger
            );
            // +++ END OF MODIFICATION +++

            // +++ MAKE DEBUG FILE WRITE CONDITIONAL +++
            if (!this.configService.isProduction) {
                const fileUpdateLogger = logger.child({ asyncOperation: 'write_intermediate_update_file' });
                const fileUpdateName = `${safeInternalAcronymForFiles}_update_item${batchItemIndex}.txt`;
                const fileUpdatePath = path.join(this.batchesDir, fileUpdateName);
                // We don't need to wait for this debug file to be written
                this.fileSystemService.writeFile(fileUpdatePath, contentSendToAPI, fileUpdateLogger)
                    .then(() => fileUpdateLogger.debug({ filePath: fileUpdatePath, event: 'batch_processing_write_intermediate_success' }))
                    .catch(writeError => fileUpdateLogger.error({ filePath: fileUpdatePath, err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_update_content' }));
            }


            // DELEGATE to FinalExtractionApiService
            const apiResults = await this.finalExtractionApiService.execute(
                contentSendToAPI, batchItemIndex, batchInput.conferenceTitle,
                originalAcronym,
                safeInternalAcronymForFiles,
                true,
                apiModels.extractInfo,
                apiModels.extractCfp,
                logger
            );

            // await fileUpdatePromise;
            logger.debug({ event: 'intermediate_update_file_write_settled' });

            // +++ UPDATE FINAL RECORD CREATION +++
            const finalRecord: BatchUpdateDataWithIds = {
                conferenceTitle: batchInput.conferenceTitle,
                conferenceAcronym: originalAcronym,
                mainLink: batchInput.mainLink,
                cfpLink: batchInput.cfpLink,
                impLink: batchInput.impLink,
                // Pass through the original paths/content for completeness in the final JSONL
                conferenceTextPath: batchInput.conferenceTextPath,
                conferenceTextContent: batchInput.conferenceTextContent,
                cfpTextPath: batchInput.cfpTextPath,
                cfpTextContent: batchInput.cfpTextContent,
                impTextPath: batchInput.impTextPath,
                impTextContent: batchInput.impTextContent,
                originalRequestId: batchInput.originalRequestId,
                internalProcessingAcronym: internalProcessingAcronym,
                batchRequestId: batchRequestIdForTask,
                // Add the new response content fields
                extractResponseTextPath: apiResults.extractResponseTextPath,
                extractResponseContent: apiResults.extractResponseContent, // ADD THIS
                extractMetaData: apiResults.extractMetaData,
                cfpResponseTextPath: apiResults.cfpResponseTextPath,
                cfpResponseContent: apiResults.cfpResponseContent,       // ADD THIS
                cfpMetaData: apiResults.cfpMetaData,
            };

             // DELEGATE to FinalRecordAppenderService
            await this.finalRecordAppenderService.append(
                finalRecord,
                batchRequestIdForTask,
                logger.child({ subOperation: 'append_final_update_record' }),
                requestStateService // <<< TRUYỀN THAM SỐ NHẬN ĐƯỢC
            );
            logger.info({ event: 'batch_task_finish_success', flow: 'update' });
            logger.info({ event: 'task_finish', success: true }, `Finished processing conference task for "${finalRecord.conferenceTitle}" (${finalRecord.conferenceAcronym}).`);

            return true;
        } catch (error: any) {
            logger.error({ err: error, event: 'batch_task_execution_failed', flow: 'update' });
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({
                err: error,
                event: 'task_finish',
                success: false,
                error_details: errorMessage
            }, `Finished processing conference task  with failure.`);

            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in _executeBatchTaskForUpdate for ${batchInput.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}, BatchRequestID: ${batchRequestIdForTask}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_update_task_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
            return false;
        }
    }
}