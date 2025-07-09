// src/types/logAnalysisChatbot/logAnalysisChatbot.types.ts

/**
 * Đại diện cho một cặp câu hỏi-trả lời từ file test của client.
 */
export interface ChatbotClientTestEntry {
    frontendMessageId: string;
    payload: {
        question: string;
        model?: string;
    };
    status: 'SUCCESS' | 'ERROR' | 'TIMEOUT';
    roundTripTime_ms?: number;
    error?: string;
    response?: string;
}

/**
 * Đại diện cho một log entry hiệu năng từ server.
 */
export interface ChatbotServerPerfLog {
    level: string;
    time: string;
    event: 'performance_log';
    stage: 'request_received' | 'ai_call_start' | 'ai_call_end' | 'response_completed';
    requestId: string;
    userId: string;
    conversationId: string;
    details?: {
        isStreaming?: boolean;
        language?: string;
        model?: string; // Model được yêu cầu từ client
        messageLength?: number;
        hasPageContext?: boolean;
        turn?: number;
        requestedModel?: string; // Model được yêu cầu (từ log ai_call_start)
        actualModel?: string;   // Model thực sự được dùng
    };
    metrics?: {
        totalServerDuration_ms?: number;
        prepDuration_ms?: number;
        aiCallDuration_ms?: number;
        postProcessingDuration_ms?: number;
        duration_ms?: number; // Thời gian của một lần gọi AI
    };
    msg: string;
}

/**
 * Dữ liệu được hợp nhất cho một request hoàn chỉnh.
 */
export interface AnalyzedChatbotRequest {
    requestId: string;
    status: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'INCOMPLETE'; // INCOMPLETE: có log server nhưng không có kết quả client
    startTime: string; // Thời gian bắt đầu từ log 'request_received'
    
    // Dữ liệu từ Client
    question: string;
    clientRequestedModel?: string;
    clientResponse?: string;
    clientError?: string;
    
    // Dữ liệu từ Server
    serverMetrics: {
        roundTripTime_ms?: number; // Từ client
        networkAndQueueTime_ms?: number; // roundTrip - totalServer
        totalServerDuration_ms?: number;
        prepDuration_ms?: number;
        aiCallDuration_ms?: number;
        postProcessingDuration_ms?: number;
    };
    
    // Chi tiết về các lần gọi AI
    aiCalls: {
        turn: number;
        requestedModel?: string;
        actualModel?: string;
        duration_ms?: number;
    }[];
}

/**
 * Kết quả cuối cùng của toàn bộ quá trình phân tích.
 */
export interface ChatbotLogAnalysisResult {
    status: 'success' | 'error' | 'partial_success';
    errorMessage?: string;
    analysisStartTime: string;
    analysisEndTime: string;
    totalFilesAnalyzed: number;
    totalRequestsFound: number;
    analyzedRequests: AnalyzedChatbotRequest[];
    summary: {
        successCount: number;
        errorCount: number;
        timeoutCount: number;
        incompleteCount: number;
        averageResponseTime_ms: number; // Trung bình của roundTripTime_ms
        averageServerTime_ms: number; // Trung bình của totalServerDuration_ms
        averageAiTime_ms: number; // Trung bình của aiCallDuration_ms
        requestsByModel: {
            [modelName: string]: {
                count: number;
                avgResponseTime_ms: number;
            }
        }
    };
}