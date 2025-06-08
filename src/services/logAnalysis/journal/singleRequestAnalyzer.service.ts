// src/services/logAnalysis/journal/singleRequestAnalyzer.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fsSync from 'fs';
import { Logger } from 'pino';
import { LoggingService } from '../../logging.service';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import { JournalLogAnalysisResult } from '../../../types/logAnalysisJournal/logAnalysisJournal.types';
import { ReadLogResult } from '../../../types/logAnalysis';
import {
    initializeJournalLogAnalysisResult,
    readAndGroupJournalLogs,
    filterJournalRequests,
    processJournalLogEntry,
    calculateJournalFinalMetrics
} from '../../../utils/logAnalysisJournal/logProcessingJournal.utils';

@singleton()
export class SingleJournalRequestAnalyzerService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'SingleJournalRequestAnalyzerService' });
    }

    /**
     * Phân tích file log cho một request journal cụ thể.
     * Đây là logic được chuyển từ `analyzeJournalLiveLogsForRequest` cũ.
     */
    async analyze(
        batchRequestId: string,
        requestLogFilePath: string,
        filterStartTimeInput?: number,
        filterEndTimeInput?: number
    ): Promise<JournalLogAnalysisResult> {
        const logContext = { function: 'analyze', batchRequestId, requestLogFilePath };
        const logger = this.serviceLogger.child(logContext);
        logger.info('Performing live journal log analysis for a specific request.');

        const results = initializeJournalLogAnalysisResult(requestLogFilePath, batchRequestId);
        const filterStartMillis = filterStartTimeInput || null;
        const filterEndMillis = filterEndTimeInput || null;

        if (filterStartMillis !== null && filterEndMillis !== null && filterStartMillis > filterEndMillis) {
            results.status = 'Failed';
            results.errorMessage = 'Invalid filter time range: Start time is after end time.';
            logger.warn(results.errorMessage);
            return results;
        }

        try {
            if (!fsSync.existsSync(requestLogFilePath)) {
                results.status = 'Failed';
                results.errorMessage = `Journal log file for request ${batchRequestId} not found: ${requestLogFilePath}.`;
                logger.error(results.errorMessage);
                return results;
            }

            const { requestsData, totalEntries, parsedEntries, parseErrors, logProcessingErrors: readLogErrors }: ReadLogResult =
                await readAndGroupJournalLogs(requestLogFilePath, batchRequestId);

            results.totalLogEntries = totalEntries;
            results.parsedLogEntries = parsedEntries;
            results.parseErrors = parseErrors;
            results.logProcessingErrors.push(...readLogErrors);

            if (requestsData.size === 0 && parsedEntries > 0) {
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = `No journal request data found for ${batchRequestId} in its log file, though entries were parsed.`;
                logger.warn(results.errorMessage); return results;
            }
            if (requestsData.size === 0 && parsedEntries === 0 && totalEntries > 0) {
                results.status = 'Failed';
                results.errorMessage = `Log file for ${batchRequestId} found but could not parse any valid JSON entries.`;
                logger.error(results.errorMessage); return results;
            }
            if (totalEntries === 0) {
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = `Log file for ${batchRequestId} is empty.`;
                logger.warn(results.errorMessage); return results;
            }

            const {
                filteredRequests,
                analysisStartMillis: actualAnalysisStartMillis,
                analysisEndMillis: actualAnalysisEndMillis
            } = filterJournalRequests(
                requestsData,
                filterStartMillis,
                filterEndMillis,
                batchRequestId
            );

            results.analyzedRequestIds = Array.from(filteredRequests.keys());

            if (!filteredRequests.has(batchRequestId) || filteredRequests.size === 0) {
                logger.warn(`Live journal analysis: Data for requested ID ${batchRequestId} not found in its log file or did not match time filters.`);
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = `No journal log data found for request ID ${batchRequestId} in file ${requestLogFilePath} matching filters.`;
                return results;
            }

            const journalLastTimestamp: { [compositeKey: string]: number } = {};
            const requestLogData = filteredRequests.get(batchRequestId);

            if (requestLogData) {
                results.requests[batchRequestId] = {
                    batchRequestId,
                    startTime: requestLogData.startTime ? new Date(requestLogData.startTime).toISOString() : null,
                    endTime: requestLogData.endTime ? new Date(requestLogData.endTime).toISOString() : null,
                    durationSeconds: (requestLogData.startTime && requestLogData.endTime) ? Math.round((requestLogData.endTime - requestLogData.startTime) / 1000) : null,
                    status: 'Processing',
                    dataSource: requestLogData.dataSource,
                    errorMessages: [],
                };

                for (const logEntry of requestLogData.logs) {
                    processJournalLogEntry(logEntry, results, journalLastTimestamp);
                }
            }

            calculateJournalFinalMetrics(results, journalLastTimestamp, actualAnalysisStartMillis, actualAnalysisEndMillis, filteredRequests);

            logger.info(`Live journal analysis for ${batchRequestId} finished with status: ${results.status}`);
            return results;

        } catch (error: any) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ err: { message: errorMessage, stack: errorStack } }, `Fatal error during live journal analysis for ${batchRequestId}: "${errorMessage}".`);
            results.status = 'Failed';
            results.errorMessage = results.errorMessage || `Fatal error during live journal analysis for ${batchRequestId}: "${errorMessage}".`;
            results.logProcessingErrors.push(`FATAL LIVE JOURNAL ANALYSIS ERROR for ${batchRequestId}: "${errorMessage}". Stack: ${errorStack}.`);
            return results;
        }
    }
}