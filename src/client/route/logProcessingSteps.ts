import fs from 'fs';
import readline from 'readline';
import { logger } from '../../conference/11_utils'; // Adjust path if needed
import { LogAnalysisResult, ConferenceAnalysisDetail } from '../types/logAnalysis'; // Adjust path if needed
import {
    normalizeErrorKey,
    createConferenceKey,
    initializeConferenceDetail,
    addConferenceError,
    doesRequestOverlapFilter
} from './analysisHelpers'; // Adjust path if needed

export interface RequestLogData {
    logs: any[];
    startTime: number | null;
    endTime: number | null;
}

export interface ReadLogResult {
    requestsData: Map<string, RequestLogData>;
    totalEntries: number;
    parsedEntries: number;
    parseErrors: number;
    logProcessingErrors: string[];
}

export interface FilteredData {
    filteredRequests: Map<string, RequestLogData>;
    analysisStartMillis: number | null;
    analysisEndMillis: number | null;
}


// --- Step 1: Read Log File and Group by Request ID ---
export const readAndGroupLogs = async (logFilePath: string): Promise<ReadLogResult> => {
    const logContext = { filePath: logFilePath, function: 'readAndGroupLogs' };
    logger.info({ ...logContext, event: 'read_group_start' }, 'Starting Phase 1: Reading and Grouping logs by requestId');

    const requestsData = new Map<string, RequestLogData>();
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    if (!fs.existsSync(logFilePath)) {
        logger.error({ ...logContext, event: 'read_group_error_file_not_found' }, 'Log file not found.');
        throw new Error(`Log file not found at ${logFilePath}`);
    }

    const fileStream = fs.createReadStream(logFilePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    try {
        for await (const line of rl) {
            totalEntries++;
            if (!line.trim()) continue;

            try {
                const logEntry = JSON.parse(line);
                parsedEntries++;
                const entryTimeMillis = new Date(logEntry.time).getTime();
                const requestId = logEntry.requestId;

                if (requestId && typeof requestId === 'string' && !isNaN(entryTimeMillis)) {
                    if (!requestsData.has(requestId)) {
                        requestsData.set(requestId, { logs: [], startTime: null, endTime: null });
                    }
                    const requestInfo = requestsData.get(requestId)!;
                    requestInfo.logs.push(logEntry);
                    // Update start/end times for the request
                    requestInfo.startTime = Math.min(entryTimeMillis, requestInfo.startTime ?? entryTimeMillis);
                    requestInfo.endTime = Math.max(entryTimeMillis, requestInfo.endTime ?? entryTimeMillis);
                } else {
                    logger.trace({ event: 'read_group_skip_entry', lineNum: totalEntries, hasRequestId: !!requestId, hasValidTime: !isNaN(entryTimeMillis) }, "Skipping log entry (missing requestId or invalid time)");
                }

            } catch (parseError: any) {
                parseErrorsCount++;
                const errorMsg = `Line ${totalEntries}: ${parseError.message}`;
                tempLogProcessingErrors.push(errorMsg);
                logger.warn({ event: 'read_group_parse_error', lineNum: totalEntries, err: parseError, originalLine: line.substring(0, 200) }, "Error parsing log line during phase 1");
            }
        }
    } catch (readError) {
        logger.error({ ...logContext, event: 'read_group_stream_error', err: readError }, 'Error reading log file stream');
        // Re-throw or handle as needed, maybe return partial results?
        throw readError; // Re-throw for now
    } finally {
        // Ensure stream is closed, though readline usually handles this
        fileStream.close();
    }


    logger.info({ ...logContext, event: 'read_group_end', totalEntries, parsedEntries, requestIdsFound: requestsData.size, parseErrors: parseErrorsCount }, 'Finished Phase 1');

    return {
        requestsData,
        totalEntries,
        parsedEntries,
        parseErrors: parseErrorsCount,
        logProcessingErrors: tempLogProcessingErrors,
    };
};

// --- Step 2: Filter Requests by Time ---
export const filterRequestsByTime = (
    allRequestsData: Map<string, RequestLogData>,
    filterStartMillis: number | null,
    filterEndMillis: number | null
): FilteredData => {
    const logContext = { function: 'filterRequestsByTime' };
    logger.info({ ...logContext, event: 'filter_start', filterStartMillis, filterEndMillis }, 'Starting Phase 2a: Filtering requests by time');

    const filteredRequests = new Map<string, RequestLogData>();
    let analysisStartMillis: number | null = null;
    let analysisEndMillis: number | null = null;

    for (const [requestId, requestInfo] of allRequestsData.entries()) {
        const includeRequest = doesRequestOverlapFilter(
            requestInfo.startTime,
            requestInfo.endTime,
            filterStartMillis,
            filterEndMillis,
            requestId
        );

        if (includeRequest) {
            filteredRequests.set(requestId, requestInfo);
            // Update overall analysis time range based *only* on included requests
            if (requestInfo.startTime !== null) {
                analysisStartMillis = Math.min(requestInfo.startTime, analysisStartMillis ?? requestInfo.startTime);
            }
            if (requestInfo.endTime !== null) {
                analysisEndMillis = Math.max(requestInfo.endTime, analysisEndMillis ?? requestInfo.endTime);
            }
        }
    }

    logger.info({ ...logContext, event: 'filter_end', totalRequests: allRequestsData.size, includedRequests: filteredRequests.size, analysisStartMillis, analysisEndMillis }, 'Finished Phase 2a: Filtering requests');
    return { filteredRequests, analysisStartMillis, analysisEndMillis };
};


// --- Step 3: Process Individual Log Entries ---
// This function modifies the 'results' and 'conferenceLastTimestamp' objects directly

/**
 * Processes a single log entry and updates the overall analysis results
 * and the specific conference details.
 *
 * IMPORTANT: This function modifies the 'results' object directly.
 * Final conference status ('completed'/'failed') is determined primarily
 * by csv_write_record_success/csv_write_record_failed events. Other errors
 * mark steps as failed but don't necessarily terminate the conference status prematurely.
 *
 * @param logEntry The parsed log entry object.
 * @param results The main LogAnalysisResult object to update.
 * @param conferenceLastTimestamp A map tracking the latest timestamp seen for each conference key.
 * @param logContextBase Base context object for logging within this function.
 */
export const processLogEntry = (
    logEntry: any,
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    logContextBase: object
): void => {
    // --- Basic Log Entry Parsing ---
    const entryTimeMillis = new Date(logEntry.time).getTime();
    const entryTimestampISO = new Date(entryTimeMillis).toISOString();
    const logContext = { ...logContextBase, requestId: logEntry.requestId, event: logEntry.event, time: entryTimestampISO };

    // Update overall error counts (for logs within the filtered range)
    if (logEntry.level >= 50) results.errorLogCount++; // pino level: ERROR
    if (logEntry.level >= 60) results.fatalLogCount++; // pino level: FATAL

    const msg = logEntry.msg || '';
    const context = logEntry;
    const event = context.event;
    const route = context.route;
    const error = context.err || context.reason; // Standardize error source access

    // --- Conference Identification & Detail Retrieval ---
    const acronym = context.acronym || context.conferenceAcronym;
    const title = context.title || context.conferenceTitle;
    const compositeKey = createConferenceKey(acronym, title);
    let confDetail: ConferenceAnalysisDetail | null = null;

    if (compositeKey) {
        // Initialize detail if it's the first time seeing this conference
        if (!results.conferenceAnalysis[compositeKey]) {
            results.conferenceAnalysis[compositeKey] = initializeConferenceDetail(acronym!, title!);
            logger.trace({ ...logContext, event: 'conference_detail_init', compositeKey }, 'Initialized new conference detail');
        }
        confDetail = results.conferenceAnalysis[compositeKey];

        // Update the last seen timestamp for this specific conference
        if (!isNaN(entryTimeMillis)) {
            conferenceLastTimestamp[compositeKey] = Math.max(entryTimeMillis, conferenceLastTimestamp[compositeKey] ?? 0);
        }
    } else if (acronym && (event?.startsWith('task_') || event?.includes('conference') || event?.includes('gemini') || event?.includes('save_') || event?.includes('csv_'))) {
        // Log a warning if an important event has an acronym but lacks a title for reliable tracking
        logger.warn({ ...logContext, event: 'analysis_missing_title_for_key', logEvent: event, acronym: acronym }, 'Log entry with acronym is missing title, cannot reliably track conference details.');
    }

    // ========================================================================
    // --- Event-Based Analysis Sections ---
    // ========================================================================

    // --- Section 1: Task Lifecycle (Start and Crawl Stage Finish) ---
    switch (event) {
        case 'task_start':
            if (confDetail) {
                // Record the start time if not already set
                if (!confDetail.startTime) {
                    confDetail.startTime = entryTimestampISO;
                }
                // Set initial status to processing, unless already in a terminal state
                if (confDetail.status === 'unknown') {
                    confDetail.status = 'processing';
                    logger.trace({ ...logContext, event: 'analysis_status_set_processing', compositeKey }, 'Set conference status to processing.');
                }
            }
            break;

        // Use 'task_crawl_stage_finish' if you renamed it in the crawler, otherwise use 'task_finish'
        case 'task_crawl_stage_finish': // OR case 'task_finish':
            if (confDetail) {
                confDetail.crawlEndTime = entryTimestampISO; // Record when the crawl/save phase ended
                confDetail.crawlSucceededWithoutError = context.status !== false; // Note if crawl phase had errors reported in the log context
                logger.trace({ ...logContext, event: 'analysis_crawl_stage_finish', compositeKey: compositeKey, crawlSucceeded: confDetail.crawlSucceededWithoutError }, 'Noted crawl stage finish.');
                // CRITICAL: Do NOT set the final conference status (completed/failed) here.
            }
            break;

        // Add other specific lifecycle events if necessary (e.g., 'task_skipped')
    }

    // --- Section 2: Step Failures & Errors (Search, Playwright, Gemini, Batch) ---
    // These events record step failure/errors but generally DO NOT set the final conference status.
    switch (event) {
        // --- Google Search Failures ---
        case 'search_failed_max_retries':
        case 'search_ultimately_failed':
            results.googleSearch.failedSearches++;
            const failError = error || msg || 'Search ultimately failed';
            const failErrorKey = normalizeErrorKey(failError);
            results.googleSearch.errorsByType[failErrorKey] = (results.googleSearch.errorsByType[failErrorKey] || 0) + 1;
            results.errorsAggregated[failErrorKey] = (results.errorsAggregated[failErrorKey] || 0) + 1; // Aggregate search failures
            if (confDetail) {
                confDetail.steps.search_success = false; // Mark search STEP as failed
                addConferenceError(confDetail, entryTimestampISO, error, msg || 'Search ultimately failed');
            }
            break;

        case 'search_skip_all_keys_exhausted':
        case 'search_skip_no_key':
            results.googleSearch.skippedSearches++;
            const skipReason = msg || `Search skipped (${event})`;
            const skipErrorKey = normalizeErrorKey(skipReason);
            results.googleSearch.errorsByType[skipErrorKey] = (results.googleSearch.errorsByType[skipErrorKey] || 0) + 1;
            results.errorsAggregated[skipErrorKey] = (results.errorsAggregated[skipErrorKey] || 0) + 1; // Treat skip as a significant failure
            if (confDetail) {
                confDetail.steps.search_success = false; // Mark search STEP as failed
                addConferenceError(confDetail, entryTimestampISO, null, skipReason);
            }
            break;

        // --- Playwright Failures ---
        case 'playwright_setup_failed': // Global setup failure, not conference specific
            results.playwright.setupSuccess = false;
            results.playwright.setupError = true;
            const setupError = error || msg || 'Playwright setup failed';
            const setupErrorKey = normalizeErrorKey(setupError);
            results.playwright.errorsByType[setupErrorKey] = (results.playwright.errorsByType[setupErrorKey] || 0) + 1;
            results.errorsAggregated[setupErrorKey] = (results.errorsAggregated[setupErrorKey] || 0) + 1;
            break;

        case 'save_html_failed':
            results.playwright.failedSaves++;
            const saveError = error || msg || 'Save HTML step failed';
            const saveErrorKey = normalizeErrorKey(saveError);
            results.playwright.errorsByType[saveErrorKey] = (results.playwright.errorsByType[saveErrorKey] || 0) + 1;
            results.errorsAggregated[saveErrorKey] = (results.errorsAggregated[saveErrorKey] || 0) + 1; // Treat save failure as significant
            if (confDetail) {
                confDetail.steps.html_save_success = false; // Mark HTML save STEP as failed
                addConferenceError(confDetail, entryTimestampISO, error, saveError);
            }
            break;

        case 'link_access_failed': // Failure accessing a specific link during crawling
            results.playwright.linkProcessing.failedAccess++;
            const linkAccessError = error || msg || `Link access failed: ${context.url || 'N/A'}`;
            const linkAccessErrorKey = normalizeErrorKey(linkAccessError);
            results.playwright.errorsByType[linkAccessErrorKey] = (results.playwright.errorsByType[linkAccessErrorKey] || 0) + 1;
            // Don't aggregate unless critical. Add to conference detail for info.
            if (confDetail) {
                confDetail.steps.link_processing_failed?.push({
                    timestamp: entryTimestampISO,
                    details: linkAccessErrorKey // Store normalized key or short message
                });
                // Optionally addConferenceError if needed, but might be too noisy
            }
            break;

        // Add other critical Playwright operation failures if they should be logged as errors
        case 'page_close_failed':
        case 'dom_clean_failed':
        case 'content_fetch_failed':
            const otherPwError = error || msg || `Playwright operation failed (${event})`;
            const otherPwErrorKey = normalizeErrorKey(otherPwError);
            results.playwright.errorsByType[otherPwErrorKey] = (results.playwright.errorsByType[otherPwErrorKey] || 0) + 1;
            // Decide if these should be aggregated or just added to conference errors
            // results.errorsAggregated[otherPwErrorKey] = (results.errorsAggregated[otherPwErrorKey] || 0) + 1;
            if (confDetail) {
                 addConferenceError(confDetail, entryTimestampISO, error, otherPwError);
            }
            break;

        // --- Gemini Failures (Final Outcomes of a call attempt) ---
        case 'retry_failed_max_retries': // Failed after all retries
        case 'retry_abort_non_retryable': // Failed due to non-retryable error (e.g., bad request, excluding safety blocks if counted separately)
        case 'gemini_api_response_blocked': // Explicitly blocked by safety
        case 'retry_attempt_error_safety_blocked': // Safety block during a retry
            const geminiFinalError = context.finalError || error || msg || `Gemini API call failed (${event})`;
            const geminiFinalErrorKey = normalizeErrorKey(geminiFinalError);
            results.geminiApi.errorsByType[geminiFinalErrorKey] = (results.geminiApi.errorsByType[geminiFinalErrorKey] || 0) + 1;
            results.errorsAggregated[geminiFinalErrorKey] = (results.errorsAggregated[geminiFinalErrorKey] || 0) + 1; // Aggregate final Gemini failures

            // Count specific failure types
            const isSafetyBlock = event.includes('safety') || event.includes('blocked') || (typeof geminiFinalError === 'object' && geminiFinalError?.finishReason === 'SAFETY');
            if (isSafetyBlock) {
                 results.geminiApi.blockedBySafety++;
                 // Also count as a failed call for overall metrics if desired
                 // results.geminiApi.failedCalls++;
            } else if (event !== 'retry_abort_non_retryable' || !isSafetyBlock) {
                 // Count as failed call if not a safety block handled above
                 results.geminiApi.failedCalls++;
            }

            // Update conference step status
            if (confDetail) {
                const apiType = context.apiType; // 'determine' or 'extract'
                if (apiType === 'determine') confDetail.steps.gemini_determine_success = false; // Mark determine STEP as failed
                if (apiType === 'extract') confDetail.steps.gemini_extract_success = false; // Mark extract STEP as failed
                addConferenceError(confDetail, entryTimestampISO, geminiFinalError, msg || `Gemini API call failed (${event})`);
            }
            break;

        // Other Gemini Setup/Configuration Errors
        case 'gemini_call_limiter_init_failed':
        case 'gemini_call_invalid_apitype':
        case 'non_cached_setup_failed':
            results.geminiApi.failedCalls++; // Treat as a failed call
            const setupFailError = error || msg || `Gemini setup/call failed (${event})`;
            const setupFailErrorKey = normalizeErrorKey(setupFailError);
            results.geminiApi.errorsByType[setupFailErrorKey] = (results.geminiApi.errorsByType[setupFailErrorKey] || 0) + 1;
            results.errorsAggregated[setupFailErrorKey] = (results.errorsAggregated[setupFailErrorKey] || 0) + 1;
            if (confDetail) { // Affects the specific conference if context is available
                const apiType = context.apiType;
                if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                addConferenceError(confDetail, entryTimestampISO, error, setupFailError);
            }
            break;

        // --- Batch Processing Failures ---
        case 'batch_aggregation_item_failed_rejected': // Underlying promise failed
            results.batchProcessing.failedBatches++;
            const batchRejectError = error || 'Batch promise rejected';
            const batchRejectErrorKey = normalizeErrorKey(batchRejectError);
            results.errorsAggregated[batchRejectErrorKey] = (results.errorsAggregated[batchRejectErrorKey] || 0) + 1;
            if (confDetail) {
                addConferenceError(confDetail, entryTimestampISO, error, 'Batch processing step failed (rejected)');
                // Consider if this prevents subsequent steps (like Gemini calls) - might imply step failure
            }
            break;

        case 'save_batch_determine_api_call_failed': // Failure during API call within batch save
        case 'save_batch_extract_api_call_failed':
        case 'save_batch_process_determine_call_failed':
        case 'save_batch_process_determine_failed_invalid':
            // These indicate a failure in the Gemini step triggered via batching
            const saveBatchApiError = error || msg || `Save batch step failed (${event})`;
            const saveBatchApiErrorKey = normalizeErrorKey(saveBatchApiError);
            results.errorsAggregated[saveBatchApiErrorKey] = (results.errorsAggregated[saveBatchApiErrorKey] || 0) + 1;
            if (confDetail) {
                addConferenceError(confDetail, entryTimestampISO, error, saveBatchApiError);
                // Mark the corresponding Gemini step as failed
                if (event.includes('determine')) confDetail.steps.gemini_determine_success = false;
                if (event.includes('extract')) confDetail.steps.gemini_extract_success = false;
            }
            break;

        // Filesystem errors during batch saving (likely system-level)
        case 'save_batch_dir_create_failed':
        case 'save_batch_read_content_failed':
        case 'save_batch_write_file_failed':
            const fsError = error || msg || `Save batch FS operation failed (${event})`;
            const fsErrorKey = normalizeErrorKey(fsError);
            results.errorsAggregated[fsErrorKey] = (results.errorsAggregated[fsErrorKey] || 0) + 1;
            // Typically not added to specific conference detail unless context links it
            break;

        // --- Unhandled Task Error ---
        // This might signify a more serious problem within the task processing logic
        case 'task_unhandled_error':
             const unhandledError = error || msg || `Task failed (${event})`;
             const unhandledErrorKey = normalizeErrorKey(unhandledError);
             results.errorsAggregated[unhandledErrorKey] = (results.errorsAggregated[unhandledErrorKey] || 0) + 1;
            if (confDetail) {
                // Consider if this should immediately mark the conference as failed.
                // For now, just add the error. The final calculation will handle status if no CSV success occurs.
                addConferenceError(confDetail, entryTimestampISO, error, msg || `Task failed (${event})`);
                // Optionally: confDetail.status = 'failed'; confDetail.endTime = entryTimestampISO;
            }
            break;
    }

    // --- Section 3: Definitive Completion/Failure Events (CSV Writing) ---
    // These events determine the final 'completed' or 'failed' status.
    switch (event) {
        case 'csv_write_record_success':
            if (confDetail) {
                // --- Definitive Success ---
                confDetail.status = 'completed';
                confDetail.csvWriteSuccess = true;
                // Set final end time for the conference processing
                confDetail.endTime = entryTimestampISO;
                logger.trace({ ...logContext, event: 'analysis_mark_completed_csv', compositeKey }, 'Marked conference as completed (CSV write success).');
            } else {
                // Log warning if we get this event but can't find the conference detail
                logger.warn({ ...logContext, event: 'analysis_csv_success_no_detail', acronym: context.acronym, title: context.title }, 'CSV write success event found but no corresponding conference detail.');
            }
            break;

        case 'csv_write_record_failed':
            // Log the error in the aggregated results
            const csvWriteErrorKey = normalizeErrorKey(error || msg || 'CSV record write failed');
            results.errorsAggregated[csvWriteErrorKey] = (results.errorsAggregated[csvWriteErrorKey] || 0) + 1;

            if (confDetail) {
                // --- Definitive Failure ---
                confDetail.status = 'failed';
                confDetail.csvWriteSuccess = false;
                // Set final end time for the conference processing
                confDetail.endTime = entryTimestampISO;
                addConferenceError(confDetail, entryTimestampISO, error, msg || 'CSV record write failed');
                logger.warn({ ...logContext, event: 'analysis_mark_failed_csv_write', compositeKey }, 'Marked conference as failed (CSV write failure).');
            } else {
                // Log warning if we get this event but can't find the conference detail
                logger.warn({ ...logContext, event: 'analysis_csv_fail_no_detail', acronym: context.acronym, title: context.title }, 'CSV write failure event found but cannot link to conference detail.');
            }
            break;
    }

    // --- Section 4: Intermediate Step Successes ---
    // Record when key steps succeed, important for tracking progress.
    switch(event) {
        // --- Google Search Success ---
        case 'search_success':
            results.googleSearch.successfulSearches++;
            if (confDetail) {
                // Mark step as success only if not already marked failed
                if (confDetail.steps.search_success !== false) {
                    confDetail.steps.search_success = true;
                }
                confDetail.steps.search_results_count = context.resultsCount ?? null;
            }
            break;
        case 'search_results_filtered':
             if (confDetail) {
                 confDetail.steps.search_filtered_count = context.filteredResults ?? null;
             }
             break;

        // --- Playwright Success ---
         case 'playwright_setup_success': // Global setup success
             results.playwright.setupSuccess = true;
             results.playwright.setupError = null; // Reset error if previously set
             break;
        case 'save_html_step_completed': // Assume this marks the overall HTML saving step success
            results.playwright.successfulSaves++;
            if (confDetail) {
                 // Mark step as success only if not already marked failed
                if (confDetail.steps.html_save_success !== false) {
                    confDetail.steps.html_save_success = true;
                }
            }
            break;
        case 'link_access_success': // Individual link access success
             results.playwright.linkProcessing.successfulAccess++;
             if (confDetail) confDetail.steps.link_processing_success++;
             break;

        // --- Gemini Success ---
        case 'gemini_api_attempt_success': // Success of a specific API call attempt (initial or retry)
             results.geminiApi.successfulCalls++;
             if (context.metaData?.totalTokenCount) {
                 results.geminiApi.totalTokens += Number(context.metaData.totalTokenCount) || 0;
             }
             if (confDetail) {
                 const apiType = context.apiType;
                 // Mark step success only if not already marked as failed
                 if (apiType === 'determine' && confDetail.steps.gemini_determine_success !== false) {
                     confDetail.steps.gemini_determine_success = true;
                     // Update cache usage based on this successful call if not already set by cache_hit
                     if (confDetail.steps.gemini_determine_cache_used === null) confDetail.steps.gemini_determine_cache_used = context.usingCache ?? false;
                 }
                 if (apiType === 'extract' && confDetail.steps.gemini_extract_success !== false) {
                     confDetail.steps.gemini_extract_success = true; // Mark extract STEP as successful
                     if (confDetail.steps.gemini_extract_cache_used === null) confDetail.steps.gemini_extract_cache_used = context.usingCache ?? false;
                 }
             }
             break;
         case 'cache_setup_use_success': // Cache Hit
             results.geminiApi.cacheHits++;
             if (confDetail) {
                 const apiType = context.apiType;
                 if (apiType === 'determine') confDetail.steps.gemini_determine_cache_used = true;
                 if (apiType === 'extract') confDetail.steps.gemini_extract_cache_used = true;
             }
             break;

        // --- Batch Processing Success ---
        case 'batch_aggregation_item_success': // Individual batch item success
             results.batchProcessing.successfulBatches++;
             break;
        // Add other success markers if needed (e.g., cache write success)
        case 'cache_write_success': results.geminiApi.cacheCreationSuccess++; break;
    }

    // --- Section 5: Counters and Informational Events ---
    // Track attempts, counts, etc., regardless of success/failure.
    switch(event) {
        // --- Google Search ---
        case 'search_attempt':
            results.googleSearch.totalRequests++;
            if (context.keyIndex !== undefined) {
                results.googleSearch.keyUsage[`key_${context.keyIndex}`] = (results.googleSearch.keyUsage[`key_${context.keyIndex}`] || 0) + 1;
            }
            if (confDetail) {
                confDetail.steps.search_attempted = true;
                confDetail.steps.search_attempts_count++;
            }
            break;

        // --- Playwright ---
        case 'save_html_start':
            results.playwright.htmlSaveAttempts++;
            if (confDetail) confDetail.steps.html_save_attempted = true;
            break;
        case 'link_access_attempt':
            results.playwright.linkProcessing.totalLinksAttempted++;
            if (confDetail) confDetail.steps.link_processing_attempted++;
            break;
        case 'redirect_detected':
            results.playwright.linkProcessing.redirects++;
            break;

        // --- Gemini ---
        case 'gemini_call_start': // Initial call attempt (before retries)
            results.geminiApi.totalCalls++;
            const apiType = context.apiType;
            const modelName = context.modelName;
            if (apiType) results.geminiApi.callsByType[apiType] = (results.geminiApi.callsByType[apiType] || 0) + 1;
            if (modelName) results.geminiApi.callsByModel[modelName] = (results.geminiApi.callsByModel[modelName] || 0) + 1;
            if (confDetail) {
                if (apiType === 'determine') confDetail.steps.gemini_determine_attempted = true;
                if (apiType === 'extract') confDetail.steps.gemini_extract_attempted = true;
            }
            break;
        case 'cache_create_start': results.geminiApi.cacheAttempts++; break;
        case 'cache_write_failed': results.geminiApi.cacheCreationFailed++; break;
        case 'cache_invalidate': results.geminiApi.cacheInvalidations++; break;
        case 'retry_rate_limit_wait': results.geminiApi.rateLimitWaits++; break;
        // Intermediate retry errors (don't count as final failure, just log type)
        case 'retry_attempt_error_cache':
        case 'retry_attempt_error_429':
        case 'retry_attempt_error_5xx':
        case 'retry_attempt_error_unknown':
            const intermediateError = error || msg || `Gemini retry attempt failed (${event})`;
            const intermediateErrorKey = normalizeErrorKey(intermediateError);
            results.geminiApi.errorsByType[intermediateErrorKey] = (results.geminiApi.errorsByType[intermediateErrorKey] || 0) + 1;
            break;

        // --- Batch Processing ---
        case 'batch_task_create': results.batchProcessing.totalBatchesAttempted++; break;
        case 'batch_aggregation_item_failed_logic':
        case 'batch_aggregation_item_failed_nodata':
            results.batchProcessing.failedBatches++; // Count logical/no-data failures separately if needed
            break;
        case 'batch_aggregation_end':
             if (context.aggregatedCount !== undefined) {
                 results.batchProcessing.aggregatedResultsCount = context.aggregatedCount;
             }
             break;

        // --- Overall Process ---
        case 'crawl_start':
            if (!results.overall.startTime) results.overall.startTime = context.startTime ?? entryTimestampISO;
            if (context.totalConferences) {
                 results.overall.totalConferencesInput++; // Count inputs declared at start
            }
            break;
    }


    // --- Section 6: Final Result Preview Logging ---
    // Captures the structure of the final data for a conference as logged.
    if (route === '/crawl-conferences' && event === 'crawl_conference_result' && context.results && Array.isArray(context.results) && context.results.length > 0) {
        const result = context.results[0];
        const resultAcronym = result?.acronym;
        const resultTitle = result?.title;
        const resultCompositeKey = createConferenceKey(resultAcronym, resultTitle);

        if (resultCompositeKey && results.conferenceAnalysis[resultCompositeKey]) {
            results.conferenceAnalysis[resultCompositeKey].finalResultPreview = result;
            logger.trace({ ...logContext, event: 'capture_result_preview', compositeKey: resultCompositeKey }, 'Captured final result preview from crawl_conference_result');
        } else if (resultAcronym || resultTitle) {
            logger.warn({ ...logContext, event: 'capture_result_preview_miss', resultAcronym, resultTitle }, "Found crawl_conference_result but no matching analysis entry OR missing info for composite key");
        }
    }
    else if (route === '/crawl-conferences' && event === 'crawl_end_success' && context.resultsPreview && Array.isArray(context.resultsPreview)) {
        context.resultsPreview.forEach((preview: any) => {
            const previewAcronym = preview?.acronym;
            const previewTitle = preview?.title;
            const previewCompositeKey = createConferenceKey(previewAcronym, previewTitle);

            if (previewCompositeKey && results.conferenceAnalysis[previewCompositeKey]) {
                // Only store if a preview isn't already captured
                if (!results.conferenceAnalysis[previewCompositeKey].finalResultPreview) {
                    results.conferenceAnalysis[previewCompositeKey].finalResultPreview = preview;
                    logger.trace({ ...logContext, event: 'capture_result_preview_end', compositeKey: previewCompositeKey }, 'Captured final result preview from crawl_end_success');
                }
            } else if (previewAcronym || previewTitle) {
                logger.warn({ ...logContext, event: 'capture_result_preview_end_miss', previewAcronym, previewTitle }, "Found preview in crawl_end_success but no matching analysis entry OR missing info for composite key");
            }
        });
    }
}; // --- End of processLogEntry ---



export const calculateFinalMetrics = (
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }, // Still useful for debugging/potential future use
    analysisStartMillis: number | null,
    analysisEndMillis: number | null
): void => {
    const logContext = { function: 'calculateFinalMetrics' };
    logger.info({ ...logContext, event: 'final_calc_start' }, "Performing final calculations on analyzed data");

    // --- Calculate Overall Duration based on analyzed request range ---
    // (Keep existing logic for calculating results.overall start/end/duration based on analysisStart/EndMillis or fallback)
    if (analysisStartMillis && analysisEndMillis) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
    } else if (Object.keys(results.conferenceAnalysis).length > 0) {
        // Fallback logic remains the same
        let minConfStart: number | null = null;
        let maxConfEnd: number | null = null;
        Object.values(results.conferenceAnalysis).forEach(detail => {
             // Use detail.endTime if set, otherwise consider lastSeenTime *only if status is terminal*
             const detailEndTimeMillis = detail.endTime ? new Date(detail.endTime).getTime() : null;
             const lastSeenTime = conferenceLastTimestamp[createConferenceKey(detail.acronym, detail.title) ?? ''] ?? null;
             const consideredEndTime = detailEndTimeMillis ?? ((detail.status === 'completed' || detail.status === 'failed') ? lastSeenTime : null); // Only use lastSeen as fallback for terminal states

            if (detail.startTime) {
                const startMs = new Date(detail.startTime).getTime();
                if (!isNaN(startMs)) minConfStart = Math.min(startMs, minConfStart ?? startMs);
            }
            if (consideredEndTime && !isNaN(consideredEndTime)) {
                 maxConfEnd = Math.max(consideredEndTime, maxConfEnd ?? consideredEndTime);
            }
        });
        if (minConfStart) results.overall.startTime = new Date(minConfStart).toISOString();
        if (maxConfEnd) results.overall.endTime = new Date(maxConfEnd).toISOString();
        if (minConfStart && maxConfEnd) {
            results.overall.durationSeconds = Math.round((maxConfEnd - minConfStart) / 1000);
        }
    }


    // --- Finalize Conference Details and Counts ---
    let completionSuccessCount = 0;
    let completionFailCount = 0;
    let processingCount = 0; // Tasks still running or in unknown state at end of window
    let extractionSuccessCount = 0;

    const processedCompositeKeys = Object.keys(results.conferenceAnalysis);
    results.overall.processedConferencesCount = processedCompositeKeys.length;

    processedCompositeKeys.forEach(key => {
        const detail = results.conferenceAnalysis[key];

        // --- Categorize based on final observed status ---
        if (detail.status === 'completed') {
            completionSuccessCount++;
            // Duration calculation for completed tasks
            if (detail.startTime && detail.endTime) {
                const startMillis = new Date(detail.startTime).getTime();
                const endMillis = new Date(detail.endTime).getTime();
                if (!isNaN(startMillis) && !isNaN(endMillis)) {
                    detail.durationSeconds = Math.round((endMillis - startMillis) / 1000);
                }
            } else if (!detail.startTime && detail.endTime) {
                 addConferenceError(detail, detail.endTime, null, 'Task completed event found without start event within analyzed range');
            }
        } else if (detail.status === 'failed') {
            completionFailCount++;
            // Duration calculation for failed tasks (if endTime was set by the failure event)
            if (detail.startTime && detail.endTime) {
                const startMillis = new Date(detail.startTime).getTime();
                const endMillis = new Date(detail.endTime).getTime();
                if (!isNaN(startMillis) && !isNaN(endMillis)) {
                    detail.durationSeconds = Math.round((endMillis - startMillis) / 1000);
                }
            } else if (!detail.startTime && detail.endTime) {
                 addConferenceError(detail, detail.endTime, null, 'Task failed event found without start event within analyzed range');
            }
        } else if (detail.status === 'processing' || detail.status === 'unknown') {
            // Task started but did not reach a terminal state (completed/failed)
            // within the analyzed log window.
            if (detail.startTime) { // Only count if it actually started
                processingCount++;
                // DO NOT set endTime or durationSeconds. Leave them null.
                // DO NOT change status to 'failed'.
                logger.trace({ ...logContext, event: 'final_calc_task_processing', compositeKey: key, status: detail.status }, 'Task considered still processing at end of analysis window.');
            } else {
                 // Status is 'unknown' and no startTime - likely just initialized but never started processing within window. Ignore in counts.
                 logger.trace({ ...logContext, event: 'final_calc_task_ignored_not_started', compositeKey: key }, 'Task ignored (initialized but not started within window).');
            }
        } else {
            // Should not happen with defined statuses
            logger.warn({ ...logContext, event: 'final_calc_unknown_status', compositeKey: key, status: detail.status }, 'Encountered unexpected final status for conference.');
        }

        // Count successful *extractions* independently
        if (detail.steps.gemini_extract_success === true) {
            extractionSuccessCount++;
        }
    });

    // --- Update Overall Results ---
    results.overall.completedTasks = completionSuccessCount;
    results.overall.failedOrCrashedTasks = completionFailCount;
    results.overall.processingTasks = processingCount; // Add the new count
    results.overall.successfulExtractions = extractionSuccessCount;

    // --- Calculate Derived Stats ---
    results.geminiApi.cacheMisses = Math.max(0, results.geminiApi.cacheAttempts - results.geminiApi.cacheHits);

    logger.info({
        ...logContext,
        event: 'final_calc_end',
        completed: completionSuccessCount,
        failed: completionFailCount,
        processing: processingCount,
        processed: results.overall.processedConferencesCount
    }, "Finished final calculations.");
};