// src/utils/logAnalysis/overallProcessHandlers/globalLifecycle.handlers.ts

/**
 * Handles events that affect the global state of the entire analysis process.
 */

import { LogEventHandler } from '../index';
import { ensureOverallAnalysis } from './helpers';

export const handleCrawlStart: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const currentEventStartTime = logEntry.context?.operationStartTime || entryTimestampISO;
    if (!overall.startTime || new Date(currentEventStartTime) < new Date(overall.startTime)) {
        overall.startTime = currentEventStartTime;
    }
    const totalConferences = logEntry.context?.totalConferences ?? logEntry.totalConferences;
    if (typeof totalConferences === 'number') {
        overall.totalConferencesInput = (overall.totalConferencesInput || 0) + totalConferences;
    }
};