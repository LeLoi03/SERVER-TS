// src/utils/logAnalysis/helpers.ts

import fsSync from 'fs';
import readline from 'readline';
import {
    ReadLogResult,
    RequestLogData,
    FilteredData,
    LogEntry
} from '../../types/logAnalysis';

export const doesRequestOverlapFilter = (
    reqStartMillis: number | null,
    reqEndMillis: number | null,
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    batchRequestId: string
): boolean => {
    if (filterStartMillis === null && filterEndMillis === null) {
        return true;
    }
    if (reqStartMillis === null || reqEndMillis === null) {
        return false;
    }
    return (filterEndMillis === null || reqStartMillis <= filterEndMillis) &&
           (filterStartMillis === null || reqEndMillis >= filterStartMillis);
};

export const readAndGroupConferenceLogs = async (
    logFilePath: string,
    expectedBatchRequestId: string
): Promise<ReadLogResult> => {
    const requestsData = new Map<string, RequestLogData>();
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    if (!expectedBatchRequestId) {
        tempLogProcessingErrors.push("CRITICAL: readAndGroupConferenceLogs called without an expectedBatchRequestId.");
        return { requestsData, totalEntries, parsedEntries, parseErrors: parseErrorsCount, logProcessingErrors: tempLogProcessingErrors };
    }

    if (!fsSync.existsSync(logFilePath)) {
        tempLogProcessingErrors.push(`Log file not found at ${logFilePath} for request ${expectedBatchRequestId}`);
        return { requestsData, totalEntries: 0, parsedEntries: 0, parseErrors: 0, logProcessingErrors: tempLogProcessingErrors };
    }

    const fileStream = fsSync.createReadStream(logFilePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let requestInfo: RequestLogData = { logs: [], startTime: null, endTime: null };
    requestsData.set(expectedBatchRequestId, requestInfo);

    try {
        for await (const line of rl) {
            totalEntries++;
            if (!line.trim()) continue;

            try {
                const logEntry = JSON.parse(line) as LogEntry;
                parsedEntries++;
                const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;

                if (logEntry.batchRequestId && logEntry.batchRequestId !== expectedBatchRequestId) {
                    tempLogProcessingErrors.push(`Line ${totalEntries}: Mismatched batchRequestId. Expected '${expectedBatchRequestId}', found '${logEntry.batchRequestId}' in file ${logFilePath}.`);
                    continue;
                }

                if (logEntry.event === 'received_request' && logEntry.requestDescription) {
                    requestInfo.description = logEntry.requestDescription;
                }
                if (logEntry.event === 'processing_finished_successfully' && logEntry.context?.processedResults) {
                    for (const item of logEntry.context.processedResults) {
                        if (item.original_request_id) {
                            requestInfo.originalRequestId = item.original_request_id;
                            break;
                        }
                    }
                }

                if (!isNaN(entryTimeMillis)) {
                    requestInfo.logs.push(logEntry);
                    if (requestInfo.startTime === null || entryTimeMillis < requestInfo.startTime) {
                        requestInfo.startTime = entryTimeMillis;
                    }
                    if (requestInfo.endTime === null || entryTimeMillis > requestInfo.endTime) {
                        requestInfo.endTime = entryTimeMillis;
                    }
                } else {
                    tempLogProcessingErrors.push(`Line ${totalEntries}: Invalid or missing time field.`);
                }
            } catch (parseError: any) {
                parseErrorsCount++;
                tempLogProcessingErrors.push(`Line ${totalEntries} in ${logFilePath}: ${parseError.message}`);
            }
        }
    } catch (readError: any) {
        tempLogProcessingErrors.push(`Error reading file ${logFilePath}: ${readError.message}`);
    }

    if (requestInfo.logs.length === 0 && totalEntries > 0) {
        tempLogProcessingErrors.push(`No valid log entries processed for request ${expectedBatchRequestId} in file ${logFilePath}, though ${totalEntries} lines were read.`);
    }

    return { requestsData, totalEntries, parsedEntries, parseErrors: parseErrorsCount, logProcessingErrors: tempLogProcessingErrors };
};

export const filterRequests = (
    allRequestsData: Map<string, RequestLogData>,
    filterStartMillisFromUser: number | null,
    filterEndMillisFromUser: number | null,
    textFilter?: string
): FilteredData => {
    const filteredRequestsOutput = new Map<string, RequestLogData>();
    let minActualRequestStartTime: number | null = null;
    let maxActualRequestEndTime: number | null = null;

    for (const [batchRequestId, requestInfo] of allRequestsData.entries()) {
        const isTimeMatch = doesRequestOverlapFilter(
            requestInfo.startTime,
            requestInfo.endTime,
            filterStartMillisFromUser,
            filterEndMillisFromUser,
            batchRequestId
        );

        if (!isTimeMatch) continue;

        let isTextMatch: boolean = true; // Khởi tạo là true
        if (textFilter && textFilter.trim()) {
            const lowerCaseFilter = textFilter.trim().toLowerCase();
            // SỬA LỖI Ở ĐÂY: Sử dụng !! để ép kiểu về boolean
            isTextMatch = (
                batchRequestId.toLowerCase().includes(lowerCaseFilter) ||
                !!(requestInfo.originalRequestId && requestInfo.originalRequestId.toLowerCase().includes(lowerCaseFilter)) ||
                !!(requestInfo.description && requestInfo.description.toLowerCase().includes(lowerCaseFilter))
            );
        }

        if (!isTextMatch) continue;

        filteredRequestsOutput.set(batchRequestId, requestInfo);

        if (requestInfo.startTime !== null) {
            minActualRequestStartTime = Math.min(requestInfo.startTime, minActualRequestStartTime ?? Infinity);
        }
        if (requestInfo.endTime !== null) {
            maxActualRequestEndTime = Math.max(requestInfo.endTime, maxActualRequestEndTime ?? -Infinity);
        }
    }

    let finalAnalysisStartMillis: number | null = filterStartMillisFromUser;
    let finalAnalysisEndMillis: number | null = filterEndMillisFromUser;

    if (filterStartMillisFromUser === null && filterEndMillisFromUser === null) {
        finalAnalysisStartMillis = minActualRequestStartTime;
        finalAnalysisEndMillis = maxActualRequestEndTime;
    }

    return {
        filteredRequests: filteredRequestsOutput,
        analysisStartMillis: finalAnalysisStartMillis,
        analysisEndMillis: finalAnalysisEndMillis
    };
};