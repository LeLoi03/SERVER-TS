// src/services/conferenceLogAnalysis/singleRequestAnalyzer.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fsSync from 'fs';
import { Logger } from 'pino';
import { ConfigService } from '../../../config/config.service';
import { LoggingService } from '../../logging.service';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import { ConferenceLogAnalysisResult, ReadLogResult, FilteredData } from '../../../types/logAnalysis';
import { getInitialLogAnalysisResult } from '../../../types/logAnalysis/initializers';
import {
    readAndGroupConferenceLogs,
    filterRequests,
    processLogEntry,
    calculateFinalMetrics
} from '../../../utils/logAnalysisConference/logProcessing.utils';

// Type SaveEventLogEntry['details'] được import từ nơi khác hoặc định nghĩa lại nếu cần
type SaveEventDetails = {
    batchRequestId: string;
    acronym: string;
    title: string;
    recordedStatus: 'SAVED_TO_DATABASE' | string;
    clientTimestamp: string;
};

@singleton()
export class SingleConferenceRequestAnalyzerService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'SingleConferenceRequestAnalyzerService' });
    }

    /**
     * Phân tích file log cho một request cụ thể.
     * Đây là logic được chuyển từ `analyzeLiveLogsForRequest` cũ.
     */
    async analyze(
        batchRequestId: string,
        requestLogFilePath: string,
        conferenceSaveEventsMap: Map<string, SaveEventDetails>,
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number
    ): Promise<ConferenceLogAnalysisResult> {
        const logContext = { function: 'analyze', batchRequestId, requestLogFilePath };
        const logger = this.serviceLogger.child(logContext);
        // logger.info('Performing live log analysis for a specific conference request.');

        const results: ConferenceLogAnalysisResult = getInitialLogAnalysisResult(requestLogFilePath);
        results.filterRequestId = batchRequestId;

        const filterStartMillis = filterStartTimeInput ? new Date(filterStartTimeInput).getTime() : null;
        const filterEndMillis = filterEndTimeInput ? new Date(filterEndTimeInput).getTime() : null;

        if (filterStartMillis !== null && filterEndMillis !== null && filterStartMillis > filterEndMillis) {
            results.status = 'Failed';
            results.errorMessage = 'Invalid filter time range: Start time is after end time.';
            logger.warn(results.errorMessage);
            return results;
        }

        try {
            if (!fsSync.existsSync(requestLogFilePath)) {
                results.status = 'Failed';
                results.errorMessage = `Conference log file for request ${batchRequestId} not found: ${requestLogFilePath}.`;
                logger.error(results.errorMessage);
                return results;
            }

            const readResult: ReadLogResult = await readAndGroupConferenceLogs(requestLogFilePath, batchRequestId);

            results.totalLogEntries = readResult.totalEntries;
            results.parsedLogEntries = readResult.parsedEntries;
            results.parseErrors = readResult.parseErrors;
            results.logProcessingErrors.push(...readResult.logProcessingErrors);

            const {
                filteredRequests,
                analysisStartMillis: actualAnalysisStartMillis,
                analysisEndMillis: actualAnalysisEndMillis
            }: FilteredData = filterRequests(
                readResult.requestsData,
                filterStartMillis,
                filterEndMillis,
                batchRequestId
            );

            results.analyzedRequestIds = Array.from(filteredRequests.keys());

            if (!filteredRequests.has(batchRequestId) || filteredRequests.size === 0) {
                logger.warn(`Data for requested ID ${batchRequestId} not found in its log file or did not match time filters.`);
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = `No conference log data found for request ID ${batchRequestId} in file ${requestLogFilePath} matching filters.`;
                return results;
            }

            const conferenceLastTimestamp: { [compositeKey: string]: number } = {};
            const requestInfo = filteredRequests.get(batchRequestId);
            if (requestInfo) {
                for (const logEntry of requestInfo.logs) {
                    processLogEntry(logEntry, results, conferenceLastTimestamp);
                }
            }

            Object.entries(results.conferenceAnalysis).forEach(([confKey, detail]) => {
                const savedEventDetails = conferenceSaveEventsMap.get(confKey);
                if (savedEventDetails) {
                    detail.persistedSaveStatus = savedEventDetails.recordedStatus;
                    detail.persistedSaveTimestamp = savedEventDetails.clientTimestamp;
                }
            });

            calculateFinalMetrics(results, conferenceLastTimestamp, actualAnalysisStartMillis, actualAnalysisEndMillis, filteredRequests);

            // logger.info(`Live conference analysis for ${batchRequestId} finished with status: ${results.status}`);
            return results;

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ err: { message: errorMessage, stack: errorStack } }, `Fatal error during live conference log analysis for ${batchRequestId}: "${errorMessage}".`);
            results.status = 'Failed';
            results.errorMessage = `Fatal error during live analysis for ${batchRequestId}: "${errorMessage}".`;
            results.logProcessingErrors.push(`FATAL LIVE ANALYSIS ERROR for ${batchRequestId}: "${errorMessage}". Stack: ${errorStack}.`);
            return results;
        }
    }
}