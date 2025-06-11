// src/utils/logAnalysis/playwrightHandlers/index.ts

/**
 * This file serves as the single entry point for all Playwright related log event handlers.
 * It aggregates handlers from different modules into a single map for the main dispatcher.
 */

import { LogEventHandler } from '../index';
import {
    handleSaveHtmlConferenceStart,
    handleSaveHtmlConferenceSkipped,
    handleSaveHtmlConferenceSuccess,
    handleSaveHtmlConferenceFailed,
} from './htmlSave.handlers';
import {
    handleLinkProcessingAttempt,
    handleLinkProcessingSuccess,
    handleLinkProcessingFailed,
    handleLinkRedirectDetected,
    handleOtherPlaywrightFailure,
} from './linkProcessing.handlers';
import {
    handlePlaywrightGlobalInitStart,
    handlePlaywrightGlobalInitSuccess,
    handlePlaywrightGlobalInitFailed,
    handlePlaywrightGetContextFailed,
} from './setup.handlers';

export const playwrightEventHandlers: { [key: string]: LogEventHandler } = {
    // Global Setup
    'playwright_global_init_start': handlePlaywrightGlobalInitStart,
    'playwright_global_init_success': handlePlaywrightGlobalInitSuccess,
    'playwright_global_init_failed': handlePlaywrightGlobalInitFailed,
    'playwright_get_context_failed_not_initialized': handlePlaywrightGetContextFailed,
    'html_persistence_set_context_failed': handlePlaywrightGetContextFailed,

    // HTML Saving Lifecycle
    'process_save_start': handleSaveHtmlConferenceStart,
    'process_save_skipped_no_links': handleSaveHtmlConferenceSkipped,
    'process_save_delegation_initiated': handleSaveHtmlConferenceSuccess,
    'process_save_delegation_initiation_failed': handleSaveHtmlConferenceFailed,
    'process_save_delegation_error': handleSaveHtmlConferenceFailed,

    // Individual Link Processing
    'single_link_processing_start': handleLinkProcessingAttempt,
    'single_link_processing_success': handleLinkProcessingSuccess,
    'single_link_processing_failed_to_access_link': handleLinkProcessingFailed,
    'single_link_processing_unhandled_error': handleLinkProcessingFailed,
    'link_redirect_detected': handleLinkRedirectDetected, // Assuming this event exists

    // Other/Generic Failures (often related to link processing)
    'html_processing_failed': handleOtherPlaywrightFailure,
    'goto_failed': handleOtherPlaywrightFailure,
    'fetch_content_failed': handleOtherPlaywrightFailure,
    'unexpected_error': handleOtherPlaywrightFailure,
};