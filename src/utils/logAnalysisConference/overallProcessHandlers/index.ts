// src/utils/logAnalysis/overallProcessHandlers/index.ts

import { LogEventHandler } from '../index';
// Giữ các import cũ
import { handleCrawlStart } from './globalLifecycle.handlers';
import { handleReceivedRequest, handleControllerProcessingFinished } from './requestLifecycle.handlers';
// Thêm import mới
import { handleOrchestratorStart, handleRequestDurationEvent, handleRequestCompleted } from './orchestratorTiming.handlers';

export const overallProcessEventHandlers: { [key: string]: LogEventHandler } = {
    // Các handler cũ
    'received_request': handleReceivedRequest,
    'crawl_orchestrator_start': handleCrawlStart, // Giữ lại vì nó xử lý global
    'processing_finished_successfully': handleControllerProcessingFinished,
    'processing_failed_in_controller': handleControllerProcessingFinished,
    'processing_failed_in_controller_scope': handleControllerProcessingFinished,

    // --- BỔ SUNG CÁC HANDLER MỚI ---
    'ORCHESTRATOR_START': handleOrchestratorStart, // Event mới để tính initialization
    'ALL_TASKS_QUEUED': handleRequestDurationEvent,
    'ALL_TASKS_COMPLETED': handleRequestDurationEvent,
    'FINAL_PROCESSING_END': handleRequestDurationEvent,
    'ORCHESTRATOR_END': handleRequestDurationEvent, // Event mới để lấy tổng thời gian orchestrator
    'REQUEST_COMPLETED': handleRequestCompleted,
    'REQUEST_COMPLETED_ASYNC': handleRequestCompleted,
};