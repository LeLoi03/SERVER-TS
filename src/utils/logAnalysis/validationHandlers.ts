// src/utils/logAnalysis/validationHandlers.ts
import { LogEventHandler } from './index';
import { ValidationStats, LogAnalysisResult, DataQualityInsight, getInitialValidationStats } from '../../types'; // Đảm bảo DataQualityInsight đã được export
import { createConferenceKey } from './helpers';

const ensureValidationStats = (results: LogAnalysisResult): ValidationStats => {
    if (!results.validationStats) {
        results.validationStats = getInitialValidationStats();
    }
    results.validationStats.warningsBySeverity = results.validationStats.warningsBySeverity || { Low: 0, Medium: 0, High: 0 };
    results.validationStats.warningsByInsightMessage = results.validationStats.warningsByInsightMessage || {};
    results.validationStats.normalizationsByReason = results.validationStats.normalizationsByReason || {};
    return results.validationStats;
};


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
        // SỬA LỖI Ở ĐÂY: Kiểm tra compositeKey không phải là null
        if (compositeKey && results.conferenceAnalysis[compositeKey]) {
            const confDetailToUpdate = results.conferenceAnalysis[compositeKey]!; // Thêm ! vì đã kiểm tra null
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
        } else if (compositeKey === null) {
            // Log hoặc xử lý trường hợp không tạo được compositeKey
            // console.warn("Could not create composite key for validation warning:", logEntry);
        }
    }
};

export const handleNormalizationApplied: LogEventHandler = (logEntry, results, _irrelevantConfDetail, entryTimestampISO) => {
    const stats = ensureValidationStats(results);

    const field = (logEntry.field || logEntry.context?.field) as string | undefined;
    const reason = (logEntry.reason || logEntry.context?.reason) as string | undefined;
    const originalValueFromLog = logEntry.originalValue !== undefined ? logEntry.originalValue : logEntry.context?.originalValue;
    const normalizedValueFromLog = logEntry.normalizedValue !== undefined ? logEntry.normalizedValue : logEntry.context?.normalizedValue;
    const messageFromLog = logEntry.msg || (field ? `Normalized field '${field}' due to ${reason || 'default rule'}` : 'Normalization applied');
    const ruleApplied = (logEntry.ruleApplied || logEntry.context?.ruleApplied) as string | undefined;

    if (logEntry.event === 'validation_warning' && logEntry.action === 'normalized') {
        return;
    }

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
        // SỬA LỖI Ở ĐÂY: Kiểm tra compositeKey không phải là null
        if (compositeKey && results.conferenceAnalysis[compositeKey]) {
            const confDetailToUpdate = results.conferenceAnalysis[compositeKey]!; // Thêm ! vì đã kiểm tra null
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
        } else if (compositeKey === null) {
            // Log hoặc xử lý trường hợp không tạo được compositeKey
            // console.warn("Could not create composite key for normalization event:", logEntry);
        }
    }
};