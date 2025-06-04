// // src/services/logAnalysis.service.ts
// import 'reflect-metadata';
// import { singleton, inject } from 'tsyringe';
// import fs from 'fs';
// import readline from 'readline'; // Thêm readline
// import { ConferenceLogAnalysisResult, ReadLogResult, FilteredData } from '../types/logAnalysis';
// import { ConfigService } from '../config/config.service';
// import { LoggingService } from './logging.service';
// import { getErrorMessageAndStack } from '../utils/errorUtils';

// import {
//     initializeConferenceLogAnalysisResult,
//     readAndGroupConferenceLogs, // Sẽ giữ nguyên cho log chính
//     filterRequests,
//     processLogEntry,
//     calculateFinalMetrics
// } from '../utils/logAnalysisConference/logProcessing.utils';
// import { createConferenceKey } from '../utils/logAnalysisConference/helpers'; // Import helper

// // Interface cho một entry trong conference_save_events.jsonl
// interface SaveEventLogEntry {
//     time: string; // Server timestamp
//     level: number;
//     // Các trường pino khác như pid, hostname có thể có nếu không loại bỏ ở base
//     event?: 'CONFERENCE_SAVE_EVENT_RECORDED' | string; // Thêm ? vì có thể có log entry khác trong file
//     details?: { // Thêm ? vì có thể có log entry khác trong file
//         batchRequestId: string;
//         acronym: string;
//         title: string;
//         recordedStatus: 'SAVED_TO_DATABASE' | string;
//         clientTimestamp: string;
//     };
// }

// @singleton()
// export class LogAnalysisService {
//     private latestConferenceResult: ConferenceLogAnalysisResult | null = null; // Renamed
//     private readonly conferenceLogFilePath: string; // Đổi tên
//     private readonly saveConferenceEventsLogFilePath: string;


//     constructor(
//         @inject(ConfigService) private configService: ConfigService,
//         @inject(LoggingService) private loggingService: LoggingService
//     ) {
//         // Lấy logger loại 'conference'
//         // this.serviceLogger = this.loggingService.getLogger('conference', { service: 'LogAnalysisService' });

//         this.conferenceLogFilePath = this.configService.conferenceLogFilePath;
//         this.saveConferenceEventsLogFilePath = this.configService.getSaveConferenceEventLogFilePath();

//         // this.serviceLogger.info({
//         //     event: 'conference_log_analysis_init_success',
//         //     conferenceLogFilePath: this.conferenceLogFilePath,
//         //     saveConferenceEventsLogFilePath: this.saveConferenceEventsLogFilePath
//         // }, `Conference LogAnalysisService initialized. Conference log: ${this.conferenceLogFilePath}, Save Events log: ${this.saveConferenceEventsLogFilePath}.`);

//         if (!fs.existsSync(this.conferenceLogFilePath)) {
//             // this.serviceLogger.warn({ event: 'main_conference_log_file_not_found_on_init', logFilePath: this.conferenceLogFilePath }, `Main conference log file not found: ${this.conferenceLogFilePath}.`);
//         }
//         if (!fs.existsSync(this.saveConferenceEventsLogFilePath)) {
//             // this.serviceLogger.warn({ event: 'save_events_log_file_not_found_on_init', logFilePath: this.saveConferenceEventsLogFilePath }, `Save events log file not found. Persisted save statuses might be missing.`);
//         }
//     }

//     /**
//      * Reads conference save event logs and maps them by a composite key.
//      * @returns {Promise<Map<string, SaveEventLogEntry['details']>>} A map of save event details.
//      */
//     private async readConferenceSaveEvents(): Promise<Map<string, NonNullable<SaveEventLogEntry['details']>>> {
//         const saveEventsMap = new Map<string, NonNullable<SaveEventLogEntry['details']>>();
//         const logContext = { function: 'readConferenceSaveEvents', logFilePath: this.saveConferenceEventsLogFilePath };

//         if (!fs.existsSync(this.saveConferenceEventsLogFilePath)) {
//             // this.serviceLogger.warn({ ...logContext, event: 'save_event_log_not_found' }, 'Save event log file not found. No persisted save statuses will be loaded.');
//             return saveEventsMap;
//         }

//         // this.serviceLogger.info({ ...logContext, event: 'read_save_events_start' }, 'Starting to read conference save events log.');
//         let lineCount = 0;
//         let parsedCount = 0;

//         const fileStream = fs.createReadStream(this.saveConferenceEventsLogFilePath);
//         const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

//         try {
//             for await (const line of rl) {
//                 lineCount++;
//                 if (!line.trim()) continue;
//                 try {
//                     const logEntry = JSON.parse(line) as SaveEventLogEntry;
//                     // Kiểm tra kỹ hơn cấu trúc của log entry
//                     if (logEntry.event === 'CONFERENCE_SAVE_EVENT_RECORDED' && logEntry.details &&
//                         logEntry.details.batchRequestId && logEntry.details.acronym && logEntry.details.title) {

