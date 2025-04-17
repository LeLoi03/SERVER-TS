import { logger } from '../../conference/11_utils';
import { LogAnalysisResult, ConferenceAnalysisDetail, ValidationStats } from '../types/logAnalysis';
import { normalizeErrorKey, addConferenceError, createConferenceKey } from './helpers';

// --- Type Definition for Event Handlers ---
export type LogEventHandler = (
    logEntry: any,
    results: LogAnalysisResult,
    confDetail: ConferenceAnalysisDetail | null,
    entryTimestampISO: string,
    logContext: object
) => void;

// --- Helper Functions (Specific to Handlers) ---
// (Could add more helpers here if needed)

// --- Individual Event Handler Functions ---

// Section 1: Task Lifecycle
const handleTaskStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (confDetail) {
        if (!confDetail.startTime) {
            confDetail.startTime = entryTimestampISO;
        }
        if (confDetail.status === 'unknown') {
            confDetail.status = 'processing';
            logger.trace({ ...logContext, event: 'analysis_status_set_processing' }, 'Set conference status to processing.');
        }
    }
};

const handleTaskCrawlStageFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (confDetail) {
       confDetail.crawlEndTime = entryTimestampISO;
       confDetail.crawlSucceededWithoutError = logEntry.status !== false; // Assuming status is at root
       logger.trace({ ...logContext, event: 'analysis_crawl_stage_finish', crawlSucceeded: confDetail.crawlSucceededWithoutError }, 'Noted crawl stage finish (task_finish).');
   }
};

// Section 2: Step Failures & Errors
const handleSearchFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg;
    const event = logEntry.event;
    const defaultMsg = event === 'search_skip_all_keys_exhausted' || event === 'search_skip_no_key'
        ? `Search skipped (${event})`
        : 'Search ultimately failed';
    const failureMsg = error || defaultMsg;
    const errorKey = normalizeErrorKey(failureMsg);

    if (event === 'search_skip_all_keys_exhausted' || event === 'search_skip_no_key') {
        results.googleSearch.skippedSearches++;
    } else {
        results.googleSearch.failedSearches++;
    }

    results.googleSearch.errorsByType[errorKey] = (results.googleSearch.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        confDetail.steps.search_success = false;
        addConferenceError(confDetail, entryTimestampISO, error, failureMsg);
    }
};

const handlePlaywrightSetupFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.setupSuccess = false;
    results.playwright.setupError = true;
    const error = logEntry.err || logEntry.reason || logEntry.msg || 'Playwright setup failed';
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
};

const handleSaveHtmlFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.failedSaves++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || 'Save HTML step failed';
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        confDetail.steps.html_save_success = false;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey); // Use normalized key or original error
    }
};

const handleLinkAccessFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.failedAccess++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Link access failed: ${logEntry.context?.url || 'N/A'}`;
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    if (confDetail) {
        confDetail.steps.link_processing_failed?.push({
            timestamp: entryTimestampISO,
            details: errorKey // Store normalized key or short message
        });
    }
};

const handleOtherPlaywrightFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Playwright operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    // Decide if aggregation is needed
    // results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};

const handleGeminiFinalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.context?.finalError || logEntry.err || logEntry.reason || logEntry.msg;
    const event = logEntry.event;
    const failureMsg = error || `Gemini API call failed (${event})`;
    const errorKey = normalizeErrorKey(failureMsg);

    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    const isSafetyBlock = event.includes('safety') || event.includes('blocked') || (typeof error === 'object' && error?.finishReason === 'SAFETY');
    if (isSafetyBlock) {
        results.geminiApi.blockedBySafety++;
        // Optionally count as failed call too: results.geminiApi.failedCalls++;
    } else {
        results.geminiApi.failedCalls++; // Count non-safety final failures
    }

    if (confDetail) {
        const apiType = logEntry.context?.apiType; // 'determine' or 'extract'
        if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
        if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};

const handleGeminiSetupFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.failedCalls++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Gemini setup/call failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        const apiType = logEntry.context?.apiType;
        if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
        if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};

const handleBatchRejection: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.batchProcessing.failedBatches++;
    const error = logEntry.err || logEntry.reason || 'Batch promise rejected';
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        addConferenceError(confDetail, entryTimestampISO, error, 'Batch processing step failed (rejected)');
    }
};

const handleSaveBatchApiFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Save batch step failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
        if (logEntry.event.includes('determine')) confDetail.steps.gemini_determine_success = false;
        if (logEntry.event.includes('extract')) confDetail.steps.gemini_extract_success = false;
    }
};

const handleSaveBatchFsFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Save batch FS operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    // Typically not added to specific conference detail unless context links it
};

const handleTaskUnhandledError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Task failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
        // Consider if this should immediately set status to 'failed'
        // confDetail.status = 'failed';
        // confDetail.endTime = entryTimestampISO;
    }
};

// Section 3: Definitive Completion/Failure Events
const handleCsvWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (confDetail) {
        confDetail.status = 'completed';
        confDetail.csvWriteSuccess = true;
        confDetail.endTime = entryTimestampISO;
        logger.trace({ ...logContext, event: 'analysis_mark_completed_csv' }, 'Marked conference as completed (CSV write success).');
    } else {
        logger.warn({ ...logContext, event: 'analysis_csv_success_no_detail', acronym: logEntry.context?.acronym, title: logEntry.context?.title }, 'CSV write success event found but no corresponding conference detail.');
    }
};

const handleCsvWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || 'CSV record write failed';
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        confDetail.status = 'failed';
        confDetail.csvWriteSuccess = false;
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
        logger.warn({ ...logContext, event: 'analysis_mark_failed_csv_write' }, 'Marked conference as failed (CSV write failure).');
    } else {
        logger.warn({ ...logContext, event: 'analysis_csv_fail_no_detail', acronym: logEntry.context?.acronym, title: logEntry.context?.title }, 'CSV write failure event found but cannot link to conference detail.');
    }
};

// Section 4: Intermediate Step Successes
const handleSearchSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.googleSearch.successfulSearches++;
    if (confDetail) {
        // Mark step as success only if not already marked failed
        if (confDetail.steps.search_success !== false) {
            confDetail.steps.search_success = true;
        }
        confDetail.steps.search_results_count = logEntry.resultsCount ?? null;
    }
};

const handleSearchResultsFiltered: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (confDetail) {
        confDetail.steps.search_filtered_count = logEntry.filteredCount ?? null;
    }
};

const handlePlaywrightSetupSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.setupSuccess = true;
    results.playwright.setupError = null;
};

// const handleSaveHtmlSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
//     // Assumes 'save_html_step_completed' marks success
//     results.playwright.successfulSaves++;
//     if (confDetail && confDetail.steps.html_save_success !== false) {
//         confDetail.steps.html_save_success = true;
//     }
// };

const handleSaveHtmlFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Assuming 'save_html_finish' marks successful completion of the save step for the conference
    results.playwright.successfulSaves++;
    if (confDetail && confDetail.steps.html_save_success !== false) {
        confDetail.steps.html_save_success = true;
        logger.trace({ ...logContext, event: 'analysis_html_save_marked_success' }, 'Marked HTML save step as successful based on save_html_finish.');
    }
};

const handleLinkAccessSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.successfulAccess++;
    if (confDetail) confDetail.steps.link_processing_success++;
};


// Section 4: Intermediate Step Successes (Gemini)
const handleGeminiSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.successfulCalls++;

    // CORRECTED: Access 'tokens' directly from logEntry root
    if (logEntry.tokens) {
        results.geminiApi.totalTokens += Number(logEntry.tokens) || 0;
    }

    if (confDetail) {
        // CORRECTED: Access 'apiType' and 'usingCache' directly from logEntry root
        const apiType = logEntry.apiType;
        const usingCache = logEntry.usingCache ?? false; // Default to false if undefined

        if (apiType === 'determine' && confDetail.steps.gemini_determine_success !== false) {
            confDetail.steps.gemini_determine_success = true;
            // Set cache status ONLY if not already set by cache_hit event
            if (confDetail.steps.gemini_determine_cache_used === null) {
                confDetail.steps.gemini_determine_cache_used = usingCache;
            }
            logger.trace({ ...logContext, event: 'analysis_gemini_determine_marked_success', usingCache }, 'Marked Gemini determine step as successful.');
        }
        if (apiType === 'extract' && confDetail.steps.gemini_extract_success !== false) {
            confDetail.steps.gemini_extract_success = true;
            if (confDetail.steps.gemini_extract_cache_used === null) {
                confDetail.steps.gemini_extract_cache_used = usingCache;
            }
            logger.trace({ ...logContext, event: 'analysis_gemini_extract_marked_success', usingCache }, 'Marked Gemini extract step as successful.');
        }
    }
};

// Section 4: Intermediate Step Successes (Gemini Cache Hit)
const handleGeminiCacheHit: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheHits++;
    if (confDetail) {
        // CORRECTED: Access 'apiType' directly from logEntry root
        const apiType = logEntry.apiType;
        if (apiType === 'determine') {
            confDetail.steps.gemini_determine_cache_used = true;
            logger.trace({ ...logContext, event: 'analysis_gemini_determine_cache_hit' }, 'Marked Gemini determine step as using cache (cache hit event).');
        }
        if (apiType === 'extract') {
            confDetail.steps.gemini_extract_cache_used = true;
            logger.trace({ ...logContext, event: 'analysis_gemini_extract_cache_hit' }, 'Marked Gemini extract step as using cache (cache hit event).');
        }
    }
};


// Section 4: Intermediate Step Successes (Batch)
// ADDED Handler for save_batch_finish_success
const handleSaveBatchFinishSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Assuming this event signifies one successful batch operation completion
    results.batchProcessing.successfulBatches++;
    logger.trace({ ...logContext, event: 'analysis_batch_op_success' }, 'Counted successful batch operation.');
    // Note: This doesn't necessarily mean the overall conference succeeded, just one batch file write.
};

const handleCacheWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheCreationSuccess++;
};

// Section 5: Counters and Informational Events
const handleSearchAttempt: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.googleSearch.totalRequests++;
    if (logEntry.keyIndex !== undefined) {
        results.googleSearch.keyUsage[`key_${logEntry.keyIndex}`] = (results.googleSearch.keyUsage[`key_${logEntry.keyIndex}`] || 0) + 1;
    }
    if (confDetail) {
        confDetail.steps.search_attempted = true;
        confDetail.steps.search_attempts_count++;
    }
};

const handleSaveHtmlStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.htmlSaveAttempts++;
    if (confDetail) confDetail.steps.html_save_attempted = true;
};

const handleLinkAccessAttempt: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.totalLinksAttempted++;
    if (confDetail) confDetail.steps.link_processing_attempted++;
};

const handleRedirect: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.redirects++;
};

// Section 5: Counters and Informational Events (Gemini)
const handleGeminiCallStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.totalCalls++;

    // CORRECTED: Access 'apiType' and 'modelName' directly from logEntry root
    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName;

    if (apiType) results.geminiApi.callsByType[apiType] = (results.geminiApi.callsByType[apiType] || 0) + 1;
    if (modelName) results.geminiApi.callsByModel[modelName] = (results.geminiApi.callsByModel[modelName] || 0) + 1;

    if (confDetail) {
        if (apiType === 'determine') {
            confDetail.steps.gemini_determine_attempted = true;
             logger.trace({ ...logContext, event: 'analysis_gemini_determine_attempted' }, 'Marked Gemini determine step as attempted.');
        }
        if (apiType === 'extract') {
            confDetail.steps.gemini_extract_attempted = true;
            logger.trace({ ...logContext, event: 'analysis_gemini_extract_attempted' }, 'Marked Gemini extract step as attempted.');
        }
    }
};

const handleCacheCreateStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheAttempts++;
};

const handleCacheWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheCreationFailed++;
};

const handleCacheInvalidate: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheInvalidations++;
};

const handleRateLimitWait: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.rateLimitWaits++;
};

const handleGeminiIntermediateError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Gemini retry attempt failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
};

const handleBatchTaskCreate: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.batchProcessing.totalBatchesAttempted++;
};

const handleBatchLogicFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Treat 'logic' and 'nodata' similarly for now, potentially differentiate later
    results.batchProcessing.failedBatches++;
    // Could add specific logging or tracking here if needed
};

const handleBatchAggregationEnd: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (logEntry.context?.aggregatedCount !== null) {
        results.batchProcessing.aggregatedResultsCount = logEntry.context.aggregatedCount;
    }
};

const handleCrawlStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (!results.overall.startTime) results.overall.startTime = logEntry.context?.startTime ?? entryTimestampISO;
    if (logEntry.context?.totalConferences) {
        results.overall.totalConferencesInput++;
    }
};

// Section 6: Final Result Preview Logging
const handleCrawlConferenceResult: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (logEntry.route === '/crawl-conferences' && logEntry.event === 'crawl_conference_result' && logEntry.context?.results && Array.isArray(logEntry.context.results) && logEntry.context.results.length > 0) {
        const result = logEntry.context.results[0];
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
};

const handleCrawlEndSuccessPreview: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (logEntry.route === '/crawl-conferences' && logEntry.event === 'crawl_end_success' && logEntry.context?.resultsPreview && Array.isArray(logEntry.context.resultsPreview)) {
        logEntry.context.resultsPreview.forEach((preview: any) => {
            const previewAcronym = preview?.acronym;
            const previewTitle = preview?.title;
            const previewCompositeKey = createConferenceKey(previewAcronym, previewTitle);

            if (previewCompositeKey && results.conferenceAnalysis[previewCompositeKey]) {
                if (!results.conferenceAnalysis[previewCompositeKey].finalResultPreview) {
                    results.conferenceAnalysis[previewCompositeKey].finalResultPreview = preview;
                    logger.trace({ ...logContext, event: 'capture_result_preview_end', compositeKey: previewCompositeKey }, 'Captured final result preview from crawl_end_success');
                }
            } else if (previewAcronym || previewTitle) {
                logger.warn({ ...logContext, event: 'capture_result_preview_end_miss', previewAcronym, previewTitle }, "Found preview in crawl_end_success but no matching analysis entry OR missing info for composite key");
            }
        });
    }
};


// --- Section 7: Validation and Normalization Handlers (NEW SECTION) ---

const handleValidationWarning: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const field = logEntry.context?.field; // Lấy tên trường bị cảnh báo
    const invalidValue = logEntry.context?.invalidValue;
    const action = logEntry.context?.action; // 'normalized' or 'logged_only'

    // Cập nhật thống kê tổng thể
    results.validationStats.totalValidationWarnings++;

    if (field && typeof field === 'string') {
        // Đếm số lượng cảnh báo cho từng trường cụ thể
        results.validationStats.warningsByField[field] = (results.validationStats.warningsByField[field] || 0) + 1;
    } else {
        // Nếu không có tên trường, có thể đếm vào một mục chung 'unknown_field'
        results.validationStats.warningsByField['unknown_field'] = (results.validationStats.warningsByField['unknown_field'] || 0) + 1;
        logger.warn({ ...logContext, event: 'validation_warning_missing_field' }, 'Validation warning log entry is missing the "field" property.');
    }

    // Optional: Thêm thông tin chi tiết vào conference detail nếu muốn

    if (confDetail && field) {
        if (!confDetail.validationIssues) {
            confDetail.validationIssues = [];
        }
        confDetail.validationIssues.push({
            field: field,
            value: invalidValue,
            action: action || 'unknown',
            timestamp: entryTimestampISO
        });
    }

    logger.trace({ ...logContext, event: 'processed_validation_warning', field: field, action: action }, 'Processed validation warning event.');
};


// Handler cho normalization (chỉ thêm nếu bạn log event 'normalization_applied')
const handleNormalizationApplied: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const field = logEntry.context?.field;
    const reason = logEntry.context?.reason; // 'empty_value', 'invalid_value', etc.

    results.validationStats.totalNormalizationsApplied++;

    if (field && typeof field === 'string') {
        results.validationStats.normalizationsByField[field] = (results.validationStats.normalizationsByField[field] || 0) + 1;
    } else {
        results.validationStats.normalizationsByField['unknown_field'] = (results.validationStats.normalizationsByField['unknown_field'] || 0) + 1;
        logger.warn({ ...logContext, event: 'normalization_applied_missing_field' }, 'Normalization applied log entry is missing the "field" property.');
    }

    logger.trace({ ...logContext, event: 'processed_normalization_applied', field: field, reason: reason }, 'Processed normalization applied event.');
};


// --- Event Handler Map ---
// Maps event strings to their corresponding handler functions
// --- Event Handler Map (UPDATED Mappings) ---
export const eventHandlerMap: Record<string, LogEventHandler> = {
    // Task Lifecycle
    'task_start': handleTaskStart,
    'task_crawl_stage_finish': handleTaskCrawlStageFinish, // Or 'task_finish'
    'task_finish': handleTaskCrawlStageFinish, // Added based on logs

    // Search
    'search_failed_max_retries': handleSearchFailure,
    'search_ultimately_failed': handleSearchFailure,
    'search_skip_all_keys_exhausted': handleSearchFailure,
    'search_skip_no_key': handleSearchFailure,
    'search_success': handleSearchSuccess, // Assuming handleSearchSuccess is correct
    'search_results_filtered': handleSearchResultsFiltered, // Assuming handleSearchResultsFiltered is correct
    'search_attempt': handleSearchAttempt, // Assuming handleSearchAttempt is correct

    // Playwright
    'playwright_setup_failed': handlePlaywrightSetupFailed, // Assuming correct
    'playwright_setup_success': handlePlaywrightSetupSuccess, // Assuming correct
    'save_html_start': handleSaveHtmlStart, // Assuming correct
    'save_html_failed': handleSaveHtmlFailed, // Assuming correct
    'save_html_finish': handleSaveHtmlFinish, // CORRECTED/ADDED - Map to the new/renamed handler
    'link_access_failed': handleLinkAccessFailed, // Corrected access inside handler
    'link_access_success': handleLinkAccessSuccess, // Assuming correct
    'link_access_attempt': handleLinkAccessAttempt, // Assuming correct
    // 'link_processing_start': (logEntry, results, confDetail, entryTimestampISO, logContext) => {}, // Often just informational
    // 'link_processing_success': handleLinkProcessingSuccess, // Placeholder - Add if needed

    'page_close_failed': handleOtherPlaywrightFailure, // Assuming correct
    'dom_clean_failed': handleOtherPlaywrightFailure, // Assuming correct
    'content_fetch_failed': handleOtherPlaywrightFailure, // Assuming correct
    'redirect_detected': handleRedirect, // Assuming correct

    // Gemini
    'retry_failed_max_retries': handleGeminiFinalFailure, // Assuming correct
    'retry_abort_non_retryable': handleGeminiFinalFailure, // Assuming correct
    'gemini_api_response_blocked': handleGeminiFinalFailure, // Assuming correct
    'retry_attempt_error_safety_blocked': handleGeminiFinalFailure, // Assuming correct
    'gemini_call_limiter_init_failed': handleGeminiSetupFailure, // Assuming correct
    'gemini_call_invalid_apitype': handleGeminiSetupFailure, // Assuming correct
    'non_cached_setup_failed': handleGeminiSetupFailure, // Assuming correct
    'gemini_api_attempt_success': handleGeminiSuccess, // CORRECTED inside handler
    'cache_setup_use_success': handleGeminiCacheHit, // CORRECTED inside handler
    'cache_write_success': handleCacheWriteSuccess, // Assuming correct
    'gemini_call_start': handleGeminiCallStart, // CORRECTED inside handler
    'cache_create_start': handleCacheCreateStart, // Assuming correct
    'cache_write_failed': handleCacheWriteFailed, // Assuming correct
    'cache_invalidate': handleCacheInvalidate, // Assuming correct
    'retry_rate_limit_wait': handleRateLimitWait, // Assuming correct
    'retry_attempt_error_cache': handleGeminiIntermediateError, // Assuming correct
    'retry_attempt_error_429': handleGeminiIntermediateError, // Assuming correct
    'retry_attempt_error_5xx': handleGeminiIntermediateError, // Assuming correct
    'retry_attempt_error_unknown': handleGeminiIntermediateError, // Assuming correct
    'gemini_api_generate_start': (logEntry, results, confDetail, entryTimestampISO, logContext) => {}, // Informational
    'gemini_api_generate_success': (logEntry, results, confDetail, entryTimestampISO, logContext) => {}, // Informational precursor to attempt_success


    // Batch Processing
    'batch_aggregation_item_failed_rejected': handleBatchRejection, // Assuming correct
    'save_batch_determine_api_call_failed': handleSaveBatchApiFailure, // Assuming correct
    'save_batch_extract_api_call_failed': handleSaveBatchApiFailure, // Assuming correct
    'save_batch_process_determine_call_failed': handleSaveBatchApiFailure, // Assuming correct
    'save_batch_process_determine_failed_invalid': handleSaveBatchApiFailure, // Assuming correct
    'save_batch_dir_create_failed': handleSaveBatchFsFailure, // Assuming correct
    'save_batch_read_content_failed': handleSaveBatchFsFailure, // Assuming correct
    'save_batch_write_file_failed': handleSaveBatchFsFailure, // Assuming correct
    // 'batch_aggregation_item_success': handleBatchSuccess, // Event not present in logs
    'batch_task_create': handleBatchTaskCreate, // Assuming correct
    'batch_aggregation_item_failed_logic': handleBatchLogicFailure, // Assuming correct
    'batch_aggregation_item_failed_nodata': handleBatchLogicFailure, // Assuming correct
    'batch_aggregation_end': handleBatchAggregationEnd, // Assuming correct
    'save_batch_finish_success': handleSaveBatchFinishSuccess, // CORRECTED/ADDED handler mapping
    'save_batch_append_success': (logEntry, results, confDetail, entryTimestampISO, logContext) => {}, // Informational

    // Unhandled Task Error
    'task_unhandled_error': handleTaskUnhandledError, // Assuming correct

    // Definitive Completion/Failure (CSV Writing)
    'csv_write_record_success': handleCsvWriteSuccess, // Assuming correct
    'csv_write_record_failed': handleCsvWriteFailed, // Assuming correct

    // Overall Process
    'crawl_start': handleCrawlStart, // Assuming correct

    // Final Result Preview Logging
    'crawl_conference_result': handleCrawlConferenceResult, // Assuming correct
    'crawl_end_success': handleCrawlEndSuccessPreview, // Assuming correct

    // Validation/Normalization
    'validation_warning': handleValidationWarning, // Added previously
    // 'normalization_applied': handleNormalizationApplied, // Optional
};