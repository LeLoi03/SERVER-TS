// src/utils/logAnalysis/finalizers/request.finalizer.ts

import { ConferenceAnalysisDetail, FileOutputAnalysis, RequestLogData, RequestTimings } from '../../../types/logAnalysis';

export function finalizeRequest(
    request: RequestTimings,
    childConferences: ConferenceAnalysisDetail[],
    requestLogData: RequestLogData | undefined,


): void {
    // --- LOGIC 1-6: GIỮ NGUYÊN ---
    if (requestLogData && requestLogData.startTime !== null && requestLogData.endTime !== null) {
        request.startTime = new Date(requestLogData.startTime).toISOString();
        request.endTime = new Date(requestLogData.endTime).toISOString();
        request.durationSeconds = Math.round((requestLogData.endTime - requestLogData.startTime) / 1000);
    }

    if (requestLogData?.description) {
        request.description = requestLogData.description;
    }
    if (requestLogData?.originalRequestId) {
        request.originalRequestId = requestLogData.originalRequestId;
    }

    const requestErrorMessages = new Set<string>();
    childConferences.forEach(conf => {
        if (conf.errors && conf.errors.length > 0) {
            requestErrorMessages.add(`Conference '${conf.acronym}': ${conf.errors[0].message}`);
        }
    });
    request.errorMessages = Array.from(requestErrorMessages).slice(0, 5);

    let numCompleted = 0, numProcessedOk = 0, numProcessing = 0, numFailed = 0, numSkipped = 0;
    let processedConferencesCount = 0;

    for (const conf of childConferences) {
        if (conf.status === 'completed') { numCompleted++; processedConferencesCount++; }
        else if (conf.status === 'processed_ok') { numProcessedOk++; processedConferencesCount++; }
        else if (conf.status === 'processing') { numProcessing++; }
        else if (conf.status === 'failed') { numFailed++; }
        else if (conf.status === 'skipped') { numSkipped++; }
    }
    request.totalConferencesInputForRequest = childConferences.length;
    request.processedConferencesCountForRequest = processedConferencesCount;

    if (childConferences.length === 0) {
        request.status = (requestLogData && Array.isArray(requestLogData.logs) && requestLogData.logs.length > 0) ? 'Completed' : 'NoData';
    } else {
        const totalTasks = childConferences.length;

        if (numProcessing > 0 || numProcessedOk > 0) {
            request.status = 'Processing';
        } else if (numFailed === totalTasks) {
            request.status = 'Failed';
        } else if (numFailed > 0) {
            request.status = 'CompletedWithErrors';
        } else if (numCompleted === totalTasks || (numCompleted + numSkipped) === totalTasks) {
            request.status = 'Completed';
        } else if (numSkipped === totalTasks) {
            request.status = 'Skipped';
        } else if (numCompleted > 0 || numSkipped > 0) {
            request.status = 'PartiallyCompleted';
        } else {
            request.status = 'Unknown';
        }
    }

    if (!request.startTime || !request.endTime) {
        if (childConferences.length > 0) {
            let minStartTime: number | null = null;
            let maxEndTime: number | null = null;
            childConferences.forEach(conf => {
                if (conf.startTime) minStartTime = Math.min(new Date(conf.startTime).getTime(), minStartTime ?? Infinity);
                if (conf.endTime) maxEndTime = Math.max(new Date(conf.endTime).getTime(), maxEndTime ?? -Infinity);
            });
            if (minStartTime) request.startTime = new Date(minStartTime).toISOString();
            if (maxEndTime) request.endTime = new Date(maxEndTime).toISOString();
            if (minStartTime && maxEndTime) {
                request.durationSeconds = Math.round((maxEndTime - minStartTime) / 1000);
            }
        }
    }

    // --- LOGIC 7: BỔ SUNG TÍNH TOÁN VÀ LÀM GIÀU DỮ LIỆU THỜI GIAN ---
    // Sử dụng `any` để thêm các trường động vào đối tượng request cho mục đích hiển thị.
    const displayRequest = request as any;

    // Chỉ tính toán nếu có tổng thời gian
    if (request.durationSeconds && request.durationSeconds > 0) {
        const totalDurationMs = request.durationSeconds * 1000;

        // 7.1. Tính toán thời gian xử lý task chính
        if (typeof request.allTasksCompletionDurationMs === 'number') {
            const percentage = (request.allTasksCompletionDurationMs / totalDurationMs) * 100;
            displayRequest.taskProcessingTimePercentage = percentage.toFixed(1) + '%';
        }

        // 7.2. Tính toán thời gian "overhead" (không phải xử lý task)
        const initMs = request.initializationDurationMs ?? 0;
        const queueMs = request.taskQueueingDurationMs ?? 0;
        const finalMs = request.finalProcessingDurationMs ?? 0;
        const overheadMs = initMs + queueMs + finalMs;

        if (overheadMs > 0) {
            const percentage = (overheadMs / totalDurationMs) * 100;
            displayRequest.overheadTimePercentage = percentage.toFixed(1) + '%';
        }

        // 7.3. Tính toán thời gian "chờ đợi" hoặc "không xác định"
        // Đây là thời gian không thuộc overhead và cũng không thuộc xử lý task.
        // Nó có thể bao gồm thời gian cleanup, playwright init/close, v.v.
        const taskMs = request.allTasksCompletionDurationMs ?? 0;
        if (taskMs > 0 || overheadMs > 0) {
            const unaccountedMs = totalDurationMs - taskMs - overheadMs;
            if (unaccountedMs > 0) {
                const percentage = (unaccountedMs / totalDurationMs) * 100;
                displayRequest.unaccountedTimePercentage = percentage.toFixed(1) + '%';
            }
        }
    }

    // 7.4. Tính toán thông lượng (throughput)
    if (request.processedConferencesCountForRequest && request.processedConferencesCountForRequest > 0 && request.durationSeconds && request.durationSeconds > 0) {
        // Số giây trên mỗi conference
        const secondsPerConf = request.durationSeconds / request.processedConferencesCountForRequest;
        displayRequest.throughputSecondsPerConf = parseFloat(secondsPerConf.toFixed(2));

        // Số conference trên mỗi phút
        const confsPerMinute = (request.processedConferencesCountForRequest / request.durationSeconds) * 60;
        displayRequest.throughputConfsPerMinute = parseFloat(confsPerMinute.toFixed(2));
    }
    // --- LOGIC 8: (TÙY CHỌN) Đặt giá trị mặc định cho hasCsvOutput ---
    if (typeof request.hasCsvOutput === 'undefined') {
        // Nếu không có log event nào xác định trạng thái CSV,
        // giả định là không có file.
        request.hasCsvOutput = false;
    }
}