//                         const { batchRequestId, acronym, title } = logEntry.details;
//                         const key = createConferenceKey(batchRequestId, acronym, title);
//                         if (key) {
//                             // Ghi đè với entry mới nhất nếu có trùng key (dựa vào thứ tự đọc file)
//                             saveEventsMap.set(key, logEntry.details);
//                             parsedCount++;
//                         }
//                     }
//                 } catch (parseError) {
//                     // this.serviceLogger.warn({ ...logContext, event: 'parse_save_event_line_error', lineNumber: lineCount, error: getErrorMessageAndStack(parseError).message }, `Failed to parse line from save event log.`);
//                 }
//             }
//             // this.serviceLogger.info({ ...logContext, event: 'read_save_events_finish', totalLines: lineCount, parsedEvents: parsedCount }, `Finished reading save events log. Parsed ${parsedCount} save events.`);
//         } catch (readError) {
//             const { message, stack } = getErrorMessageAndStack(readError);
//             // this.serviceLogger.error({ ...logContext, event: 'read_save_events_file_error', err: { message, stack } }, `Error reading save events log file: ${message}`);
//         }
//         return saveEventsMap;
//     }


//     async performConferenceAnalysisAndUpdate(
//         filterStartTime?: Date | number,
//         filterEndTime?: Date | number,
//         filterRequestId?: string
//     ): Promise<ConferenceLogAnalysisResult> {
//         // const logContext = { function: 'performConferenceAnalysisAndUpdate', mainLogFilePath: this.conferenceLogFilePath, filterRequestId, filterStartTime, filterEndTime };
//         // this.serviceLogger.info({ ...logContext, event: 'analysis_start' }, 'Starting log analysis execution.');


//         // Initialize a new result object for the current analysis run
//         const results: ConferenceLogAnalysisResult = initializeConferenceLogAnalysisResult(this.conferenceLogFilePath, filterRequestId);

//         // Convert filter times to milliseconds for consistent comparison
//         const filterStartMillis = filterStartTime ? new Date(filterStartTime).getTime() : null;
//         const filterEndMillis = filterEndTime ? new Date(filterEndTime).getTime() : null;

//         // Basic validation for time range
//         if (filterStartMillis !== null && filterEndMillis !== null && filterStartMillis > filterEndMillis) {
//             // this.serviceLogger.warn({ ...logContext, event: 'analysis_warning_invalid_filter_range' }, `Filter start time (${filterStartTime}) is after filter end time (${filterEndTime}). This range will result in no data.`);
//             // Set error status and message directly and return early
//             results.status = 'Failed';
//             results.errorMessage = 'Invalid filter time range: Start time is after end time.';
//             results.logProcessingErrors.push(results.errorMessage);
//             this.latestConferenceResult = results;
//             return results;
//         }

//         try {
//             // Phase 0a: Pre-check main log file
//             if (!fs.existsSync(this.conferenceLogFilePath)) {
//                 const errorMsg = `Conference log file not found: ${this.conferenceLogFilePath}.`;
//                 // this.serviceLogger.error({ ...logContext, event: 'analysis_error_file_not_found' }, errorMsg);
//                 results.status = 'Failed';
//                 results.errorMessage = errorMsg;
//                 results.logProcessingErrors.push(errorMsg);
//                 this.latestConferenceResult = results;
//                 return results;
//             }

//             // Phase 0b: Read Conference Save Events (Đọc trước để có thể merge)
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_read_save_events_start' }, 'Phase 0b: Starting to read conference save events.');
//             const conferenceSaveEventsMap = await this.readConferenceSaveEvents();
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_read_save_events_finish', count: conferenceSaveEventsMap.size }, `Phase 0b: Finished reading ${conferenceSaveEventsMap.size} conference save events.`);


//             // Phase 1: Read and Group Main Logs
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_read_main_log_start' }, 'Phase 1: Starting to read and group main logs.');
//             const readResult: ReadLogResult = await readAndGroupConferenceLogs(this.conferenceLogFilePath);
//             results.totalLogEntries = readResult.totalEntries;
//             results.parsedLogEntries = readResult.parsedEntries;
//             results.parseErrors = readResult.parseErrors;
//             results.logProcessingErrors.push(...readResult.logProcessingErrors);
//             // this.serviceLogger.info({
//             //     // ...logContext,
//             //     event: 'analysis_read_finish',
//             //     totalEntries: readResult.totalEntries,
//             //     parsedEntries: readResult.parsedEntries,
//             //     parseErrorsCount: readResult.parseErrors,
//             //     requestsFound: readResult.requestsData.size
//             // }, 'Phase 1: Finished reading and grouping logs.');

//             if (readResult.requestsData.size === 0 && readResult.totalEntries > 0) {
//                 // this.serviceLogger.warn({ ...logContext, event: 'analysis_warning_no_requests_found' }, 'Log file parsed, but no log entries with associated request IDs were found for analysis.');
//             }

