// src/client/utils/eventHandlers/validationHandlers.ts
import { LogEventHandler } from './commonHandlers';
// import { logger } from '../../../conference/11_utils'; // Chỉ import nếu dùng


export const handleValidationWarning: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const field = logEntry.context?.field; // Lấy tên trường bị cảnh báo
    const invalidValue = logEntry.context?.invalidValue;
    const action = logEntry.context?.action; // 'normalized' or 'logged_only'

    // Cập nhật thống kê tổng thể
    results.validationStats.totalValidationWarnings++;

    if (field && typeof field === 'string') {
        // Đếm số lượng cảnh báo cho từng trường cụ thể
        results.validationStats.warningsByField[field] = (results.validationStats.warningsByField[field] || 0) + 1;
    } else {
        // Nếu không có tên trường, có thể đếm vào một mục chung 'unknown_field'
        results.validationStats.warningsByField['unknown_field'] = (results.validationStats.warningsByField['unknown_field'] || 0) + 1;
        // logger.warn({ ...logContext, event: 'validation_warning_missing_field' }, 'Validation warning log entry is missing the "field" property.');
    }

    // Optional: Thêm thông tin chi tiết vào conference detail nếu muốn

    if (confDetail && field) {
        if (!confDetail.validationIssues) {
            confDetail.validationIssues = [];
        }
        confDetail.validationIssues.push({
            field: field,
            value: invalidValue,
            action: action || 'unknown',
            timestamp: entryTimestampISO
        });
    }

    // logger.trace({ ...logContext, event: 'processed_validation_warning', field: field, action: action }, 'Processed validation warning event.');
};


// Handler cho normalization (chỉ thêm nếu bạn log event 'normalization_applied')
export const handleNormalizationApplied: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const field = logEntry.context?.field;
    const reason = logEntry.context?.reason; // 'empty_value', 'invalid_value', etc.

    results.validationStats.totalNormalizationsApplied++;

    if (field && typeof field === 'string') {
        results.validationStats.normalizationsByField[field] = (results.validationStats.normalizationsByField[field] || 0) + 1;
    } else {
        results.validationStats.normalizationsByField['unknown_field'] = (results.validationStats.normalizationsByField['unknown_field'] || 0) + 1;
        // logger.warn({ ...logContext, event: 'normalization_applied_missing_field' }, 'Normalization applied log entry is missing the "field" property.');
    }

    // logger.trace({ ...logContext, event: 'processed_normalization_applied', field: field, reason: reason }, 'Processed normalization applied event.');
};
