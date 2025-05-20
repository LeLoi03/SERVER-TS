// src/utils/logAnalysis/validationHandlers.ts
import { LogEventHandler } from './index'; // Hoặc đường dẫn chính xác đến file export LogEventHandler
import { ValidationStats, ConferenceAnalysisDetail, LogAnalysisResult } from '../../types/logAnalysis.types'; // Đảm bảo đường dẫn và types chính xác
import { createConferenceKey } from './helpers'; // Đảm bảo đường dẫn chính xác

// Khởi tạo validationStats trong results nếu chưa có
const ensureValidationStats = (results: LogAnalysisResult): ValidationStats => {
    if (!results.validationStats) {
        results.validationStats = {
            totalValidationWarnings: 0,
            warningsByField: {},
            totalNormalizationsApplied: 0,
            normalizationsByField: {},
        };
    }
    return results.validationStats;
};

export const handleValidationWarning: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const stats = ensureValidationStats(results);

    // Lấy các trường từ logEntry, ưu tiên cấp cao nhất, sau đó là context
    const field = (logEntry.field || logEntry.context?.field) as string | undefined;
    const invalidValue = logEntry.invalidValue || logEntry.context?.invalidValue;
    const action = (logEntry.action || logEntry.context?.action) as string | undefined;
    const normalizedTo = logEntry.normalizedTo || logEntry.context?.normalizedTo;
    const reason = logEntry.reason || logEntry.context?.reason || logEntry.msg; // msg có thể chứa lý do

    const currentBatchRequestId = logEntry.batchRequestId || logEntry.requestId;
    const acronym = logEntry.conferenceAcronym || logEntry.context?.conferenceAcronym;
    const title = logEntry.conferenceTitle || logEntry.context?.conferenceTitle;

    stats.totalValidationWarnings++;

    if (field) {
        stats.warningsByField[field] = (stats.warningsByField[field] || 0) + 1;
    } else {
        stats.warningsByField['unknown_field_or_general_warning'] = (stats.warningsByField['unknown_field_or_general_warning'] || 0) + 1;
    }

    // Cập nhật chi tiết cho conference cụ thể nếu có thể xác định
    if (currentBatchRequestId && acronym && title) {
        const compositeKey = createConferenceKey(currentBatchRequestId, acronym, title);
        if (compositeKey && results.conferenceAnalysis[compositeKey]) {
            const confDetailToUpdate = results.conferenceAnalysis[compositeKey] as ConferenceAnalysisDetail;
            if (!confDetailToUpdate.validationIssues) {
                confDetailToUpdate.validationIssues = [];
            }
            confDetailToUpdate.validationIssues.push({
                field: field || 'general', // Nếu không có field cụ thể, coi là general warning
                value: invalidValue,
                action: action || 'unknown_action',
                normalizedTo: normalizedTo,
                // reason: reason || 'No specific reason provided',
                timestamp: entryTimestampISO
            });
        }
    }
};

export const handleNormalizationApplied: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const stats = ensureValidationStats(results);

    // Lấy các trường từ logEntry, ưu tiên cấp cao nhất
    const field = (logEntry.field || logEntry.context?.field) as string | undefined;
    const reason = logEntry.reason || logEntry.context?.reason;
    // const originalValue = logEntry.originalValue || logEntry.context?.originalValue;
    // const normalizedValue = logEntry.normalizedValue || logEntry.context?.normalizedValue;

    // Không cần lấy conferenceAcronym, conferenceTitle, batchRequestId ở đây
    // vì handler này chủ yếu cập nhật stats tổng.
    // Nếu normalization cũng là một validation warning (ví dụ: giá trị không hợp lệ được chuẩn hóa),
    // thì `handleValidationWarning` sẽ ghi lại chi tiết vào conference.

    stats.totalNormalizationsApplied++;

    if (field) {
        stats.normalizationsByField[field] = (stats.normalizationsByField[field] || 0) + 1;
    } else {
        stats.normalizationsByField['unknown_field'] = (stats.normalizationsByField['unknown_field'] || 0) + 1;
    }

    // Thông tin chi tiết về việc normalization (originalValue, normalizedValue, reason)
    // sẽ được ghi vào `confDetail.validationIssues` bởi `handleValidationWarning` nếu
    // `normalization_applied` được log cùng với `validation_warning` hoặc là kết quả của một validation.
    // Nếu `normalization_applied` là một event độc lập (ví dụ: luôn chuẩn hóa trường trống mà không coi là warning),
    // thì việc không ghi vào `confDetail.validationIssues` ở đây là hợp lý.
    // Dựa trên log của bạn, event `normalization_applied` có vẻ là một hành động độc lập, ví dụ:
    // `{"event":"normalization_applied","field":"publisher","originalValue":"","normalizedValue":"No publisher","reason":"empty_value",...}`
    // Trong trường hợp này, nó không nhất thiết là một "issue" mà là một bước xử lý dữ liệu.
    // Nếu bạn muốn theo dõi cụ thể từng lần normalization cho từng conference, bạn có thể thêm logic tương tự như `handleValidationWarning`
    // để tìm `confDetail` và thêm vào một mảng riêng (ví dụ: `confDetail.normalizationsApplied`).
    // Tuy nhiên, để đơn giản, hiện tại chỉ cập nhật stats tổng.
};