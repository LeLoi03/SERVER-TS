// // src/services/gemini/geminiRequestPayloadFileLogger.service.ts
// import 'reflect-metadata';
// import { singleton, inject } from 'tsyringe';
// import path from 'path';
// import { promises as fsPromises, existsSync } from 'fs';
// import { Logger } from 'pino';
// import { LoggingService } from '../logging.service'; // ConfigService không cần thiết nếu requestLogDir được truyền vào
// import { LogRequestPayloadParams } from '../../types/crawl';


// @singleton()
// export class GeminiRequestPayloadFileLoggerService {
//     private readonly serviceBaseLogger: Logger;

//     constructor(
//         @inject(LoggingService) private loggingService: LoggingService,
//     ) {
//         this.serviceBaseLogger = this.loggingService.getLogger('conference', { service: 'GeminiRequestPayloadFileLoggerService' });
//         this.serviceBaseLogger.info("Constructing GeminiRequestPayloadFileLoggerService.");
//     }

//     public async logRequestPayload(params: LogRequestPayloadParams): Promise<void> {
//         const fileLoggerOpLogger = params.parentAttemptLogger.child({
//             // serviceMethod và function (của retry/callGeminiApi) đã có từ parentAttemptLogger
//             // Thêm định danh cho function của service này
//             payloadLogFunc: 'GeminiRequestPayloadFileLoggerService.logRequestPayload'
//         });

//         try {
//             const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
//             const safeAcronym = (params.acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
//             const attemptNumber = params.parentAttemptLogger.bindings().attempt || 'unknown_attempt';
//             const requestLogFileName = `request_${params.apiType}_${params.modelNameUsed.replace('/', '_')}_${safeAcronym}_b${params.batchIndex}_att${attemptNumber}_${timestamp}.json`;
//             const requestLogFilePath = path.join(params.requestLogDir, requestLogFileName);

//             const requestPayloadToLog: any = {
//                 timestamp: new Date().toISOString(),
//                 apiType: params.apiType,
//                 modelName: params.modelNameUsed,
//                 crawlModelUsed: params.crawlModel,
//                 batchIndex: params.batchIndex,
//                 attempt: attemptNumber,
//                 title: params.title,
//                 acronym: params.acronym,
//                 usingCache: params.usingCacheActual,
//                 cacheName: params.usingCacheActual ? params.currentCacheName : 'N/A',
//                 systemInstructionApplied: params.systemInstructionApplied || "N/A",
//                 fewShotPartsApplied: params.fewShotPartsApplied && params.fewShotPartsApplied.length > 0 ? params.fewShotPartsApplied : 'N/A',
//             };

//             if (params.generationConfigSent) {
//                 requestPayloadToLog.generationConfigSent = params.generationConfigSent;
//             } else if (params.generationConfigEffective) {
//                 requestPayloadToLog.generationConfigEffective = params.generationConfigEffective;
//             }
//             requestPayloadToLog.contentRequestSent = params.contentRequest;

//             if (!existsSync(params.requestLogDir)) {
//                 await fsPromises.mkdir(params.requestLogDir, { recursive: true });
//             }
//             await fsPromises.writeFile(requestLogFilePath, JSON.stringify(requestPayloadToLog, null, 2), 'utf8');
//             fileLoggerOpLogger.debug({ event: 'gemini_api_request_payload_logged', filePath: requestLogFilePath }, "Full request payload logged to file.");

//         } catch (logError) {
//             fileLoggerOpLogger.error({ event: 'gemini_api_request_payload_log_failed', err: logError }, "Failed to log full request payload to file.");
//         }
//     }
// }