// src/utils/logAnalysis/validationHandlers/normalization.handlers.ts

/**
 * Handles events related to the automatic normalization of data fields.
 */

import { LogEventHandler } from '../index';
import { createConferenceKey } from '../utils';
import { DataQualityInsight } from '../../../types/logAnalysis';
import { ensureValidationStats } from './helpers';

export const handleNormalizationApplied: LogEventHandler = (logEntry, results, _irrelevantConfDetail, entryTimestampISO) => {
    const stats = ensureValidationStats(results);

    // This logic prevents double-counting when a validation warning also results in a normalization.
    // The warning handler already captures all necessary details.
    if (logEntry.event === 'validation_warning' && logEntry.action === 'normalized') {
        return;
    }

    const field = (logEntry.field || logEntry.context?.field) as string | undefined;
    const reason = (logEntry.reason || logEntry.context?.reason) as string | undefined;
    const originalValueFromLog = logEntry.originalValue !== undefined ? logEntry.originalValue : logEntry.context?.originalValue;
    const normalizedValueFromLog = logEntry.normalizedValue !== undefined ? logEntry.normalizedValue : logEntry.context?.normalizedValue;
    const messageFromLog = logEntry.msg || (field ? `Normalized field '${field}' due to ${reason || 'default rule'}` : 'Normalization applied');
    const ruleApplied = (logEntry.ruleApplied || logEntry.context?.ruleApplied) as string | undefined;

    stats.totalNormalizationsApplied++;
    if (field) {
        stats.normalizationsByField[field] = (stats.normalizationsByField[field] || 0) + 1;
    } else {
        stats.normalizationsByField['unknown_field_or_general_normalization'] = (stats.normalizationsByField['unknown_field_or_general_normalization'] || 0) + 1;
    }
    const reasonKey = reason || 'unknown_reason';
    stats.normalizationsByReason[reasonKey] = (stats.normalizationsByReason[reasonKey] || 0) + 1;

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
                field: field || 'unknown',
                originalValue: originalValueFromLog,
                currentValue: normalizedValueFromLog,
                insightType: 'NormalizationApplied',
                message: messageFromLog,
                details: {
                    actionTaken: `Normalized (reason: ${reason || 'default'})`,
                    normalizedTo: normalizedValueFromLog,
                    ruleViolated: ruleApplied,
                }
            };
            confDetailToUpdate.dataQualityInsights.push(insight);
        }
    }
};