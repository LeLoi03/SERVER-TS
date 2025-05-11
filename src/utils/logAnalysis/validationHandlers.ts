// src/client/utils/eventHandlers/validationHandlers.ts
import { LogEventHandler } from './index';
import { ValidationStats } from '../types/logAnalysis.types'; // Giả sử bạn có type này

// Khởi tạo validationStats trong results nếu chưa có
const ensureValidationStats = (results: any): ValidationStats => {
    if (!results.validationStats) {
        results.validationStats = {
            totalValidationWarnings: 0,
            warningsByField: {},
            totalNormalizationsApplied: 0,
            normalizationsByField: {},
        };
    }
    return results.validationStats as ValidationStats;
};

export const handleValidationWarning: LogEventHandler = (logEntry, results, confDetailFromInput, entryTimestampISO, logContext) => {
    const stats = ensureValidationStats(results);
    const field = logEntry.context?.field as string | undefined;
    const invalidValue = logEntry.context?.invalidValue;
    const action = logEntry.context?.action as string | undefined;
    const normalizedTo = logEntry.context?.normalizedTo; // Giá trị mới

    // Tìm confDetail dựa trên context của logEntry
    const confKey = logEntry.context?.conferenceAcronym && logEntry.context?.conferenceTitle ?
                    `${logEntry.context.conferenceAcronym}_${logEntry.context.conferenceTitle}` : null;
    const confDetail = confKey ? results.conferenceAnalysis[confKey] : null;


    stats.totalValidationWarnings++;

    if (field) {
        stats.warningsByField[field] = (stats.warningsByField[field] || 0) + 1;
    } else {
        stats.warningsByField['unknown_field'] = (stats.warningsByField['unknown_field'] || 0) + 1;
    }

    if (confDetail && field) {
        if (!confDetail.validationIssues) {
            confDetail.validationIssues = [];
        }
        confDetail.validationIssues.push({
            field: field,
            value: invalidValue,
            action: action || 'unknown',
            normalizedTo: normalizedTo, // Thêm trường này
            timestamp: entryTimestampISO
        });
    }
};

export const handleNormalizationApplied: LogEventHandler = (logEntry, results, confDetailFromInput, entryTimestampISO, logContext) => {
    const stats = ensureValidationStats(results);
    const field = logEntry.context?.field as string | undefined;
    // const reason = logEntry.context?.reason; // Có thể dùng để phân loại thêm nếu cần

    // Tìm confDetail (không bắt buộc cho handler này, vì nó chủ yếu cập nhật stats tổng)
    // const confKey = logEntry.context?.conferenceAcronym && logEntry.context?.conferenceTitle ?
    //                 `${logEntry.context.conferenceAcronym}_${logEntry.context.conferenceTitle}` : null;
    // const confDetail = confKey ? results.conferenceAnalysis[confKey] : null;

    stats.totalNormalizationsApplied++;

    if (field) {
        stats.normalizationsByField[field] = (stats.normalizationsByField[field] || 0) + 1;
    } else {
        stats.normalizationsByField['unknown_field'] = (stats.normalizationsByField['unknown_field'] || 0) + 1;
    }

    // Không nhất thiết phải thêm vào confDetail.validationIssues vì 'validation_warning' đã làm điều đó
    // khi normalization xảy ra do invalid value. Nếu normalization xảy ra do empty value,
    // có thể không cần ghi vào validationIssues của conference cụ thể.
};