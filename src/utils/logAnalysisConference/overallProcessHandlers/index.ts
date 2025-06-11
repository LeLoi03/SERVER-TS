// src/utils/logAnalysis/overallProcessHandlers/index.ts

/**
 * This file serves as the single entry point for all overall process related log event handlers.
 * It aggregates handlers from different modules into a single map for the main dispatcher.
 */

import { LogEventHandler } from '../index';
import { handleCrawlStart } from './globalLifecycle.handlers';
import { handleReceivedRequest, handleControllerProcessingFinished } from './requestLifecycle.handlers';

export const overallProcessEventHandlers: { [key: string]: LogEventHandler } = {
    'received_request': handleReceivedRequest,
    'crawl_orchestrator_start': handleCrawlStart,
    'processing_finished_successfully': handleControllerProcessingFinished,
    'processing_failed_in_controller': handleControllerProcessingFinished,
    'processing_failed_in_controller_scope': handleControllerProcessingFinished, // Assuming this is a valid event
};