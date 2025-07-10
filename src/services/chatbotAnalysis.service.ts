import { singleton, inject } from 'tsyringe';
import fs from 'fs/promises';
import path from 'path';
import { Logger } from 'pino';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import {
    ChatbotLogAnalysisResult,
    ChatbotClientTestEntry,
    ChatbotServerPerfLog,
    AnalyzedChatbotRequest
} from '../types/logAnalysisChatbot/logAnalysisChatbot.types';

@singleton()
export class ChatbotLogAnalysisService {
    private readonly logger: Logger;
    private readonly serverLogPath: string;
    private readonly clientLogPath: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService
    ) {
        this.logger = loggingService.getLogger('chatbot').child({ service: 'ChatbotLogAnalysisService' });
        this.serverLogPath = this.configService.chatbotLogFilePathForWriting;
        this.clientLogPath = this.configService.chatbotClientTestLogDirectoryPath;
    }

    public async performAnalysis(): Promise<ChatbotLogAnalysisResult> {
        const analysisStartTime = new Date().toISOString();
        this.logger.info({
            serverLogPath: this.serverLogPath,
            clientLogPath: this.clientLogPath
        }, 'Starting chatbot log analysis...');

        try {
            const serverLogsMap = await this.parseServerLogs();
            const clientData = await this.parseClientTestLogs();
            const { analyzedRequests, summary } = this.mergeAndAnalyze(serverLogsMap, clientData);

            this.logger.info({ summary }, 'Chatbot log analysis completed successfully.');

            return {
                status: 'success',
                analysisStartTime,
                analysisEndTime: new Date().toISOString(),
                totalFilesAnalyzed: 1 + clientData.fileCount,
                totalRequestsFound: analyzedRequests.length,
                analyzedRequests,
                summary,
            };
        } catch (error: any) {
            this.logger.error({ err: error }, 'An error occurred during chatbot log analysis.');
            return {
                status: 'error',
                errorMessage: error.message,
                analysisStartTime,
                analysisEndTime: new Date().toISOString(),
                totalFilesAnalyzed: 0,
                totalRequestsFound: 0,
                analyzedRequests: [],
                summary: {
                    successCount: 0, errorCount: 0, timeoutCount: 0, incompleteCount: 0,
                    averageResponseTime_ms: 0, averageServerTime_ms: 0, averageAiTime_ms: 0,
                    averageTimeToFirstToken_ms: 0,
                    requestsByModel: {}
                },
            };
        }
    }

    private async parseServerLogs(): Promise<Map<string, ChatbotServerPerfLog[]>> {
        const logMap = new Map<string, ChatbotServerPerfLog[]>();
        try {
            const content = await fs.readFile(this.serverLogPath, 'utf-8');
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.trim() === '') continue;
                try {
                    const log = JSON.parse(line) as ChatbotServerPerfLog;
                    if (log.event === 'performance_log' && log.requestId) {
                        if (!logMap.has(log.requestId)) {
                            logMap.set(log.requestId, []);
                        }
                        logMap.get(log.requestId)!.push(log);
                    }
                } catch { /* Ignore non-JSON lines */ }
            }
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                this.logger.warn({ err, path: this.serverLogPath }, `Could not read or parse server log file.`);
            } else {
                this.logger.info({ path: this.serverLogPath }, `Server log file not found, skipping.`);
            }
        }
        return logMap;
    }

    private async parseClientTestLogs(): Promise<{ entries: ChatbotClientTestEntry[], fileCount: number }> {
        let allEntries: ChatbotClientTestEntry[] = [];
        let fileCount = 0;
        try {
            const files = await fs.readdir(this.clientLogPath);
            const jsonFiles = files.filter(f => f.startsWith('test-results-') && f.endsWith('.json'));
            fileCount = jsonFiles.length;
            for (const file of jsonFiles) {
                const filePath = path.join(this.clientLogPath, file);
                const content = await fs.readFile(filePath, 'utf-8');
                const parsedEntries = JSON.parse(content) as any[];
                const validEntries = parsedEntries.filter(
                    (entry): entry is ChatbotClientTestEntry =>
                        entry && typeof entry.frontendMessageId === 'string' && entry.frontendMessageId.length > 0
                );
                allEntries = allEntries.concat(validEntries);
            }
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                this.logger.warn({ err, path: this.clientLogPath }, `Could not read or parse client test logs.`);
            } else {
                this.logger.info({ path: this.clientLogPath }, `Client test log directory not found, skipping.`);
            }
        }
        return { entries: allEntries, fileCount };
    }

    private mergeAndAnalyze(
        serverLogsMap: Map<string, ChatbotServerPerfLog[]>,
        clientData: { entries: ChatbotClientTestEntry[], fileCount: number }
    ): { analyzedRequests: AnalyzedChatbotRequest[], summary: ChatbotLogAnalysisResult['summary'] } {

        const requestMap = new Map<string, AnalyzedChatbotRequest>();

        // Step 1: Initialize from client logs
        for (const clientEntry of clientData.entries) {
            requestMap.set(clientEntry.frontendMessageId, {
                requestId: clientEntry.frontendMessageId,
                status: clientEntry.status,
                startTime: new Date(Date.now() - (clientEntry.roundTripTime_ms || 0)).toISOString(),
                question: clientEntry.payload.question,
                clientRequestedModel: clientEntry.payload.model,
                clientResponse: clientEntry.response,
                clientError: clientEntry.error,
                serverMetrics: { roundTripTime_ms: clientEntry.roundTripTime_ms },
                aiCalls: [],
            });
        }

        // Step 2: Merge data from server logs
        for (const [requestId, serverLogs] of serverLogsMap.entries()) {
            const requestReceivedLog = serverLogs.find(l => l.stage === 'request_received');
            if (!requestReceivedLog) continue;

            // <<< REFACTOR: Tính toán tất cả các chỉ số server MỘT LẦN ở đây >>>
            const responseCompletedLog = serverLogs.find(l => l.stage === 'response_completed');
            const aiCallStartLogs = serverLogs.filter(l => l.stage === 'ai_call_start');
            const streamCompletedLogs = serverLogs.filter(l => l.stage === 'ai_stream_completed');
            const firstTokenLog = serverLogs.find(l => l.stage === 'ai_first_token_received');

            const firstAiCallStartLog = aiCallStartLogs.find(l => l.details?.turn === 1);
            let timeToFirstToken_ms: number | undefined;
            if (firstAiCallStartLog && firstTokenLog) {
                timeToFirstToken_ms = new Date(firstTokenLog.time).getTime() - new Date(firstAiCallStartLog.time).getTime();
            }

            const aiCalls = aiCallStartLogs.map(startLog => {
                // <<< SỬA ĐỔI: Tìm cả hai loại log kết thúc >>>
                const endLog = serverLogs.find(end =>
                    (end.stage === 'ai_stream_completed' || end.stage === 'ai_function_call_completed') &&
                    end.details?.turn === startLog.details?.turn
                );
                return {
                    turn: startLog.details?.turn || 0,
                    requestedModel: startLog.details?.requestedModel,
                    actualModel: startLog.details?.actualModel,
                    // <<< SỬA ĐỔI: Đọc metric từ cả hai loại log >>>
                    duration_ms: endLog?.metrics?.totalStreamDuration_ms || endLog?.metrics?.duration_ms,
                };
            }).sort((a, b) => a.turn - b.turn);


            const serverMetrics = {
                totalServerDuration_ms: responseCompletedLog?.metrics?.totalServerDuration_ms,
                prepDuration_ms: responseCompletedLog?.metrics?.prepDuration_ms,
                aiTotalStreamDuration_ms: responseCompletedLog?.metrics?.aiCallDuration_ms,
                postProcessingDuration_ms: responseCompletedLog?.metrics?.postProcessingDuration_ms,
                timeToFirstToken_ms: timeToFirstToken_ms,
            };
            // <<< KẾT THÚC REFACTOR >>>

            const existingRequest = requestMap.get(requestId);
            if (existingRequest) {
                // Hợp nhất vào request đã có từ client
                existingRequest.startTime = requestReceivedLog.time;
                existingRequest.serverMetrics = { ...existingRequest.serverMetrics, ...serverMetrics };
                existingRequest.aiCalls = aiCalls;
            } else {
                // Tạo request "mồ côi" mới chỉ có dữ liệu server
                requestMap.set(requestId, {
                    requestId,
                    status: 'INCOMPLETE',
                    startTime: requestReceivedLog.time,
                    question: 'N/A (Server log only)',
                    clientRequestedModel: requestReceivedLog.details?.model,
                    serverMetrics,
                    aiCalls,
                });
            }
        }

        // Step 3: Sort and calculate summary
        const finalRequests = Array.from(requestMap.values()).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

        const summary: ChatbotLogAnalysisResult['summary'] = {
            successCount: 0, errorCount: 0, timeoutCount: 0, incompleteCount: 0,
            averageResponseTime_ms: 0, averageServerTime_ms: 0, averageAiTime_ms: 0,
            averageTimeToFirstToken_ms: 0,
            requestsByModel: {}
        };

        const validResponseTimes: number[] = [];
        const validServerTimes: number[] = [];
        const validAiStreamTimes: number[] = [];
        const validFirstTokenTimes: number[] = [];

        for (const req of finalRequests) {
            if (req.status === 'SUCCESS') summary.successCount++;
            else if (req.status === 'ERROR') summary.errorCount++;
            else if (req.status === 'TIMEOUT') summary.timeoutCount++;
            else if (req.status === 'INCOMPLETE') summary.incompleteCount++;

            if (req.serverMetrics.roundTripTime_ms) validResponseTimes.push(req.serverMetrics.roundTripTime_ms);
            if (req.serverMetrics.totalServerDuration_ms) validServerTimes.push(req.serverMetrics.totalServerDuration_ms);
            if (req.serverMetrics.aiTotalStreamDuration_ms) validAiStreamTimes.push(req.serverMetrics.aiTotalStreamDuration_ms);
            if (req.serverMetrics.timeToFirstToken_ms !== undefined) validFirstTokenTimes.push(req.serverMetrics.timeToFirstToken_ms);

            const modelKey = req.clientRequestedModel || 'default';
            if (!summary.requestsByModel[modelKey]) {
                (summary.requestsByModel as any)[modelKey] = { count: 0, responseTimes: [] };
            }
            (summary.requestsByModel as any)[modelKey].count++;
            if (req.serverMetrics.roundTripTime_ms) {
                (summary.requestsByModel as any)[modelKey].responseTimes.push(req.serverMetrics.roundTripTime_ms);
            }
        }

        if (validResponseTimes.length > 0) summary.averageResponseTime_ms = validResponseTimes.reduce((a, b) => a + b, 0) / validResponseTimes.length;
        if (validServerTimes.length > 0) summary.averageServerTime_ms = validServerTimes.reduce((a, b) => a + b, 0) / validServerTimes.length;
        if (validAiStreamTimes.length > 0) summary.averageAiTime_ms = validAiStreamTimes.reduce((a, b) => a + b, 0) / validAiStreamTimes.length;
        if (validFirstTokenTimes.length > 0) summary.averageTimeToFirstToken_ms = validFirstTokenTimes.reduce((a, b) => a + b, 0) / validFirstTokenTimes.length;

        for (const modelKey in summary.requestsByModel) {
            const modelData = (summary.requestsByModel as any)[modelKey];
            let avgResponseTime = 0;
            if (modelData.responseTimes.length > 0) {
                avgResponseTime = modelData.responseTimes.reduce((a: number, b: number) => a + b, 0) / modelData.responseTimes.length;
            }
            summary.requestsByModel[modelKey] = {
                count: modelData.count,
                avgResponseTime_ms: avgResponseTime
            };
        }

        return { analyzedRequests: finalRequests, summary };
    }
}