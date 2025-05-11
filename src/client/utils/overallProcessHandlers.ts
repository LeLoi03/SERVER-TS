// src/client/utils/eventHandlers/overallProcessHandlers.ts
import { LogEventHandler } from './commonHandlers';
import { createConferenceKey } from './helpers';
// import { logger } from '../../../conference/11_utils'; // Chỉ import nếu dùng

export const handleCrawlStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (!results.overall.startTime) results.overall.startTime = logEntry.context?.startTime ?? entryTimestampISO;
    if (logEntry.context?.totalConferences) {
        results.overall.totalConferencesInput++;
    }
};


export const handleCrawlEndSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (logEntry.route === '/crawl-conferences' && logEntry.event === 'processing_finished_successfully' && logEntry.results && Array.isArray(logEntry.results) && logEntry.results.length > 0) {

        logEntry.results.forEach((result: any) => {
            const acronym = result?.acronym;
            const title = result?.title;
            const compositeKey = createConferenceKey(acronym, title);

            if (compositeKey && results.conferenceAnalysis[compositeKey]) {
                if (!results.conferenceAnalysis[compositeKey].finalResultPreview) {
                    results.conferenceAnalysis[compositeKey].finalResultPreview = result;
                    // logger.trace({ ...logContext, event: 'capture_result__end', compositeKey: compositeKey }, 'Captured final result from processing_finished_successfully');
                }
            } else if (acronym || title) {
                // logger.warn({ ...logContext, event: 'capture_result_end_miss', acronym, title }, "Found result in processing_finished_successfully but no matching analysis entry OR missing info for composite key");
            }
        });
    }
};