//             // Phase 2a: Filter Requests
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_filter_start' }, 'Phase 2a: Starting to filter requests based on provided criteria.');
//             const {
//                 filteredRequests,
//                 analysisStartMillis, // Actual start time of logs included in analysis
//                 analysisEndMillis    // Actual end time of logs included in analysis
//             }: FilteredData = filterRequests(
//                 readResult.requestsData,
//                 filterStartMillis,
//                 filterEndMillis,
//                 filterRequestId
//             );
//             results.analyzedRequestIds = Array.from(filteredRequests.keys());
//             // this.serviceLogger.info({
//             //     // ...logContext,
//             //     event: 'analysis_filter_finish',
//             //     includedRequestsCount: filteredRequests.size,
//             //     actualAnalysisRangeStart: analysisStartMillis ? new Date(analysisStartMillis).toISOString() : 'N/A',
//             //     actualAnalysisRangeEnd: analysisEndMillis ? new Date(analysisEndMillis).toISOString() : 'N/A'
//             // }, `Phase 2a: Finished filtering requests. Included ${filteredRequests.size} requests.`);

//             if (filterRequestId && filteredRequests.size === 0) {
//                 // this.serviceLogger.warn({ ...logContext, event: 'analysis_target_request_id_not_found' }, `Requested requestId '${filterRequestId}' not found in logs or did not match time filters. No specific data to analyze for this ID.`);
//                 // We don't set this as a 'Failed' status unless it's critical,
//                 // as it might just mean the ID wasn't in the logs for that period.
//                 // The `analyzedRequestIds` will reflect that no requests were analyzed.
//             }

//             // Phase 2b: Process Log Entries for Included Requests
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_processing_start', requestCount: filteredRequests.size }, 'Phase 2b: Starting to process log entries for included requests.');
//             const conferenceLastTimestamp: { [compositeKey: string]: number } = {};
//             for (const [requestId, requestInfo] of filteredRequests.entries()) {
//                 for (const logEntry of requestInfo.logs) {
//                     // processLogEntry sẽ tạo ConferenceAnalysisDetail nếu chưa có
//                     processLogEntry(logEntry, results, conferenceLastTimestamp);
//                 }
//             }
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_processing_end' }, 'Phase 2b: Finished processing log entries.');

//             // Phase 2c: Merge Persisted Save Statuses
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_merge_save_status_start', count: conferenceSaveEventsMap.size }, 'Phase 2c: Starting to merge persisted save statuses.');
//             Object.entries(results.conferenceAnalysis).forEach(([confKey, detail]) => {
//                 const savedEventDetails = conferenceSaveEventsMap.get(confKey);
//                 if (savedEventDetails) {
//                     detail.persistedSaveStatus = savedEventDetails.recordedStatus;
//                     detail.persistedSaveTimestamp = savedEventDetails.clientTimestamp;
//                     // Log nếu tìm thấy và merge
//                     // this.serviceLogger.debug({ ...logContext, event: 'merged_save_status', confKey }, `Merged persisted save status for ${confKey}`);
//                 }
//             });
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_merge_save_status_finish' }, 'Phase 2c: Finished merging persisted save statuses.');


//             // Phase 3: Calculate Final Metrics
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_calculate_metrics_start' }, 'Phase 3: Starting to calculate final metrics.');
//             calculateFinalMetrics(results, conferenceLastTimestamp, analysisStartMillis, analysisEndMillis, filteredRequests);
//             results.status = 'Completed'; // Đặt status completed sau khi calculateFinalMetrics thành công
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_calculate_metrics_finish' }, 'Phase 3: Finished calculating final metrics. Analysis completed successfully.');

//             // Store the latest successful result
//             this.latestConferenceResult = results;
//             // this.serviceLogger.info({ ...logContext, event: 'analysis_completed_success', processedConferences: results.overall.processedConferencesCount, errorLogs: results.errorLogCount }, `Analysis completed successfully. Processed ${results.overall.processedConferencesCount} conferences, found ${results.errorLogCount} error logs.`);
//             return results;

//         } catch (error: unknown) { // Catch any unhandled errors during the analysis process
//             const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
//             // this.serviceLogger.error({ ...logContext, err: { message: errorMessage, stack: errorStack }, event: 'analysis_error_fatal' }, `Fatal error occurred during log analysis execution: "${errorMessage}".`);
//             results.status = 'Failed';
//             results.errorMessage = `Fatal error during analysis: "${errorMessage}".`;
//             results.logProcessingErrors.push(`FATAL ANALYSIS ERROR: "${errorMessage}". Stack: ${errorStack}.`);
//             this.latestConferenceResult = results;
//             return results;
//         }
//     }


//     /**
//      * Retrieves the result of the most recently performed log analysis.
//      * @returns {ConferenceLogAnalysisResult | null} The latest analysis result, or null if no analysis has been performed yet.
//      */
//     getLatestConferenceAnalysisResult(): ConferenceLogAnalysisResult | null { // Renamed
//         // this.serviceLogger.debug({ event: 'get_latest_analysis_result' }, 'Retrieving latest analysis result.');
//         return this.latestConferenceResult;
//         ;
//     }
// }