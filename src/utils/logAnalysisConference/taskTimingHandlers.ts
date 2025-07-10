// src/utils/logAnalysis/taskTimingHandlers.ts

import { LogEventHandler } from './index';

/**
 * A generic handler for events that log the duration of a specific sub-task
 * within a conference's processing lifecycle.
 */
export const handleTaskStepTiming: LogEventHandler = (logEntry, _results, confDetail) => {
    // This handler requires a valid conference detail context.
    if (!confDetail) {
        return;
    }

    const durationMs = logEntry.durationMs as number;
    const event = logEntry.event as string;

    if (typeof durationMs !== 'number') {
        return;
    }

    // Ensure the timings object exists
    if (!confDetail.timings) {
        confDetail.timings = {};
    }

    switch (event) {
        case 'GOOGLE_SEARCH_END':
            confDetail.timings.googleSearchDurationMs = durationMs;
            break;
        case 'PLAYWRIGHT_CRAWL_INITIAL_LINKS_END':
            confDetail.timings.crawlInitialLinksDurationMs = durationMs;
            break;
        case 'PLAYWRIGHT_CRAWL_UPDATE_LINKS_END':
            confDetail.timings.crawlUpdateLinksDurationMs = durationMs;
            break;
        case 'API_DETERMINE_LINKS_END':
            confDetail.timings.apiDetermineLinksDurationMs = durationMs;
            break;
        case 'PLAYWRIGHT_CRAWL_DETERMINED_LINKS_END':
            confDetail.timings.crawlDeterminedLinksDurationMs = durationMs;
            break;
        case 'API_FINAL_EXTRACTION_END':
            confDetail.timings.apiFinalExtractionDurationMs = durationMs;
            break;
        // Add other detailed timing events here if needed in the future
    }
};