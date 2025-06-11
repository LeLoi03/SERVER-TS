// src/utils/logAnalysis/taskLifecycleHandlers/info.handlers.ts

/**
 * Handles events that provide additional information about a task without changing its primary status.
 */

import { LogEventHandler } from '../index';

export const handleRecrawlDetected: LogEventHandler = (logEntry, results, confDetail) => {
    const originalRequestId = logEntry.originalRequestId as string | undefined;
    if (confDetail && originalRequestId) {
        if (!confDetail.originalRequestId) {
            confDetail.originalRequestId = originalRequestId;
        }
    }
};