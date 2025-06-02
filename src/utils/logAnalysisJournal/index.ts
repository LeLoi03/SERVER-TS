// src/utils/logAnalysisJournal/index.ts
import { JournalLogAnalysisResult, JournalAnalysisDetail } from '../../types/logAnalysisJournal/logAnalysisJournal.types';

// Import handlers from child files (to be created)
import * as overallProcessHandlers from './overallProcessJournalHandlers';
import * as playwrightHandlers from './playwrightJournalHandlers';
import * as apiKeyManagerHandlers from './apiKeyManagerJournalHandlers';
import * as googleSearchHandlers from './googleSearchJournalHandlers';
import * as scimagoHandlers from './scimagoJournalHandlers';
import * as bioxbioHandlers from './bioxbioJournalHandlers';
import * as journalTaskHandlers from './journalTaskHandlers';
import * as fileOutputHandlers from './fileOutputJournalHandlers';
import * as dataSourceHandlers from './dataSourceJournalHandlers';


export type JournalLogEventHandler = (
  logEntry: any,
  results: JournalLogAnalysisResult,
  journalDetail: JournalAnalysisDetail | null,
  entryTimestampISO: string,
) => void;

export const eventHandlerMapJournal: Record<string, JournalLogEventHandler> = {
    // --- Overall Process (Controller & crawlJournals service level) ---
    'init_start': overallProcessHandlers.handleCrawlJournalsInitStart, // from crawlJournals
    'crawl_summary': overallProcessHandlers.handleCrawlJournalsSummary, // from crawlJournals
    'crawl_end': overallProcessHandlers.handleCrawlJournalsEnd, // from crawlJournals
    'crawl_fatal_error': overallProcessHandlers.handleCrawlJournalsFatalError, // from crawlJournals
    'journal_processing_failed_in_controller': overallProcessHandlers.handleControllerProcessingFailed, // from controller

    // --- Playwright Initialization ---
    'browser_launch_start': playwrightHandlers.handleBrowserLaunchStart,
    'browser_launch_success': playwrightHandlers.handleBrowserLaunchSuccess,
    'browser_launch_failed': playwrightHandlers.handleBrowserLaunchFailed, // ASSUMING YOU ADD THIS LOG
    'context_create_start': playwrightHandlers.handleContextCreateStart,
    'context_create_success': playwrightHandlers.handleContextCreateSuccess,
    'context_create_failed': playwrightHandlers.handleContextCreateFailed, // ASSUMING YOU ADD THIS LOG
    'pages_create_start': playwrightHandlers.handlePagesCreateStart,
    'pages_create_success': playwrightHandlers.handlePagesCreateSuccess,
    'pages_create_failed': playwrightHandlers.handlePagesCreateFailed, // ASSUMING YOU ADD THIS LOG
    'browser_close_start': playwrightHandlers.handleBrowserCloseStart,
    'browser_close_success': playwrightHandlers.handleBrowserCloseSuccess,
    'browser_close_failed': playwrightHandlers.handleBrowserCloseFailed,
    'browser_close_skipped': playwrightHandlers.handleBrowserCloseSkipped,


    // --- ApiKeyManager (for Google Search) ---
    'init_error': apiKeyManagerHandlers.handleApiKeyManagerInitError, // Context: ApiKeyManager
    'init_success': apiKeyManagerHandlers.handleApiKeyManagerInitSuccess, // Context: ApiKeyManager
    'usage_limit_reached': apiKeyManagerHandlers.handleApiKeyUsageLimitReached,
    'rotation_delay_start': apiKeyManagerHandlers.handleApiKeyRotationDelayStart,
    'rotation_delay_end': apiKeyManagerHandlers.handleApiKeyRotationDelayEnd,
    'key_provided': apiKeyManagerHandlers.handleApiKeyProvided,
    'force_rotate_skipped': apiKeyManagerHandlers.handleApiKeyForceRotateSkipped,
    'rotation_start': apiKeyManagerHandlers.handleApiKeyRotationStart,
    'rotation_failed_exhausted': apiKeyManagerHandlers.handleApiKeyRotationFailedExhausted,
    'rotation_success': apiKeyManagerHandlers.handleApiKeyRotationSuccess,
    'unexpected_no_key_journal': apiKeyManagerHandlers.handleUnexpectedNoKey, // Specific to journal's ApiKeyManager

    // --- Google Search (for images, from googleSearch.ts) ---
    'fetch_google_image_start': googleSearchHandlers.handleFetchGoogleImageStart,
    'fetch_google_image_skip_missing_creds': googleSearchHandlers.handleFetchGoogleImageSkipMissingCreds,
    // 'fetch_google_image_url': googleSearchHandlers.handleFetchGoogleImageUrl, // Mostly for debug
    'fetch_google_image_attempt_start': googleSearchHandlers.handleFetchGoogleImageAttemptStart, // Info about retries
    'google_api_request_start': googleSearchHandlers.handleGoogleApiRequestStart, // Individual attempt
    'google_api_structured_error': googleSearchHandlers.handleGoogleApiStructuredError,
    'google_api_http_error': googleSearchHandlers.handleGoogleApiHttpError,
    'google_api_request_success': googleSearchHandlers.handleGoogleApiRequestSuccess, // Individual attempt success
    'google_api_axios_error': googleSearchHandlers.handleGoogleApiAxiosError,
    'google_api_unknown_error': googleSearchHandlers.handleGoogleApiUnknownError,
    'fetch_google_image_api_success': googleSearchHandlers.handleFetchGoogleImageApiOverallSuccess, // After retries
    'fetch_google_image_items_found': googleSearchHandlers.handleFetchGoogleImageItemsFound,
    'fetch_google_image_no_items': googleSearchHandlers.handleFetchGoogleImageNoItems,
    'fetch_google_image_failed_after_retries': googleSearchHandlers.handleFetchGoogleImageFailedAfterRetries,
    'fetch_google_image_finish': googleSearchHandlers.handleFetchGoogleImageFinish, // Final outcome for a call

    // --- Scimago Operations (from scimagojr.ts and crawlJournals.ts for Scimago mode) ---
    'scimago_last_page_found': scimagoHandlers.handleScimagoLastPageFound, // from crawlJournals
    'get_last_page_start': scimagoHandlers.handleGetLastPageStart, // from scimagojr.ts
    'get_last_page_success': scimagoHandlers.handleGetLastPageSuccess,
    'get_last_page_failed': scimagoHandlers.handleGetLastPageFailed,
    'get_last_page_finish': scimagoHandlers.handleGetLastPageFinish,
    'process_page_start': scimagoHandlers.handleProcessPageStart, // from scimagojr.ts (processing a list page)
    'process_page_success': scimagoHandlers.handleProcessPageSuccess,
    'process_page_failed': scimagoHandlers.handleProcessPageFailed,
    'process_page_finish': scimagoHandlers.handleProcessPageFinish,
    'fetch_details_skip_null_url': scimagoHandlers.handleFetchDetailsSkipNullUrl, // from scimagojr.ts (processing a detail page)
    'fetch_details_start': scimagoHandlers.handleFetchDetailsStart,
    'fetch_details_success': scimagoHandlers.handleFetchDetailsSuccess,
    'fetch_details_failed': scimagoHandlers.handleFetchDetailsFailed,
    'fetch_details_warn_empty': scimagoHandlers.handleFetchDetailsWarnEmpty,
    'fetch_details_finish': scimagoHandlers.handleFetchDetailsFinish,
    // Events from crawlJournals specific to Scimago mode logic
    'scimago_processing_start': dataSourceHandlers.handleScimagoModeProcessingStart, // Overall start for all scimago URLs
    'scimago_batch_start': dataSourceHandlers.handleScimagoModeBatchStart,
    'scimago_batch_finish': dataSourceHandlers.handleScimagoModeBatchFinish,
    'scimago_processing_error': dataSourceHandlers.handleScimagoModeProcessingError, // Error in the loop of scimago URLs

    // --- Bioxbio Operations (from bioxbio.ts) ---
    'bioxbio_fetch_start': bioxbioHandlers.handleBioxbioFetchStart, // Logged by crawlJournals before calling, and by fetchBioxbioData itself
    'bioxbio_cache_check': bioxbioHandlers.handleBioxbioCacheCheck,
    'bioxbio_cache_hit': bioxbioHandlers.handleBioxbioCacheHit,
    'bioxbio_cache_miss': bioxbioHandlers.handleBioxbioCacheMiss,
    'bioxbio_goto_search_failed': bioxbioHandlers.handleBioxbioGotoSearchFailed,
    'bioxbio_wait_selector_timeout': bioxbioHandlers.handleBioxbioWaitSelectorTimeout, // Often means no result
    'bioxbio_redirect_url_fail_or_not_found': bioxbioHandlers.handleBioxbioRedirectUrlFailOrNotFound,
    'bioxbio_goto_details_failed': bioxbioHandlers.handleBioxbioGotoDetailsFailed,
    'bioxbio_fetch_success_empty_data': bioxbioHandlers.handleBioxbioFetchSuccessEmptyData,
    'bioxbio_fetch_no_match_or_failure': bioxbioHandlers.handleBioxbioFetchNoMatchOrFailure, // No match or other failure before final
    'bioxbio_fetch_failed_final': bioxbioHandlers.handleBioxbioFetchFailedFinal, // Ultimate failure after retries
    'bioxbio_cache_set': bioxbioHandlers.handleBioxbioCacheSet,
    'bioxbio_fetch_finish_overall': bioxbioHandlers.handleBioxbioFetchFinishOverall, // Overall finish for one journal's bioxbio attempt

    // --- Journal Task Level (processing a single journal item) ---
    // These are more specific versions of 'task_start', 'task_success', 'task_failed_unhandled'
    // Event names in log: 'task_start' (with context like process: 'scimago'/'csv', event_group: 'journal_task_scimago'/'journal_task_csv')
    // We can use a single handler and differentiate by context, or map them if event names are distinct.
    // For simplicity, let's assume the event names in log are already distinct or we add specific ones.
    // If they are generic 'task_start', the handler will need to check logEntry.event_group or logEntry.process
    'journal_task_scimago_start': journalTaskHandlers.handleJournalTaskStart, // Assuming you log this event name
    'journal_task_csv_start': journalTaskHandlers.handleJournalTaskStart,    // Assuming you log this event name
    'journal_task_scimago_success': journalTaskHandlers.handleJournalTaskSuccess,
    'journal_task_csv_success': journalTaskHandlers.handleJournalTaskSuccess,
    'journal_task_scimago_failed_unhandled': journalTaskHandlers.handleJournalTaskFailedUnhandled,
    'journal_task_csv_failed_unhandled': journalTaskHandlers.handleJournalTaskFailedUnhandled,
    // Image search events within a task (already covered by Google Search handlers, but journalDetail will be passed)
    'image_search_start': journalTaskHandlers.handleImageSearchStart, // Logged by performImageSearch
    'image_search_skip_exhausted': journalTaskHandlers.handleImageSearchSkipped,
    'image_search_skip_no_key': journalTaskHandlers.handleImageSearchSkipped,
    'image_search_skip_no_cse_id': journalTaskHandlers.handleImageSearchSkipped,
    'image_search_success': journalTaskHandlers.handleImageSearchSuccess, // Logged by performImageSearch
    'image_search_failed': journalTaskHandlers.handleImageSearchFailed,   // Logged by performImageSearch
    'image_search_quota_error': journalTaskHandlers.handleImageSearchQuotaError, // Logged by performImageSearch

    // --- File Output & Data Source Specific (from crawlJournals and utils) ---
    'prepare_output_start': fileOutputHandlers.handlePrepareOutputStart,
    'prepare_output_dir_success': fileOutputHandlers.handlePrepareOutputDirSuccess,
    'prepare_output_file_start': fileOutputHandlers.handlePrepareOutputFileStart,
    'prepare_output_file_success': fileOutputHandlers.handlePrepareOutputFileSuccess,
    'prepare_output_failed': fileOutputHandlers.handlePrepareOutputFailed,
    // Assuming these events are added to appendJournalToFile in journal/utils.ts
    'append_journal_to_file_start': fileOutputHandlers.handleAppendJournalStart,
    'append_journal_to_file_success': fileOutputHandlers.handleAppendJournalSuccess,
    'append_journal_to_file_failed': fileOutputHandlers.handleAppendJournalFailed,
    // Events from crawlJournals specific to client data mode
    'mode_client_start': dataSourceHandlers.handleClientModeStart,
    'client_data_missing': dataSourceHandlers.handleClientDataMissingError, // Error case
    // Assuming these events are added to parseCSVString in journal/utils.ts
    'parse_csv_string_start': dataSourceHandlers.handleParseCsvStart,
    'parse_csv_string_success': dataSourceHandlers.handleParseCsvSuccess,
    'parse_csv_string_failed': dataSourceHandlers.handleParseCsvFailed,
    'client_data_parse_success': dataSourceHandlers.handleClientDataParseOverallSuccess, // From crawlJournals after parseCSVString
    'client_data_empty': dataSourceHandlers.handleClientDataEmpty, // From crawlJournals
    'client_batch_start': dataSourceHandlers.handleClientModeBatchStart,
    'client_batch_finish': dataSourceHandlers.handleClientModeBatchFinish,
    'client_data_processing_error': dataSourceHandlers.handleClientDataProcessingError, // Error in the loop of client data

    // --- Scimago specific events from crawlJournals.ts (related to journal row processing) ---
    // These are within the loop of `processTabScimago`
    'csv_data_parsed': scimagoHandlers.handleScimagoRowCsvParsed, // From processTabScimago
    'csv_data_parse_failed': scimagoHandlers.handleScimagoRowCsvParseFailed, // From processTabScimago
    // 'bioxbio_fetch_start', 'bioxbio_fetch_complete' (logged by processTabScimago) -> Bioxbio handlers will pick these up if journalDetail is available
    // 'details_fetch_start', 'details_fetch_success', 'details_fetch_failed' (logged by processTabScimago) -> Scimago handlers for details

    // --- Client CSV specific events from crawlJournals.ts (related to journal row processing) ---
    // These are within the loop of `processTabCSV`
    'link_generated': dataSourceHandlers.handleClientRowLinkGenerated,
    'link_generation_warning': dataSourceHandlers.handleClientRowLinkGenerationWarning,
    'link_generation_failed': dataSourceHandlers.handleClientRowLinkGenerationFailed,
    'initial_data_populated': dataSourceHandlers.handleClientRowInitialDataPopulated,
    // 'bioxbio_fetch_start', 'bioxbio_fetch_complete' (logged by processTabCSV) -> Bioxbio handlers
    // 'details_fetch_start', 'details_fetch_success', 'details_fetch_failed', 'details_fetch_skipped' (logged by processTabCSV) -> Scimago handlers for details
};