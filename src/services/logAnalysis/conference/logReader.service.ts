// src/services/logAnalysis/conference/logReader.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import { Logger } from 'pino';
import { ConfigService } from '../../../config/config.service';
import { LoggingService } from '../../logging.service';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import { createConferenceKey } from '../../../utils/logAnalysisConference/utils';

// Type này được giữ nguyên từ service gốc
interface SaveEventLogEntry {
    time: string;
    level: number;
    event?: 'CONFERENCE_SAVE_EVENT_RECORDED' | string;
    details?: {
        batchRequestId: string;
        acronym: string;
        title: string;
        recordedStatus: 'SAVED_TO_DATABASE' | string;
        clientTimestamp: string;
    };
}

@singleton()
export class ConferenceLogReaderService {
    private readonly serviceLogger: Logger;
    private readonly saveConferenceEventsLogFilePath: string;
    private readonly conferenceRequestLogBaseDir: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'ConferenceLogReaderService' });
        this.saveConferenceEventsLogFilePath = this.configService.getSaveConferenceEventLogFilePath();
        this.conferenceRequestLogBaseDir = this.configService.appConfiguration.conferenceRequestLogDirectory;
    }

    /**
     * Đọc file log sự kiện lưu trữ và trả về một Map các sự kiện.
     */
    async readConferenceSaveEvents(): Promise<Map<string, NonNullable<SaveEventLogEntry['details']>>> {
        const saveEventsMap = new Map<string, NonNullable<SaveEventLogEntry['details']>>();
        const logContext = { function: 'readConferenceSaveEvents', logFilePath: this.saveConferenceEventsLogFilePath };
        const logger = this.serviceLogger.child(logContext);

        if (!fsSync.existsSync(this.saveConferenceEventsLogFilePath)) {
            logger.warn({ event: 'save_event_log_not_found' }, 'Save event log file not found.');
            return saveEventsMap;
        }

        logger.debug({ event: 'read_save_events_start' }, 'Starting to read conference save events log.');
        let lineCount = 0;
        let parsedCount = 0;

        const fileStream = fsSync.createReadStream(this.saveConferenceEventsLogFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        try {
            for await (const line of rl) {
                lineCount++;
                if (!line.trim()) continue;
                try {
                    const logEntry = JSON.parse(line) as SaveEventLogEntry;
                    if (logEntry.event === 'CONFERENCE_SAVE_EVENT_RECORDED' && logEntry.details?.batchRequestId && logEntry.details?.acronym && logEntry.details?.title) {
                        const { batchRequestId, acronym, title } = logEntry.details;
                        const key = createConferenceKey(batchRequestId, acronym, title);
                        if (key) {
                            saveEventsMap.set(key, logEntry.details);
                            parsedCount++;
                        }
                    }
                } catch (parseError) {
                    logger.warn({ event: 'parse_save_event_line_error', lineNumber: lineCount, error: getErrorMessageAndStack(parseError).message }, `Failed to parse line from save event log.`);
                }
            }
            logger.debug({ event: 'read_save_events_finish', totalLines: lineCount, parsedEvents: parsedCount }, `Finished reading save events log.`);
        } catch (readError) {
            const { message, stack } = getErrorMessageAndStack(readError);
            logger.error({ event: 'read_save_events_file_error', err: { message, stack } }, `Error reading save events log file: ${message}`);
        }
        return saveEventsMap;
    }

    /**
     * Khám phá các ID request từ tên file trong thư mục log.
     */
    async discoverRequestIdsFromLogFiles(): Promise<string[]> {
        const logger = this.serviceLogger.child({ function: 'discoverRequestIdsFromLogFiles' });
        let requestIds: string[] = [];
        try {
            if (fsSync.existsSync(this.conferenceRequestLogBaseDir)) {
                const files = await fs.readdir(this.conferenceRequestLogBaseDir);
                requestIds = files
                    .filter(file => file.endsWith('.log'))
                    .map(file => path.basename(file, '.log'));
                logger.info(`Found ${requestIds.length} conference request log files in ${this.conferenceRequestLogBaseDir}.`);
            } else {
                logger.warn(`Conference request log directory not found: ${this.conferenceRequestLogBaseDir}. No live request IDs will be discovered.`);
            }
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack } }, 'Error reading conference request log directory for ID discovery.');
        }
        return requestIds;
    }
}