import 'reflect-metadata';
import { scoped, Lifecycle, inject } from 'tsyringe';
import { InputRowData } from '../types/crawl';
import { LoggingService } from './logging.service'; // <<< THÊM IMPORT
import { Logger } from 'pino'; // <<< THÊM IMPORT

@scoped(Lifecycle.ContainerScoped) 
export class InMemoryResultCollectorService {
    private results: InputRowData[] = [];
    private readonly collectorId: string; // <<< THÊM ID
    private readonly logger: Logger; // <<< THÊM LOGGER

    // <<< THÊM CONSTRUCTOR ĐỂ INJECT LOGGING SERVICE >>>
    constructor(@inject(LoggingService) loggingService: LoggingService) {
        this.collectorId = Math.random().toString(36).substring(2, 9); // Tạo ID ngẫu nhiên
        this.logger = loggingService.getLogger('app', { service: 'InMemoryResultCollector', collectorId: this.collectorId });
        this.logger.info('InMemoryResultCollectorService instance CREATED.');
    }

    public add(record: InputRowData): void {
        this.logger.info({ recordAcronym: record.conferenceAcronym, currentSize: this.results.length }, 'Calling ADD method.');
        this.results.push(record);
    }

    public get(): InputRowData[] {
        this.logger.info({ currentSize: this.results.length }, 'Calling GET method.');
        return this.results;
    }

    public clear(): void {
        this.logger.info({ currentSize: this.results.length }, 'Calling CLEAR method.');
        this.results = [];
    }
}