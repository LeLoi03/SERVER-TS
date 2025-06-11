// src/utils/logAnalysis/validationHandlers/warning.handlers.ts

/**
 * Handles events related to data validation warnings.
 */

import { LogEventHandler } from '../index';
import { createConferenceKey } from '../helpers';
import { DataQualityInsight } from '../../../types/logAnalysis';
import { ensureValidationStats } from './helpers';

export const handleValidationWarning: LogEventHandler = (logEntry, results, _irrelevantConfDetail, entryTimestampISO) => {
    const stats = ensureValidationStats(results);

    const field = (logEntry.field || logEntry.context?.field) as string | undefined;
    const invalidValue = logEntry.invalidValue || logEntry.context?.invalidValue;
    const action = (logEntry.action || logEntry.context?.action) as string | undefined;
    const normalizedTo = logEntry.normalizedTo || logEntry.context?.normalizedTo;
    const reasonMsgFromLog = logEntry.reason || logEntry.msg || "Validation warning";
    const ruleViolated = (logEntry.ruleViolated || logEntry.context?.ruleViolated) as string | undefined;

    let severity: 'Low' | 'Medium' | 'High' = 'Low';
    if (field === 'year' && action === 'logged_only') severity = 'Medium';
    if (field === 'continent' && action === 'normalized' && invalidValue) severity = 'Medium';
    if (logEntry.severity) {
        const logSeverity = String(logEntry.severity).toLowerCase();
        if (logSeverity === 'high') severity = 'High';
        else if (logSeverity === 'medium') severity = 'Medium';
    }

    stats.totalValidationWarnings++;
    if (field) {
        stats.warningsByField[field] = (stats.warningsByField[field] || 0) + 1;
    } else {
        stats.warningsByField['unknown_field_or_general_warning'] = (stats.warningsByField['unknown_field_or_general_warning'] || 0) + 1;
    }
    stats.warningsBySeverity[severity] = (stats.warningsBySeverity[severity] || 0) + 1;
    const standardizedMessage = field ? `Field '${field}': ${reasonMsgFromLog}` : reasonMsgFromLog;
    stats.warningsByInsightMessage[standardizedMessage] = (stats.warningsByInsightMessage[standardizedMessage] || 0) + 1;

    const currentBatchRequestId = logEntry.batchRequestId || logEntry.requestId;
    const acronym = logEntry.conferenceAcronym || logEntry.context?.conferenceAcronym;
    const title = logEntry.conferenceTitle || logEntry.context?.conferenceTitle;

    if (currentBatchRequestId && acronym && title) {
        const compositeKey = createConferenceKey(currentBatchRequestId, acronym, title);
        if (compositeKey && results.conferenceAnalysis[compositeKey]) {
            const confDetailToUpdate = results.conferenceAnalysis[compositeKey]!;
            if (!confDetailToUpdate.dataQualityInsights) {
                confDetailToUpdate.dataQualityInsights = [];
            }

            const insight: DataQualityInsight = {
                timestamp: entryTimestampISO,
                field: field || 'general',
                originalValue: invalidValue,
                currentValue: action === 'normalized' ? normalizedTo : invalidValue,
                insightType: 'ValidationWarning',
                severity: severity,
                message: standardizedMessage,
                details: {
                    actionTaken: action || 'unknown_action',
                    normalizedTo: action === 'normalized' ? normalizedTo : undefined,
                    ruleViolated: ruleViolated,
                }
            };
            confDetailToUpdate.dataQualityInsights.push(insight);
        }
    }
};