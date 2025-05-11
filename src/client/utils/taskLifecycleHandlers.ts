// src/client/utils/eventHandlers/taskLifecycleHandlers.ts
import { LogEventHandler } from './commonHandlers'; // Hoặc từ './index'
// import { logger } from '../../../conference/11_utils'; // Chỉ import nếu dùng

import { normalizeErrorKey, addConferenceError } from './helpers';

export const handleTaskStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (confDetail) {
        if (!confDetail.startTime) {
            confDetail.startTime = entryTimestampISO;
        }
        if (confDetail.status === 'unknown') {
            confDetail.status = 'processing';
            // logger.trace({ ...logContext, event: 'analysis_status_set_processing' }, 'Set conference status to processing.');
        }
    }
};

export const handleTaskCrawlStageFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (confDetail) {
        confDetail.crawlEndTime = entryTimestampISO;
        confDetail.crawlSucceededWithoutError = logEntry.status !== false;
        // logger.trace({ ...logContext, event: 'analysis_crawl_stage_finish', crawlSucceeded: confDetail.crawlSucceededWithoutError }, 'Noted crawl stage finish (task_finish).');
    }

};

export const handleTaskUnhandledError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Task failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
    }
};
